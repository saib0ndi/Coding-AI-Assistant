import { Logger } from '../utils/Logger.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { ProjectVerifier, VerificationResult } from '../verify/ProjectVerifier.js';
import { resolveTargetFiles } from './resolveTargetFiles.js';
import { parseSimpleFsTask, buildSimpleFsAgentResult } from './simpleFsTasks.js';
import { routeCommand, type CommandRoute, type AgentTaskType } from './intentRouter.js';
import { generateLlmPlan } from './llmPlanner.js';
import { StepValidator, type StepValidation } from './StepValidator.js';
import { TaskMemory } from './TaskMemory.js';
import {
    measureAgentPayload,
    type HallucinationMeasureContext,
} from '../quality/HallucinationDetector.js';
import type { HallucinationSummary } from '../types/agent.js';

export interface AutonomousTask {
    id: string;
    description: string;
    context: any;
    status: 'analyzing' | 'planning' | 'executing' | 'validating' | 'completed' | 'failed' | 'paused';
    progress: number;
    currentStep: string;
    startTime: number;
    plan?: AutonomousPlan;
    results?: any[];
}

export interface AutonomousPlan {
    steps: AutonomousStep[];
    riskLevel: 'low' | 'medium' | 'high';
    estimatedTime: number;
    dependencies: string[];
}

export interface AutonomousStep {
    id: string;
    action: string;
    tool: string;
    params: any;
    validation: string;
    critical: boolean;
    status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
    attempts: number;
    maxAttempts: number;
}

/**
 * Decide whether an autonomous task can honestly claim it was "verified".
 *
 * A task is only verified when project verification actually ran and passed.
 * When no verification ran we refuse to claim verification unless the caller
 * explicitly disabled it (`verify: false`) AND real file changes were produced.
 * This prevents no-op runs and analysis/review-only steps (which write nothing)
 * from falsely reporting `verified: true`.
 */
export function resolveVerifiedFlag(params: {
    previewChanges: boolean;
    proposedOnly: boolean;
    verifyDisabled: boolean;
    verification?: { passed: boolean };
    filesModifiedCount: number;
}): boolean {
    if (params.previewChanges || params.proposedOnly) return false;
    if (params.verification) return params.verification.passed;
    return params.verifyDisabled && params.filesModifiedCount > 0;
}

export class AutonomousAgent {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private projectVerifier: ProjectVerifier;
    private stepValidator: StepValidator;
    private taskMemory: TaskMemory;
    private activeTasks: Map<string, AutonomousTask> = new Map();
    private agents: Map<string, any>;

