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
import { AutonomousAgent } from './AutonomousAgent.js';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import { VectorStore } from '../semantic/VectorStore.js';

export class AgentManager {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private agents: Map<string, any>;
    private activeTasks: Map<string, AgentTask>;
    private workflowExecutor: WorkflowExecutor;
    private autonomousAgent: AutonomousAgent;
    private enhancedContext: EnhancedContextManager;
    private vectorStore: VectorStore;
    private conversationHistory: string[] = [];

    constructor(ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = new FileSystemTool();
        this.agents = new Map();
        this.activeTasks = new Map();
        
        this.initializeAgents();
        this.workflowExecutor = new WorkflowExecutor(this.agents);
        this.autonomousAgent = new AutonomousAgent(this.ollamaProvider, this.fileSystemTool, this.agents);
        this.enhancedContext = new EnhancedContextManager();
        this.vectorStore = new VectorStore();
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

    // Autonomous task management
    getAutonomousTaskStatus(taskId: string): any {
        return this.getTaskStatus(taskId);
    }

    getAllAutonomousTasks(): any[] {
        return this.getAllActiveTasks().filter(task => task.id.startsWith('auto_'));
    }

    async executeComplexWorkflow(description: string, context: any): Promise<AgentResult> {
        const sanitizedDesc = this.sanitizeInput(description);
        
        // Enable autonomous mode for complex workflows
        if (context.autonomous !== false) {
            return await this.executeAutonomously(sanitizedDesc, context);
        }
        
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

    // ENHANCED AUTONOMOUS EXECUTION WITH INTEGRATED NLP & SEMANTICS
    async executeAutonomously(description: string, context: any): Promise<AgentResult> {
        const taskId = `auto_${Date.now()}`;
        const startTime = Date.now();
        
        try {
            // Use integrated NLP with existing semantic infrastructure
            const semanticAnalysis = await this.enhancedContext.enhanceWithSemanticContext(description, context);
            this.logger.info(`NLP Analysis: ${semanticAnalysis.intent} (confidence: ${semanticAnalysis.confidence})`);
            
            // Execute based on integrated analysis
            if (semanticAnalysis.confidence > 0.7) {
                const result = await this.executeWithIntegratedSemantics(semanticAnalysis, context);
                
                return {
                    taskId,
                    success: result.success,
                    steps: result.steps || [{ 
                        id: 'integrated_nlp_step', 
                        action: semanticAnalysis.intent, 
                        tool: this.selectToolForIntent(semanticAnalysis.intent), 
                        params: { target: semanticAnalysis.target }, 
                        status: result.success ? 'completed' : 'failed' 
                    }],
                    summary: result.summary || `${semanticAnalysis.intent}: ${semanticAnalysis.target}`,
                    filesModified: result.filesModified || [],
                    executionTime: Date.now() - startTime
                };
            } else {
                return await this.executeFallback(description, context, taskId, startTime);
            }
        } catch (error) {
            this.logger.error('Integrated NLP execution failed:', error);
            return {
                taskId,
                success: false,
                steps: [{ id: 'error_step', action: description, tool: 'unknown', params: {}, status: 'failed' }],
                summary: `Failed: ${description}`,
                filesModified: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                executionTime: Date.now() - startTime
            };
        }
    }

    private async executeWithIntegratedSemantics(analysis: any, context: any): Promise<any> {
        const { intent, target, semanticMatches, similarCode } = analysis;
        
        // Enhanced context with integrated NLP and semantic data
        const enhancedContext = {
            ...context,
            semanticMatches,
            similarCode,
            nlpAnalysis: analysis
        };
        
        switch (intent) {
            case 'create_directory':
                return await this.executeCreateDirectory(target, enhancedContext);
            
            case 'create_file':
                return await this.executeCreateFile(target, enhancedContext);
            
            case 'implement_feature':
                return await this.executeImplementFeature(target, enhancedContext);
            
            case 'fix_code':
                return await this.executeFixCode(target, enhancedContext);
            
            case 'generate_tests':
                return await this.executeGenerateTests(target, enhancedContext);
            
            default:
                return await this.executeFallback(target || 'unknown task', enhancedContext, 'unknown', Date.now());
        }
    }
    
    private async executeCreateDirectory(dirName: string, context: any): Promise<any> {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const fullPath = path.resolve(dirName);
            
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                return {
                    success: true,
                    summary: `Created directory: ${dirName}`,
                    filesModified: [fullPath],
                    steps: [{
                        id: 'create_dir',
                        action: 'create_directory',
                        tool: 'file',
                        params: { path: fullPath },
                        status: 'completed'
                    }]
                };
            } else {
                return {
                    success: true,
                    summary: `Directory already exists: ${dirName}`,
                    filesModified: [],
                    steps: [{
                        id: 'check_dir',
                        action: 'check_directory',
                        tool: 'file',
                        params: { path: fullPath },
                        status: 'completed'
                    }]
                };
            }
        } catch (error) {
            return {
                success: false,
                summary: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filesModified: [],
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    private async executeCreateFile(fileName: string, context: any): Promise<any> {
        const agent = this.agents.get('file');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'create_file',
                params: { fileName, content: '' },
                context
            });
        }
        return { success: false, summary: 'File agent not available' };
    }
    
