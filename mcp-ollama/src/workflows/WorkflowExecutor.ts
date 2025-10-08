import { AgentTask, WorkflowStep, WorkflowPlan, AgentResult } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';

export class WorkflowExecutor {
    private logger: Logger;
    private agents: Map<string, any>;

    constructor(agents: Map<string, any>) {
        this.logger = new Logger();
        this.agents = agents;
    }

    async executeWorkflow(plan: WorkflowPlan, context: any): Promise<AgentResult> {
        const executedSteps: WorkflowStep[] = [];
        const filesModified: string[] = [];
        let currentStep = 0;

        try {
            for (const step of plan.steps) {
                currentStep++;
                this.logger.info(`Executing step ${currentStep}/${plan.steps.length}: ${step.action}`);

                // Check dependencies
                if (!this.areDependenciesMet(step, executedSteps)) {
                    throw new Error(`Dependencies not met for step: ${step.id}`);
                }

                step.status = 'running';
                
                const agent = this.agents.get(step.tool) || this.agents.get('code');
                const result = await agent.executeStep(step, context);

                step.status = 'completed';
                step.result = result;

                if (result.filesModified) {
                    filesModified.push(...result.filesModified);
                }

                executedSteps.push(step);

                // Update context with step results
                context.stepResults = context.stepResults || {};
                context.stepResults[step.id] = result;
            }

            return {
                taskId: plan.taskId,
                success: true,
                steps: executedSteps,
                summary: `Successfully completed ${executedSteps.length} steps`,
                filesModified
            };

        } catch (error) {
            // Mark current step as failed
            if (currentStep <= plan.steps.length) {
                const failedStep = plan.steps[currentStep - 1];
                failedStep.status = 'failed';
                failedStep.error = error instanceof Error ? error.message : 'Unknown error';
                executedSteps.push(failedStep);
            }

            return {
                taskId: plan.taskId,
                success: false,
                steps: executedSteps,
                summary: `Failed at step ${currentStep}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filesModified,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private areDependenciesMet(step: WorkflowStep, executedSteps: WorkflowStep[]): boolean {
        if (!step.dependencies || step.dependencies.length === 0) {
            return true;
        }

        const completedStepIds = executedSteps
            .filter(s => s.status === 'completed')
            .map(s => s.id);

        return step.dependencies.every(depId => completedStepIds.includes(depId));
    }

    async executeStepWithRetry(step: WorkflowStep, context: any, maxRetries = 3): Promise<any> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const agent = this.agents.get(step.tool) || this.agents.get('code');
                return await agent.executeStep(step, context);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                this.logger.warn(`Step ${step.id} failed (attempt ${attempt}/${maxRetries}):`, error);
                
                if (attempt < maxRetries) {
                    await this.delay(1000 * attempt); // Exponential backoff
                }
            }
        }

        throw lastError || new Error('Max retries exceeded');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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
}