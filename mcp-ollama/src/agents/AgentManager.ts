import { Logger } from '../utils/Logger.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AgentTask, WorkflowPlan, WorkflowStep, AgentResult } from '../types/agent.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { CodeAgent } from './CodeAgent.js';
import { FileAgent } from './FileAgent.js';
import { ProjectAgent } from './ProjectAgent.js';
import { TestAgent } from './TestAgent.js';
import { WorkflowTemplates } from '../workflows/WorkflowTemplates.js';
import { WorkflowExecutor } from '../workflows/WorkflowExecutor.js';

export class AgentManager {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private agents: Map<string, any>;
    private activeTasks: Map<string, AgentTask>;
    private workflowExecutor: WorkflowExecutor;

    constructor(ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = new FileSystemTool();
        this.agents = new Map();
        this.activeTasks = new Map();
        
        this.initializeAgents();
        this.workflowExecutor = new WorkflowExecutor(this.agents);
    }

    private initializeAgents(): void {
        this.agents.set('code', new CodeAgent(this.ollamaProvider, this.fileSystemTool));
        this.agents.set('file', new FileAgent(this.fileSystemTool));
        this.agents.set('project', new ProjectAgent(this.ollamaProvider, this.fileSystemTool));
        this.agents.set('test', new TestAgent(this.ollamaProvider, this.fileSystemTool));
    }

