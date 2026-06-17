import { WorkflowStep, WorkflowPlan, AgentResult } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';
import { loadAppConfig } from '../config/AppConfig.js';
import { getDLQ } from './DeadLetterQueue.js';
import { withSpan } from '../utils/Tracing.js';
import { workflowStepDurationMs } from '../utils/Metrics.js';

export class WorkflowExecutor {
    private logger: Logger;
    private agents: Map<string, any>;

    constructor(agents: Map<string, any>) {
        this.logger = new Logger();
        this.agents = agents;
    }

    async executeWorkflow(
        plan: WorkflowPlan,
        context: any,
        progressCallback?: (progress: number, step: string) => void
    ): Promise<AgentResult> {
        const { stepTimeoutMs, maxConcurrentSteps } = loadAppConfig().workflow;
        const executedSteps: WorkflowStep[] = [];
        const filesModified: string[] = [];
        const proposedChanges: NonNullable<AgentResult['proposedChanges']> = [];

        // Build the set of step IDs that need approval before they can run.
        // context.autoApprove=true bypasses the gate (e.g. complex_workflow).
        // context.approvedSteps is a string[] of pre-approved IDs.
        const needsApproval = new Set(plan.requiredApprovals ?? []);
        const preApproved = new Set<string>(
            (context?.autoApprove === true)
                ? Array.from(needsApproval)
                : (Array.isArray(context?.approvedSteps) ? context.approvedSteps as string[] : [])
        );

        try {
            const waves = this.buildDependencyWaves(plan.steps);
            let completedCount = 0;

            for (const wave of waves) {
                // Enforce concurrency cap within each wave
                const chunks = this.chunk(wave, maxConcurrentSteps);

                for (const chunk of chunks) {
                    // Check approval gate before dispatching this chunk.
                    const pendingApproval = chunk.filter(s => needsApproval.has(s.id) && !preApproved.has(s.id));
                    if (pendingApproval.length > 0) {
                        const ids = pendingApproval.map(s => s.id);
                        this.logger.info(`Workflow paused — awaiting approval for steps: ${ids.join(', ')}`);
                        for (const s of pendingApproval) s.status = 'pending';
                        return {
                            taskId: plan.taskId,
                            success: false,
                            steps: [...executedSteps, ...pendingApproval],
                            summary: `Awaiting approval for step(s): ${ids.join(', ')}. Re-run with approvedSteps=[${ids.map(id => `"${id}"`).join(',')}] to continue.`,
                            filesModified,
                            proposedChanges,
                            error: `approval_required:${ids.join(',')}`,
                        };
                    }

                    const waveResults = await Promise.all(
                        chunk.map(step => this.runStep(step, context, stepTimeoutMs))
                    );

                    for (const { step, result, error } of waveResults) {
                        executedSteps.push(step);
                        completedCount++;

                        const progressPct = Math.round((completedCount / plan.steps.length) * 100);
                        progressCallback?.(progressPct, step.action);

                        if (step.status === 'failed') {
                            // Push to DLQ before aborting so it can be replayed later
                            getDLQ().push({
                                taskId: plan.taskId,
                                step,
                                error: error ?? 'Unknown error',
                                attempts: 1,
                            });
                            return {
                                taskId: plan.taskId,
                                success: false,
                                steps: executedSteps,
                                summary: `Failed at step "${step.action}": ${error}`,
                                filesModified,
                                proposedChanges,
                                error: error ?? 'Unknown error',
                            };
                        }

                        if (result?.filesModified) filesModified.push(...result.filesModified);
                        if (result?.proposedChanges) proposedChanges.push(...result.proposedChanges);

                        // Thread results into shared context for downstream steps
                        context.stepResults = context.stepResults ?? {};
                        context.stepResults[step.id] = result;
                    }
                }
            }

            return {
                taskId: plan.taskId,
                success: true,
                steps: executedSteps,
                summary: `Successfully completed ${executedSteps.length} steps`,
                filesModified,
                proposedChanges,
            };

        } catch (error) {
            return {
                taskId: plan.taskId,
                success: false,
                steps: executedSteps,
                summary: `Workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filesModified,
                proposedChanges,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Build execution waves via topological sort.
     * Wave 0 = steps with no deps; Wave N = steps whose deps all completed in waves 0..N-1.
     * Steps in the same wave have no ordering constraint and run in parallel.
     */
    private buildDependencyWaves(steps: WorkflowStep[]): WorkflowStep[][] {
        const stepById = new Map(steps.map(s => [s.id, s]));
        const assignedWave = new Map<string, number>();
        const visiting = new Set<string>();
        const waves: WorkflowStep[][] = [];

        const getWave = (step: WorkflowStep): number => {
            if (assignedWave.has(step.id)) return assignedWave.get(step.id)!;

            const deps = step.dependencies ?? [];
            if (deps.length === 0) {
                assignedWave.set(step.id, 0);
                return 0;
            }

            // Cycle guard: if we re-enter a step already on the current
            // resolution path, the dependency graph has a cycle. Break it by
            // ignoring the back-edge instead of recursing forever.
            visiting.add(step.id);

            let maxDepWave = -1;
            for (const depId of deps) {
                if (depId === step.id || visiting.has(depId)) {
                    this.logger.warn(`Dependency cycle detected at step "${step.id}" (dep "${depId}") — ignoring back-edge`);
                    continue;
                }
                const depStep = stepById.get(depId);
                if (!depStep) continue; // unknown dep — ignore
                maxDepWave = Math.max(maxDepWave, getWave(depStep));
            }

            visiting.delete(step.id);

            const wave = maxDepWave + 1;
            assignedWave.set(step.id, wave);
            return wave;
        };

        for (const step of steps) {
            const w = getWave(step);
            if (!waves[w]) waves[w] = [];
            waves[w].push(step);
        }

        return waves;
    }

    private async runStep(
        step: WorkflowStep,
        context: any,
        timeoutMs: number
    ): Promise<{ step: WorkflowStep; result: any; error?: string }> {
        step.status = 'running';
        this.logger.info(`Executing step: ${step.action} (tool: ${step.tool})`);

        return withSpan(`step:${step.tool}:${step.action.slice(0, 40)}`, async () => {
            const start = Date.now();
            try {
                const agent = this.agents.get(step.tool) ?? this.agents.get('code');
                const result = await this.withTimeout(
                    agent.executeStep(step, context),
                    timeoutMs,
                    step.action
                );
                workflowStepDurationMs.observe(Date.now() - start, { tool: step.tool, status: 'ok' });
                step.status = 'completed';
                step.result = result;
                return { step, result };
            } catch (error) {
                workflowStepDurationMs.observe(Date.now() - start, { tool: step.tool, status: 'error' });
                const msg = error instanceof Error ? error.message : 'Unknown error';
                step.status = 'failed';
                step.error = msg;
                this.logger.warn(`Step "${step.action}" failed: ${msg}`);
                return { step, result: null, error: msg };
            }
        });
    }

    async executeStepWithRetry(step: WorkflowStep, context: any, maxRetries = 3): Promise<any> {
        const { stepTimeoutMs } = loadAppConfig().workflow;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const agent = this.agents.get(step.tool) ?? this.agents.get('code');
                return await this.withTimeout(
                    agent.executeStep(step, context),
                    stepTimeoutMs,
                    step.action
                );
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                this.logger.warn(`Step ${step.id} failed (attempt ${attempt}/${maxRetries}): ${lastError.message}`);
                if (attempt < maxRetries) await this.delay(1000 * attempt);
            }
        }

        throw lastError ?? new Error('Max retries exceeded');
    }

    getExecutionProgress(steps: WorkflowStep[]): {
        total: number;
        completed: number;
        running: number;
        failed: number;
        pending: number;
        percentage: number;
    } {
        const total = steps.length;
        const completed = steps.filter(s => s.status === 'completed').length;
        const running = steps.filter(s => s.status === 'running').length;
        const failed = steps.filter(s => s.status === 'failed').length;
        const pending = steps.filter(s => s.status === 'pending').length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { total, completed, running, failed, pending, percentage };
    }

    private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Step "${label}" timed out after ${ms}ms`)),
                ms
            );
            promise.then(
                v => { clearTimeout(timer); resolve(v); },
                e => { clearTimeout(timer); reject(e); }
            );
        });
    }

    private chunk<T>(arr: T[], size: number): T[][] {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