    private async executeImplementFeature(feature: string, context: any): Promise<any> {
        const agent = this.agents.get('code');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'implement_feature',
                params: { feature, language: context.language || 'typescript' },
                context
            });
        }
        return { success: false, summary: 'Code agent not available' };
    }
    
    private async executeFixCode(issue: string, context: any): Promise<any> {
        const agent = this.agents.get('code');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'fix_code',
                params: { issue, language: context.language || 'typescript' },
                context
            });
        }
        return { success: false, summary: 'Code agent not available' };
    }
    
    private async executeGenerateTests(target: string, context: any): Promise<any> {
        const agent = this.agents.get('test');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'generate_tests',
                params: { target, language: context.language || 'typescript' },
                context
            });
        }
        return { success: false, summary: 'Test agent not available' };
    }
    
    private selectToolForIntent(action: string): string {
        const toolMap: Record<string, string> = {
            'create_directory': 'file',
            'create_file': 'file',
            'implement_feature': 'code',
            'fix_code': 'code',
            'generate_tests': 'test'
        };
        return toolMap[action] || 'code';
    }
    
    private async executeFallback(description: string, context: any, taskId: string, startTime: number): Promise<any> {
        // Original fast execution as fallback
        const agent = this.agents.get('code');
        if (agent && agent.execute) {
            const result = await agent.execute({
                action: description,
                params: { language: context.language || 'typescript' },
                context
            });
            return {
                success: true,
                summary: `Completed: ${description}`,
                filesModified: result.filesModified || [],
                steps: [{ id: 'fallback_step', action: description, tool: 'code', params: {}, status: 'completed' }]
            };
        }
        
        return {
            success: false,
            summary: `Failed: ${description}`,
            filesModified: [],
            error: 'No suitable agent available'
        };
    }

    private async analyzeIntentAndContext(description: string, context: any): Promise<any> {
        // Fast intent analysis without AI call for better performance
        return {
            ...context,
            intent: this.inferTaskType(description),
            tools: ['code'],
            riskLevel: 'low',
            successCriteria: ['Task completed'],
            challenges: []
        };
    }

    private async createAutonomousPlan(description: string, context: any): Promise<any> {
        // Simple plan without AI generation for speed
        return {
            steps: [{
                id: 'auto_step_1',
                action: description,
                tool: 'code',
                validation: 'Task completed successfully',
                rollback: 'Revert changes if needed'
            }]
        };
    }

    private async executeWithSelfCorrection(plan: any, context: any): Promise<any> {
        const startTime = Date.now();
        const results = {
            success: true,
            steps: [] as any[],
            summary: '',
            filesModified: [] as string[],
            executionTime: 0
        };
        
        for (const step of plan.steps || []) {
            let attempts = 0;
            const maxAttempts = 3;
            let stepSuccess = false;
            
            while (attempts < maxAttempts && !stepSuccess) {
                try {
                    // Execute step using appropriate agent
                    const agent = this.agents.get(step.tool) || this.agents.get('code');
                    const stepResult = await this.executeStepWithAgent(agent, step, context);
                    
                    // Validate step result
                    const isValid = await this.validateStepResult(step, stepResult);
                    
                    if (isValid) {
                        results.steps.push({
                            id: step.id,
                            action: step.action,
                            success: true,
                            result: stepResult,
                            attempts: attempts + 1
                        });
                        stepSuccess = true;
                        
                        if (stepResult.filesModified) {
                            results.filesModified.push(...stepResult.filesModified);
                        }
                    } else {
                        // Self-correction: modify step parameters
                        step.params = await this.generateStepCorrection(step, stepResult);
                        attempts++;
                    }
                } catch (error) {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        results.steps.push({
                            id: step.id,
                            action: step.action,
                            success: false,
                            error: error instanceof Error ? error.message : 'Unknown error',
                            attempts
                        });
                        results.success = false;
                    }
                }
            }
        }
        
        results.executionTime = Date.now() - startTime;
        results.summary = `Autonomous execution completed. ${results.steps.filter(s => s.success).length}/${results.steps.length} steps successful.`;
        
        return results;
    }

    private async executeStepWithAgent(agent: any, step: any, context: any): Promise<any> {
        if (!agent || !agent.execute) {
            throw new Error(`Agent for tool ${step.tool} not available`);
        }
        
        return await agent.execute({
            action: step.action,
            params: step.params || {},
            context
        });
    }

    private async validateStepResult(step: any, result: any): Promise<boolean> {
        if (!result || result.error) return false;
        
        const prompt = `Validate step execution:

Step: ${step.action}
Expected: ${step.validation}
Actual Result: ${JSON.stringify(result)}

Is this step successful? Return only true or false.`;
        
        const response = await this.ollamaProvider.generateText({
            prompt,
            model: 'llama3.1:8b-instruct-q4_K_M'
        });
        
        return response.toLowerCase().includes('true');
    }

    private async generateStepCorrection(step: any, failedResult: any): Promise<any> {
        const prompt = `Generate correction for failed step:

Step: ${step.action}
Failed Result: ${JSON.stringify(failedResult)}
Original Params: ${JSON.stringify(step.params)}

Provide corrected parameters as JSON.`;
        
        const response = await this.ollamaProvider.generateText({
            prompt,
            model: 'deepseek-coder-v2:236b'
        });
        
        try {
            return JSON.parse(response);
        } catch {
            return step.params || {};
        }
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