    async executeTask(task: AgentTask, progressCallback?: (progress: number, step: string) => void): Promise<AgentResult> {
        const sanitizedTask = this.sanitizeTask(task);
        this.logger.info(`Starting agent task: ${sanitizedTask.id} - ${sanitizedTask.description}`);
        this.activeTasks.set(sanitizedTask.id, { ...sanitizedTask, status: 'planning' });

        try {
            const plan = await this.planWorkflow(sanitizedTask);
            const result = await this.executeWorkflow(plan, progressCallback);
            
            this.activeTasks.delete(sanitizedTask.id);
            return result;
        } catch (error) {
            this.logger.error(`Agent task failed: ${sanitizedTask.id}`, error);
            this.activeTasks.delete(sanitizedTask.id);
            
            return {
                taskId: sanitizedTask.id,
                success: false,
                steps: [],
                summary: `Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filesModified: [],
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async planWorkflow(task: AgentTask): Promise<WorkflowPlan> {
        // Try to use predefined templates first
        const templateSteps = WorkflowTemplates.getTemplate(task.type, {
            language: task.context?.language,
            description: task.description,
            projectType: (task.context as any)?.projectType
        });

        if (templateSteps.length > 1) {
            const plan = {
                taskId: task.id,
                steps: templateSteps,
                estimatedTime: templateSteps.length * 45,
                requiredApprovals: []
            };
            return this.validatePlan(plan) ? plan : await this.fallbackPlanning(task);
        }

        return await this.fallbackPlanning(task);
    }

    private async fallbackPlanning(task: AgentTask): Promise<WorkflowPlan> {
        const sanitizedDesc = this.sanitizeInput(task.description);
        const sanitizedType = this.sanitizeInput(task.type);
        const prompt = `Plan workflow for: ${sanitizedDesc}\nType: ${sanitizedType}\nProvide numbered steps with specific actions and required tools.`;
        
        const response = await this.ollamaProvider.generateText({
            prompt,
            model: 'deepseek-r1:70b'
        });

        const plan = this.parseWorkflowPlan(task.id, this.sanitizeInput(response));
        return this.validatePlan(plan) ? plan : this.createFallbackPlan(task);
    }

    private validatePlan(plan: WorkflowPlan): boolean {
        return plan.steps.length > 0 && 
               plan.steps.every(step => step.action && step.tool && this.agents.has(step.tool));
    }

    private createFallbackPlan(task: AgentTask): WorkflowPlan {
        return {
            taskId: task.id,
            steps: [{
                id: 'fallback_step',
                action: task.description,
                tool: this.inferTool(task.description),
                params: task.context || {},
                status: 'pending'
            }],
            estimatedTime: 60,
            requiredApprovals: []
        };
    }

    private parseWorkflowPlan(taskId: string, response: string): WorkflowPlan {
        const steps: WorkflowStep[] = [];
        const lines = response.split('\n').filter(line => line.trim()).slice(0, 10); // Limit steps
        
        lines.forEach((line, index) => {
            const stepMatch = line.match(/^\d+\.\s*(.+)$/);
            if (stepMatch) {
                const action = this.sanitizeInput(stepMatch[1]);
                steps.push({
                    id: `step_${index}`,
                    action,
                    tool: this.inferTool(action),
                    params: {},
                    status: 'pending'
                });
            }
        });

        return {
            taskId: this.sanitizeInput(taskId),
            steps,
            estimatedTime: Math.min(steps.length * 30, 1800), // Max 30 min
            requiredApprovals: []
        };
    }

    private inferTool(action: string): string {
        if (action.includes('file') || action.includes('create') || action.includes('write')) return 'file';
        if (action.includes('code') || action.includes('implement')) return 'code';
        if (action.includes('test')) return 'test';
        if (action.includes('project') || action.includes('setup') || action.includes('build')) return 'project';
        if (action.includes('analyze') || action.includes('git') || action.includes('commit')) return 'project';
        return 'code';
    }

    async executeWorkflow(plan: WorkflowPlan, progressCallback?: (progress: number, step: string) => void): Promise<AgentResult> {
        const task = this.activeTasks.get(plan.taskId);
        if (task) {
            task.status = 'executing';
        }

        const wrappedCallback = progressCallback ? (progress: number, step: string) => {
            progressCallback(progress, step);
            if (task) (task as any).progress = { current: progress, step };
        } : undefined;

        return await this.workflowExecutor.executeWorkflow(plan, task?.context || {});
    }

    getTaskStatus(taskId: string): AgentTask | null {
        return this.activeTasks.get(taskId) || null;
    }

    getAllActiveTasks(): AgentTask[] {
        return Array.from(this.activeTasks.values());
    }

    getWorkflowProgress(taskId: string): any {
        const task = this.activeTasks.get(taskId);
        if (!task) return null;

        // Get the last executed plan for this task
        const steps = (task as any).currentSteps || [];
        return this.workflowExecutor.getExecutionProgress(steps);
    }

    async executeComplexWorkflow(description: string, context: any): Promise<AgentResult> {
        const sanitizedDesc = this.sanitizeInput(description);
        const task: AgentTask = {
            id: `complex_${Date.now()}`,
            type: this.inferTaskType(sanitizedDesc),
            description: sanitizedDesc,
            context: this.sanitizeContext(context),
            priority: 'high',
            status: 'pending'
        };

        return await this.executeTask(task);
    }

    private inferTaskType(description: string): 'implement' | 'fix' | 'test' | 'refactor' | 'analyze' {
        const desc = this.sanitizeInput(description).toLowerCase();
        const keywords = {
            implement: ['implement', 'create', 'add', 'build', 'develop', 'write'],
            fix: ['fix', 'error', 'bug', 'issue', 'resolve', 'repair'],
            test: ['test', 'testing', 'spec', 'unit', 'integration'],
            refactor: ['refactor', 'improve', 'optimize', 'clean', 'restructure'],
            analyze: ['analyze', 'review', 'check', 'examine', 'audit']
        };
        
        for (const [type, words] of Object.entries(keywords)) {
            if (words.some(word => desc.includes(word))) {
                return type as 'implement' | 'fix' | 'test' | 'refactor' | 'analyze';
            }
        }
        return 'implement';
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>"'&;\\`$(){}\[\]|]/g, '').substring(0, 500);
    }

    private sanitizeContext(context: any): any {
        if (!context || typeof context !== 'object') return {};
        const sanitized: any = {};
        const allowedKeys = ['language', 'workspacePath', 'files', 'projectType'];
        
        for (const key of allowedKeys) {
            if (context[key]) {
                if (typeof context[key] === 'string') {
                    sanitized[key] = this.sanitizeInput(context[key]);
                } else if (Array.isArray(context[key])) {
                    sanitized[key] = context[key].slice(0, 10).map((item: any) => 
                        typeof item === 'string' ? this.sanitizeInput(item) : item
                    );
                }
            }
        }
        return sanitized;
    }

    private sanitizeTask(task: AgentTask): AgentTask {
        return {
            id: this.sanitizeInput(task.id),
            type: task.type,
            description: this.sanitizeInput(task.description),
            context: this.sanitizeContext(task.context),
            priority: task.priority,
            status: task.status
        };
    }
}