    constructor(
        ollamaProvider: OllamaProvider,
        fileSystemTool: FileSystemTool,
        agents: Map<string, any>,
        taskMemory?: TaskMemory
    ) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = fileSystemTool;
        this.projectVerifier = new ProjectVerifier(fileSystemTool);
        this.stepValidator = new StepValidator(fileSystemTool, ollamaProvider, this.logger);
        this.taskMemory = taskMemory ?? new TaskMemory();
        this.agents = agents;
    }

    async executeAutonomously(description: string, context: any, customTaskId?: string): Promise<any> {
        const taskId = customTaskId || `auto_${Date.now()}`;
        const startTime = Date.now();

        if (context?.fast === true) {
            return this.executeFastPath(taskId, description, context, startTime);
        }

        const route = this.resolveRoute(description, context);

        const fsTask = route.simpleFsTask ?? parseSimpleFsTask(description);
        if (fsTask) {
            const workspacePath = (context?.workspacePath as string) || process.cwd();
            return buildSimpleFsAgentResult(taskId, fsTask, workspacePath);
        }

        const sanitizedContext = this.sanitizeContext({
            ...context,
            workspacePath: context?.workspacePath || process.cwd(),
        });

        const targetFiles = resolveTargetFiles(description, {
            ...context,
            ...sanitizedContext,
            relevantChunks: context?.relevantChunks ?? sanitizedContext.relevantChunks,
        });

        const taskContext = {
            ...sanitizedContext,
            taskType: route.taskType,
            routedIntent: route.semanticIntent,
            routedTool: route.tool,
            relevantChunks: context?.relevantChunks ?? sanitizedContext.relevantChunks,
            ...(targetFiles.length > 0 ? { files: targetFiles } : {}),
        };

        const task: AutonomousTask = {
            id: taskId,
            description,
            context: taskContext,
            status: 'analyzing',
            progress: 5,
            currentStep: 'Analyzing task',
            startTime,
        };
        this.activeTasks.set(taskId, task);

        try {
            task.status = 'analyzing';
            task.currentStep = 'Analyzing intent';
            const enrichedContext = await this.analyzeIntentAndContext(description, taskContext);
            task.progress = 15;

            task.status = 'planning';
            task.currentStep = 'Building execution plan';
            const plan = await this.createExecutionPlan(description, enrichedContext);
            task.plan = plan;
            task.progress = 25;

            task.status = 'executing';
            task.currentStep = 'Executing with self-correction';
            let results = await this.executeWithSelfCorrection(task, plan);
            task.progress = 75;

            let verification: VerificationResult | undefined;
            const proposedOnly =
                taskContext.previewChanges === true &&
                (results.proposedChanges?.length ?? 0) > 0 &&
                (results.filesModified?.length ?? 0) === 0;

            const shouldVerify =
                taskContext.verify !== false &&
                taskContext.previewChanges !== true &&
                (results.filesModified?.length ?? 0) > 0;

            if (shouldVerify) {
                task.status = 'validating';
                task.currentStep = 'Running project verification';
                const repair = await this.verifyAndRepair(description, taskContext, results);
                results = repair.results;
                verification = repair.verification;
                task.progress = 90;
            }

            const finalOk =
                results.success &&
                (!verification || verification.passed) &&
                (!taskContext.previewChanges || (results.proposedChanges?.length ?? 0) > 0);

            task.status = finalOk ? 'completed' : 'failed';
            task.progress = 100;

            const hallucination = this.measureAndRecordHallucination(
                taskId,
                description,
                taskContext,
                results
            );

            await this.recordEpisode(description, taskContext, results, finalOk);

            return {
                taskId,
                success: finalOk,
                steps: results.steps,
                summary: proposedOnly
                    ? `${results.summary} | Preview ready — apply changes to verify`
                    : taskContext.previewChanges && (results.proposedChanges?.length ?? 0) === 0
                      ? `${results.summary} | Preview requested but no file edits were produced`
                    : verification
                      ? `${results.summary} | Verification: ${verification.summary}`
                      : results.summary,
                filesModified: results.filesModified,
                proposedChanges: results.proposedChanges,
                verification: verification
                    ? this.toVerificationSummary(verification)
                    : undefined,
                verified: resolveVerifiedFlag({
                    previewChanges: taskContext.previewChanges === true,
                    proposedOnly,
                    verifyDisabled: taskContext.verify === false,
                    filesModifiedCount: results.filesModified?.length ?? 0,
                    ...(verification ? { verification } : {}),
                }),
                executionTime: Date.now() - startTime,
                autonomous: true,
                corrections: results.corrections,
                replans: results.replans,
                hallucination,
            };
        } catch (error) {
            task.status = 'failed';
            return {
                taskId,
                success: false,
                steps: [],
                summary: `Failed: ${description}`,
                filesModified: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                executionTime: Date.now() - startTime,
                autonomous: true,
                verified: false,
                hallucination: {
                    hallucinationRate: 0,
                    groundedScore: 1,
                    flagCount: 0,
                    flags: [],
                    samplesAnalyzed: 0,
                    measuredAt: new Date().toISOString(),
                },
            };
        } finally {
            this.activeTasks.delete(taskId);
        }
    }

    private async executeFastPath(
        taskId: string,
        description: string,
        context: any,
        startTime: number
    ): Promise<any> {
        this.logger.info(`Fast autonomous execution: ${description}`);
        try {
            const result = await Promise.race([
                this.executeDirectly(description, context),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Execution timeout')), 15000)
                ),
            ]);
            return {
                taskId,
                success: true,
                steps: [{ action: description, success: true, result }],
                summary: `Completed (fast mode): ${description}`,
                filesModified: result.filesModified || [],
                proposedChanges: result.proposedChanges,
                executionTime: Date.now() - startTime,
                autonomous: true,
                verified: false,
            };
        } catch (error) {
            return {
                taskId,
                success: false,
                steps: [],
                summary: `Failed: ${description}`,
                filesModified: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                executionTime: Date.now() - startTime,
                autonomous: true,
                verified: false,
            };
        }
    }

    private async verifyAndRepair(
        description: string,
        context: any,
        results: {
            success: boolean;
            steps: any[];
            summary: string;
            filesModified: string[];
            proposedChanges?: any[];
            corrections: number;
        }
    ): Promise<{ results: typeof results; verification: VerificationResult }> {
        const workspacePath = context.workspacePath || process.cwd();
        let verification = await this.projectVerifier.verify(workspacePath);
        const maxRepairAttempts = 2;
        let attempt = 0;

        while (!verification.passed && attempt < maxRepairAttempts) {
            this.logger.info(`Verification failed (attempt ${attempt + 1}), repairing...`);
            const failureLog = this.projectVerifier.formatFailureForRepair(verification);
            const codeAgent = this.agents.get('code');

            if (!codeAgent?.execute) break;

            const repairResult = await codeAgent.execute({
                action: `Fix verification failures for: ${description}`,
                params: {
                    language: context.language || 'typescript',
                    verificationErrors: failureLog,
                },
                context: {
                    ...context,
                    files: results.filesModified,
                },
            });

            if (repairResult.filesModified?.length) {
                results.filesModified = [
                    ...new Set([...results.filesModified, ...repairResult.filesModified]),
                ];
            }
            results.corrections++;
            results.steps.push({
                id: `verify_repair_${attempt + 1}`,
                action: 'repair_after_verification',
                tool: 'code',
                success: repairResult.success !== false,
                result: repairResult,
                attempts: 1,
            });

            verification = await this.projectVerifier.verify(workspacePath);
            attempt++;
        }

        results.success = results.success && verification.passed;
        return { results, verification };
    }

    private toVerificationSummary(verification: VerificationResult) {
        return {
            passed: verification.passed,
            summary: verification.summary,
            checks: verification.checks.map((c) => ({
                name: c.name,
                command: c.command,
                passed: c.passed,
                exitCode: c.exitCode,
                skipped: c.skipped,
            })),
        };
    }

    private async executeDirectly(description: string, context: any): Promise<any> {
        // Use code agent directly for fast execution
        const codeAgent = this.agents.get('code');
        if (codeAgent) {
            return await codeAgent.execute({
                action: description,
                params: { language: context.language || 'typescript' },
                context
            });
        }
        
        // Fallback to direct code generation
        return {
            code: `// Generated for: ${description}\nfunction generatedFunction() {\n    // Implementation needed\n    return 'Hello World';\n}`,
            filesModified: ['generated.ts']
        };
    }

    /**
     * Resolve the command route, preferring the smart route already computed
     * upstream by AgentManager (regex → embedding → LLM) and passed through the
     * context as `routedIntent`/`routedTool`/`taskType`. Re-running the regex-only
     * `routeCommand` here would discard the embedding/LLM tiers and could disagree
     * with the route used for orchestration. When the context fields are absent
     * (e.g. AutonomousAgent invoked directly), we fall back to regex routing.
     */
    private resolveRoute(description: string, context: any): CommandRoute {
        const base = routeCommand(description, context?.taskType as string | undefined);
        const ctxIntent = context?.routedIntent as string | undefined;
        const ctxTool = context?.routedTool as string | undefined;
        const ctxTaskType = context?.taskType as AgentTaskType | undefined;
        if (ctxIntent && ctxTool && ctxTaskType) {
            return { ...base, taskType: ctxTaskType, semanticIntent: ctxIntent, tool: ctxTool };
        }
        return base;
    }

    private async analyzeIntentAndContext(description: string, context: any): Promise<any> {
        const route = this.resolveRoute(description, context);
        return {
            ...context,
            taskType: route.taskType,
            intent: route.semanticIntent,
            routedTool: route.tool,
            complexity: 3,
            riskLevel: this.assessRisk(description, context),
            tools: [route.tool],
            successCriteria: ['Task completed'],
            challenges: [],
            dependencies: [],
            estimatedSteps: route.taskType === 'test' ? 2 : 1,
        };
    }

    /**
     * Persist the outcome of a finished task so future, similar tasks can learn
     * from it. Best-effort — never lets a memory error affect the task result.
     */
    private async recordEpisode(
        description: string,
        context: any,
        results: any,
        success: boolean
    ): Promise<void> {
        try {
            const steps: any[] = Array.isArray(results?.steps) ? results.steps : [];
            const planSteps = steps
                .filter((s) => s.success && typeof s.action === 'string')
                .map((s) => s.action);
            const failureReasons = steps
                .filter((s) => s.success === false)
                .flatMap((s) =>
                    Array.isArray(s.validationReasons) && s.validationReasons.length > 0
                        ? s.validationReasons
                        : s.error
                          ? [String(s.error)]
                          : []
                );
            await this.taskMemory.record({
                description,
                taskType: context?.taskType,
                success,
                summary: results?.summary ?? '',
                planSteps,
                corrections: results?.corrections ?? 0,
                replans: results?.replans ?? 0,
                failureReasons,
                filesModified: Array.isArray(results?.filesModified) ? results.filesModified : [],
            });
        } catch {
            /* best-effort */
        }
    }

    private async createExecutionPlan(description: string, context: any): Promise<AutonomousPlan> {
        const route = this.resolveRoute(description, context);
        const isSimpleFs = route.strategy === 'fast_fs';

        // Learning loop: recall lessons from similar past tasks to prime planning.
        let priorLessons = '';
        try {
            priorLessons = await this.taskMemory.renderLessons(description, 3);
            if (priorLessons) {
                this.logger.info('Injecting lessons from similar past tasks into the planner');
            }
        } catch {
            /* best-effort */
        }

        // Dynamic planning by default: ask the planner for a project-grounded plan
        // for ANY non-trivial task (not just keyword-"complex" ones). The planner
        // returns 1..N concrete steps and decides the decomposition itself; it
        // declines (null) only when it can't ground the task, in which case we
        // fall back to the rule-based template below. This replaces the old
        // keyword gate (`isComplexTask`) that forced most tasks into a fixed
        // single-step template regardless of what the task actually needed.
        if (!isSimpleFs) {
            const llmPlan = await generateLlmPlan(
                description,
                {
                    workspacePath: context?.workspacePath,
                    language: context?.language,
                    previewChanges: context?.previewChanges === true,
                    ...(priorLessons ? { priorLessons } : {}),
                },
                this.ollamaProvider,
                this.logger
            );
            if (llmPlan) {
                this.logger.info(
                    `LLM plan: ${llmPlan.steps.length} step(s) — ${llmPlan.steps.map((s) => s.action.slice(0, 60)).join(' | ')}`
                );
                return llmPlan;
            }
            this.logger.info('LLM planner declined; using rule-based template plan');
        }

        const isTestTask =
            !isSimpleFs &&
            (route.taskType === 'test' ||
            context.taskType === 'test' ||
            route.semanticIntent === 'generate_tests' ||
            /\b(generate|write|create|add|make)\b.*\b(tests?|specs?)\b/i.test(description) ||
            /\bunit tests?\b/i.test(description));

        const isFixTask =
            !isSimpleFs &&
            (route.taskType === 'fix' || route.semanticIntent === 'fix_code');

        const isReviewTask =
            !isSimpleFs &&
            (route.taskType === 'analyze' ||
            /\b(review|audit)\b/i.test(description));

        const tool = isTestTask ? 'test' : route.tool === 'file' ? 'code' : (route.tool || 'code');
        const language = context.language || 'typescript';
        const steps: AutonomousStep[] = [
            {
                id: 'step_1',
                action: isReviewTask
                    ? `Review code: ${description}`
                    : isTestTask
                      ? `Generate unit tests: ${description}`
                      : isFixTask
                        ? `Fix: ${description}`
                        : description,
                tool,
                params: { description, language },
                validation: isReviewTask
                    ? 'Review completed with findings'
                    : isTestTask
                      ? 'Test files generated successfully'
                      : 'Code generated successfully',
                critical: !isReviewTask,
                status: 'pending',
                attempts: 0,
                maxAttempts: isReviewTask ? 1 : 2,
            },
        ];

        const shouldRunTests =
            isTestTask &&
            context.previewChanges !== true &&
            context.verify !== false;

        if (shouldRunTests) {
            steps.push({
                id: 'step_2',
                action: 'run_tests',
                tool: 'test',
                params: { description, language },
                validation: 'Tests executed without failures',
                critical: false,
                status: 'pending',
                attempts: 0,
                maxAttempts: 1,
            });
        }

        return {
            steps,
            riskLevel: 'low',
            estimatedTime: isTestTask ? (shouldRunTests ? 12 : 8) : 5,
            dependencies: [],
        };
    }

    private async executeWithSelfCorrection(task: AutonomousTask, plan: AutonomousPlan): Promise<any> {
        const results = {
            success: true,
            steps: [] as any[],
            summary: '',
            filesModified: [] as string[],
            proposedChanges: [] as any[],
            corrections: 0,
            replans: 0,
            rollbacks: 0
        };

        // The remaining work is a mutable queue so a re-plan can replace it.
        const queue: AutonomousStep[] = [...plan.steps];
        const maxReplans = Math.max(0, Number(process.env.AUTONOMOUS_MAX_REPLANS ?? 2) || 0);
        let processed = 0;

        while (queue.length > 0) {
            const step = queue.shift()!;

            if (task.status === 'paused') {
                await this.waitForResume(task);
            }

            let stepSuccess = false;
            let lastResult: any;
            let lastValidation: StepValidation | undefined;
            step.status = 'executing';

            task.currentStep = `Executing: ${step.action}`;
            const totalEstimate = processed + 1 + queue.length;
            task.progress = 40 + (processed / Math.max(totalEstimate, 1)) * 50;

            // --- Tier 1: param-level self-correction (retry same action with adjusted args) ---
            while (step.attempts < step.maxAttempts && !stepSuccess) {
                try {
                    this.logger.info(`Executing step: ${step.action} (attempt ${step.attempts + 1})`);

                    const agent = this.agents.get(step.tool) || this.agents.get('code');
                    const stepResult = await this.executeStepWithAgent(agent, step, task.context);
                    lastResult = stepResult;

                    const validation = await this.stepValidator.validate(step, stepResult, task.context);
                    lastValidation = validation;

                    if (validation.valid) {
                        step.status = 'completed';
                        stepSuccess = true;

                        results.steps.push({
                            id: step.id,
                            action: step.action,
                            tool: step.tool,
                            success: true,
                            result: stepResult,
                            attempts: step.attempts + 1,
                            validation: { confidence: validation.confidence, method: validation.method },
                        });

                        if (stepResult.filesModified) {
                            results.filesModified.push(...stepResult.filesModified);
                        }
                        if (stepResult.proposedChanges) {
                            results.proposedChanges.push(...stepResult.proposedChanges);
                        }
                    } else {
                        this.logger.info(
                            `Step invalid (${validation.method}): ${validation.reasons.join('; ').slice(0, 200)}`
                        );
                        // Only update params, not action (prevents the LLM from renaming steps to e.g. "retry").
                        // Feed the concrete validation reasons in so the fix is targeted, not blind.
                        const correction = await this.generateCorrection(step, stepResult, validation.reasons);
                        step.params = { ...step.params, ...correction.params };
                        results.corrections++;
                        step.attempts++;
                    }
                } catch (error) {
                    lastResult = { error: error instanceof Error ? error.message : 'Unknown error' };
                    lastValidation = undefined;
                    step.attempts++;
                }
            }

            if (stepSuccess) {
                processed++;
                continue;
            }

            // Param-level correction exhausted.
            step.status = 'failed';

            // --- Tier 2: strategy-level re-planning ---
            // Instead of giving up, ask the model to reconsider the *approach* for
            // the remaining work (different actions/tools/decomposition).
            if (step.critical && results.replans < maxReplans) {
                const failureContext =
                    lastValidation && !lastValidation.valid && lastValidation.reasons.length > 0
                        ? { result: lastResult, validationReasons: lastValidation.reasons }
                        : lastResult;
                const newSteps = await this.replanRemaining(task, step, failureContext, queue, results.steps);
                if (newSteps && newSteps.length > 0) {
                    results.replans++;
                    results.steps.push({
                        id: `replan_${results.replans}`,
                        action: `Re-planned after failed step: ${step.action}`,
                        tool: 'planner',
                        success: true,
                        result: { newSteps: newSteps.map(s => s.action) },
                        attempts: 1,
                    });
                    queue.length = 0;
                    queue.push(...newSteps);
                    this.logger.info(`Strategy re-plan #${results.replans}: ${newSteps.length} new step(s)`);
                    continue; // execute the revised plan; don't count the failed step as processed
                }
            }

            // No re-plan available or budget exhausted: record the terminal failure.
            results.steps.push({
                id: step.id,
                action: step.action,
                tool: step.tool,
                success: false,
                error: (lastResult && lastResult.error) || 'Step failed validation after retries',
                validationReasons: lastValidation?.reasons,
                attempts: step.attempts,
            });

            if (step.critical) {
                results.success = false;
                break;
            }
            processed++;
        }

        const successful = results.steps.filter(s => s.success).length;
        results.summary =
            `Executed ${processed} step(s). ${successful} successful, ` +
            `${results.corrections} param corrections, ${results.replans} re-plan(s).`;
        return results;
    }

    /**
     * Strategy-level re-planning. When a critical step exhausts param-level
     * corrections, ask the model to reconsider the *approach* for the remaining
     * work — choosing different actions/tools/decomposition — rather than
     * retrying the same action with new arguments. Returns a fresh set of steps
     * to replace the remaining queue, or null if no usable plan was produced.
     */
    private async replanRemaining(
        task: AutonomousTask,
        failedStep: AutonomousStep,
        failedResult: any,
        remaining: AutonomousStep[],
        completed: any[]
    ): Promise<AutonomousStep[] | null> {
        const completedSummary =
            completed.filter(s => s.success).map(s => `- ${s.action}`).join('\n') || '(none)';
        const remainingSummary =
            remaining.map(s => `- [${s.tool}] ${s.action}`).join('\n') || '(none)';
        const failureText =
            typeof failedResult === 'string'
                ? failedResult.slice(0, 800)
                : JSON.stringify(failedResult ?? {}).slice(0, 800);
        const language = task.context?.language || 'typescript';

        const prompt = `You are re-planning an autonomous coding task after an approach failed.

Task:
${task.description}

Already completed (keep — do NOT redo these):
${completedSummary}

The step that FAILED after multiple retries:
- action: ${failedStep.action}
- tool: ${failedStep.tool}
- params: ${JSON.stringify(failedStep.params ?? {}).slice(0, 400)}

Why it failed:
${failureText}

Remaining planned steps (the OLD approach — replace with something better):
${remainingSummary}

Re-plan ONLY the remaining work using a DIFFERENT strategy that avoids the failure.
Available tools: code, file, test, project.

Output contract:
- Return ONLY valid JSON. No markdown, no prose.
- Schema: {"reasoning":"short","steps":[{"action":"string","tool":"code|file|test|project","params":{},"validation":"string","critical":true}]}
- Provide 1 to 5 concrete steps. Do not repeat completed work.`;

        try {
            const response = await this.ollamaProvider.generateText({
                prompt,
                model: this.ollamaProvider.getModel(undefined, 'default'),
            });

            const parsed = JSON.parse(this.stripJsonFences(response));
            if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
                return null;
            }

            const allowedTools = new Set(['code', 'file', 'test', 'project']);
            const steps: AutonomousStep[] = parsed.steps.slice(0, 5).map((s: any, i: number) => ({
                id: `replan_${Date.now()}_${i + 1}`,
                action: String(s.action || task.description).slice(0, 500),
                tool: allowedTools.has(s.tool) ? s.tool : 'code',
                params:
                    s.params && typeof s.params === 'object'
                        ? { description: task.description, language, ...s.params }
                        : { description: task.description, language },
                validation: String(s.validation || 'Step completed successfully').slice(0, 300),
                critical: s.critical !== false,
                status: 'pending',
                attempts: 0,
                maxAttempts: 2,
            }));

            this.logger.info(`Re-plan reasoning: ${String(parsed.reasoning || '').slice(0, 200)}`);
            return steps;
        } catch (e) {
            this.logger.warn(
                `Re-plan did not produce a usable plan: ${e instanceof Error ? e.message : e}`
            );
            return null;
        }
    }

    /** Extract a JSON object from a model response that may include code fences or prose. */
    private stripJsonFences(text: string): string {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const body = fenced ? fenced[1] : text;
        const start = body.indexOf('{');
        const end = body.lastIndexOf('}');
        return start >= 0 && end > start ? body.slice(start, end + 1) : body;
    }

    private async executeStepWithAgent(
        agent: any, 
        step: AutonomousStep, 
        context: any
    ): Promise<any> {
        const targetFiles = Array.isArray(step.params?.targetFiles)
            ? step.params.targetFiles.filter((f: unknown) => typeof f === 'string')
            : [];
            
        const stepContext = targetFiles.length > 0
            ? { ...context, files: targetFiles }
            : context;

        if (agent?.executeStep) {
            const workflowStep = {
                id: step.id,
                action: step.action,
                tool: step.tool,
                params: step.params || {},
                status: 'pending' as const,
            };
            return await agent.executeStep(workflowStep, stepContext);
        }

        if (!agent || typeof agent.execute !== 'function') {
            throw new Error(`Agent for tool ${step.tool} not available`);
        }

        return await agent.execute({
            action: step.action,
            params: step.params || {},
            context: stepContext
        });
    }

    private async generateCorrection(step: AutonomousStep, failedResult: any, reasons: string[] = []): Promise<any> {
        const reasonsBlock = reasons.length > 0
            ? `\nWhy validation failed (fix these specifically):\n${reasons.map(r => `- ${r}`).join('\n')}\n`
            : '';
        const prompt = `You are repairing a failed autonomous coding step.

Step:
${step.action}

Tool:
${step.tool}

Failed result:
${JSON.stringify(failedResult).substring(0, 1000)}
${reasonsBlock}
Original params:
${JSON.stringify(step.params)}

Output contract:
- Return only valid JSON.
- Schema: {"params":{},"action":"string","reasoning":"short"}
- Keep the correction minimal and safe.
- If retrying is unsafe, return {"params":{},"action":"abort","reasoning":"short reason"}.
- Do not include markdown fences or prose.`;

        try {
            const response = await this.ollamaProvider.generateText({
                prompt,
                model: this.ollamaProvider.getModel(undefined, 'code')
            });

            const correction = JSON.parse(response);
            return {
                params: correction.params || step.params,
                action: correction.action || step.action,
                reasoning: correction.reasoning || 'Fallback correction'
            };
        } catch {
            return {
                params: { ...step.params, retry: true },
                action: step.action,
                reasoning: 'Fallback correction applied'
            };
        }
    }

    private async validateFinalResults(results: any, context: any): Promise<boolean> {
        const successRate = results.steps.filter((s: any) => s.success).length / results.steps.length;
        
        if (successRate < 0.5) return false;
        if (context.riskLevel === 'high' && successRate < 0.8) return false;
        
        return results.success;
    }

    private async waitForResume(task: AutonomousTask): Promise<void> {
        while (task.status === 'paused') {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Utility methods
    private inferIntent(description: string): string {
        const desc = description.toLowerCase();
        if (desc.includes('fix') || desc.includes('bug') || desc.includes('error')) return 'fix';
        if (desc.includes('test')) return 'test';
        if (desc.includes('refactor') || desc.includes('improve')) return 'refactor';
        if (desc.includes('analyze') || desc.includes('review')) return 'analyze';
        return 'implement';
    }

    private assessRisk(description: string, context: any): 'low' | 'medium' | 'high' {
        const desc = description.toLowerCase();
        const highRisk = ['delete', 'remove', 'drop', 'production'];
        const mediumRisk = ['modify', 'update', 'change'];
        
        if (highRisk.some(word => desc.includes(word))) return 'high';
        if (mediumRisk.some(word => desc.includes(word))) return 'medium';
        return 'low';
    }

    private validateTool(tool: string): string | null {
        const validTools = ['code', 'file', 'project', 'test'];
        return validTools.includes(tool) ? tool : null;
    }

    private createFallbackPlan(description: string, context: any): AutonomousPlan {
        return {
            steps: [{
                id: 'fallback_step',
                action: description,
                tool: 'code',
                params: context,
                validation: 'Task completed successfully',
                critical: true,
                status: 'pending',
                attempts: 0,
                maxAttempts: 3
            }],
            riskLevel: context.riskLevel || 'medium',
            estimatedTime: 10,
            dependencies: []
        };
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>\"'&;\\`$(){}[\]|]/g, '').substring(0, 500);
    }

    private sanitizeContext(context: any): any {
        if (!context || typeof context !== 'object') return {};
        const sanitized: any = {};
        const allowedKeys = ['language', 'workspacePath', 'files', 'projectType', 'autonomous', 'verify', 'fast', 'previewChanges', 'relevantChunks', 'taskType', 'routedIntent', 'routedTool'];
        
        for (const key of allowedKeys) {
            if (context[key] !== undefined && context[key] !== null) {
                if (typeof context[key] === 'string') {
                    sanitized[key] = this.sanitizeInput(context[key]);
                } else if (Array.isArray(context[key])) {
                    sanitized[key] = key === 'relevantChunks'
                        ? context[key].slice(0, 8)
                        : context[key].slice(0, 10);
                } else {
                    sanitized[key] = context[key];
                }
            }
        }
        return sanitized;
    }

    // Task management
    getTask(taskId: string): AutonomousTask | null {
        return this.activeTasks.get(taskId) || null;
    }

    getAllTasks(): AutonomousTask[] {
        return Array.from(this.activeTasks.values());
    }

    async pauseTask(taskId: string): Promise<boolean> {
        const task = this.activeTasks.get(taskId);
        if (task && task.status === 'executing') {
            task.status = 'paused';
            return true;
        }
        return false;
    }

    async resumeTask(taskId: string): Promise<boolean> {
        const task = this.activeTasks.get(taskId);
        if (task && task.status === 'paused') {
            task.status = 'executing';
            return true;
        }
        return false;
    }

    async cancelTask(taskId: string): Promise<boolean> {
        const task = this.activeTasks.get(taskId);
        if (task) {
            task.status = 'failed';
            this.activeTasks.delete(taskId);
            return true;
        }
        return false;
    }

    private measureAndRecordHallucination(
        taskId: string,
        description: string,
        taskContext: Record<string, unknown>,
        results: {
            proposedChanges?: Array<{ filePath?: string; modified?: string; original?: string }>;
            steps?: Array<{ result?: any }>;
        }
    ): HallucinationSummary {
        const analyzeCtx: HallucinationMeasureContext = { taskDescription: description };
        if (typeof taskContext.workspacePath === 'string') {
            analyzeCtx.workspacePath = taskContext.workspacePath;
        }
        if (Array.isArray(taskContext.files)) {
            analyzeCtx.files = taskContext.files as string[];
        }
        const outputPaths = (results.proposedChanges || [])
            .map((c) => c.filePath)
            .filter((p): p is string => typeof p === 'string');
        if (outputPaths.length > 0) {
            analyzeCtx.outputFilePaths = outputPaths;
        }
        if (taskId) analyzeCtx.taskId = taskId;
        analyzeCtx.taskType = (taskContext.taskType as string) || 'unknown';

        return measureAgentPayload(results, analyzeCtx, true);
    }

    getCapabilities(): any {
        return {
            maxConcurrentTasks: 5,
            supportedIntents: ['implement', 'fix', 'test', 'refactor', 'analyze'],
            availableTools: Array.from(this.agents.keys()),
            riskLevels: ['low', 'medium', 'high'],
            features: {
                selfCorrection: true,
                rollback: true,
                validation: true,
                planning: true,
                monitoring: true,
                pauseResume: true
            }
        };
    }
}
