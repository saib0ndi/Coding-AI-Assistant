import { Logger } from '../utils/Logger.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AgentTask, WorkflowPlan, WorkflowStep, AgentResult } from '../types/agent.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { CodeAgent } from './CodeAgent.js';
import { FileAgent } from './FileAgent.js';
import { ProjectAgent } from './ProjectAgent.js';
import { TestAgent } from './TestAgent.js';
import { AutonomousAgent } from './AutonomousAgent.js';

export class EnhancedAgentManager {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private agents: Map<string, any>;
    private autonomousAgent: AutonomousAgent;

    constructor(ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = new FileSystemTool();
        this.agents = new Map();
        
        this.initializeAgents();
        this.autonomousAgent = new AutonomousAgent(this.ollamaProvider, this.fileSystemTool, this.agents);
    }

    private initializeAgents(): void {
        this.agents.set('code', new CodeAgent(this.ollamaProvider, this.fileSystemTool));
        this.agents.set('file', new FileAgent(this.fileSystemTool));
        this.agents.set('project', new ProjectAgent(this.ollamaProvider, this.fileSystemTool));
        this.agents.set('test', new TestAgent(this.ollamaProvider, this.fileSystemTool));
    }

    // Amazon Q-style autonomous execution
    async executeAutonomously(description: string, context: any): Promise<AgentResult> {
        this.logger.info(`Starting autonomous execution: ${description}`);
        return await this.autonomousAgent.executeAutonomously(description, context);
    }

    // Task management
    getAutonomousTaskStatus(taskId: string): any {
        return this.autonomousAgent.getTask(taskId);
    }

    getAllAutonomousTasks(): any[] {
        return this.autonomousAgent.getAllTasks();
    }

    async pauseAutonomousTask(taskId: string): Promise<boolean> {
        return await this.autonomousAgent.pauseTask(taskId);
    }

    async resumeAutonomousTask(taskId: string): Promise<boolean> {
        return await this.autonomousAgent.resumeTask(taskId);
    }

    async cancelAutonomousTask(taskId: string): Promise<boolean> {
        return await this.autonomousAgent.cancelTask(taskId);
    }

    // Capabilities and stats
    getAutonomousCapabilities(): any {
        return this.autonomousAgent.getCapabilities();
    }

    getAutonomousStats(): any {
        const allTasks = this.getAllAutonomousTasks();
        const completedTasks = allTasks.filter(task => task.status === 'completed');
        const failedTasks = allTasks.filter(task => task.status === 'failed');
        const activeTasks = allTasks.filter(task => 
            ['analyzing', 'planning', 'executing', 'validating'].includes(task.status)
        );

        return {
            totalAutonomousTasks: allTasks.length,
            completed: completedTasks.length,
            failed: failedTasks.length,
            active: activeTasks.length,
            paused: allTasks.filter(task => task.status === 'paused').length,
            successRate: allTasks.length > 0 ? 
                (completedTasks.length / allTasks.length) * 100 : 0,
            capabilities: this.getAutonomousCapabilities()
        };
    }

    // Direct agent access
    getAgent(agentType: string): any {
        return this.agents.get(agentType);
    }

    // Execute with specific agent
    async executeWithAgent(agentType: string, action: string, params: any): Promise<any> {
        const agent = this.agents.get(agentType);
        if (!agent) {
            throw new Error(`Agent ${agentType} not found`);
        }

        if (agent.execute) {
            return await agent.execute({ action, params, context: params });
        }

        throw new Error(`Agent ${agentType} does not support execution`);
    }
}