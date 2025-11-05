import { Logger } from '../utils/Logger.js';
import { AgentManager } from '../agents/AgentManager.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';

export class RequestRouter {
    private logger: Logger;
    private agentManager: AgentManager;
    private ollamaProvider: OllamaProvider;

    constructor(agentManager: AgentManager, ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.agentManager = agentManager;
        this.ollamaProvider = ollamaProvider;
    }

    async routeRequest(toolName: string, params: any): Promise<any> {
        const requestType = this.classifyRequest(toolName, params);
        
        switch (requestType) {
            case 'SIMPLE':
                return await this.handleSimpleRequest(toolName, params);
            case 'AGENT':
                return await this.handleAgentRequest(toolName, params);
            case 'CHAT':
                return await this.handleChatRequest(toolName, params);
            default:
                return await this.handleSimpleRequest(toolName, params);
        }
    }

    private classifyRequest(toolName: string, params: any): 'SIMPLE' | 'AGENT' | 'CHAT' {
        // Agent requests - complex multi-step tasks
        if (toolName.startsWith('agent_') || this.isComplexTask(params)) {
            return 'AGENT';
        }
        
        // Chat requests - conversational
        if (toolName === 'slash_command' || toolName === 'chat_assistant') {
            return 'CHAT';
        }
        
        // Simple requests - direct AI calls
        return 'SIMPLE';
    }

    private isComplexTask(params: any): boolean {
        if (!params.description) return false;
        
        const complexKeywords = [
            'create', 'implement', 'build', 'setup', 'generate tests',
            'add authentication', 'create api', 'setup project'
        ];
        
        const description = params.description.toLowerCase();
        return complexKeywords.some(keyword => description.includes(keyword));
    }

    private async handleSimpleRequest(toolName: string, params: any): Promise<string> {
        this.logger.info(`[RequestRouter] Processing simple request: ${toolName}`);
        console.log(`[RequestRouter] Routing ${toolName} to OllamaProvider`);
        
        // Direct AI call for simple tasks - all return strings
        switch (toolName) {
            case 'explain_code':
                console.log(`[RequestRouter] Calling explainCode for ${params.language}`);
                return await this.ollamaProvider.explainCode(params.code, params.language);
            case 'fix_code':
                console.log(`[RequestRouter] Calling fixCode for ${params.language}`);
                return await this.ollamaProvider.fixCode(params.code, params.language);
            case 'generate_tests':
                console.log(`[RequestRouter] Calling generateTests for ${params.language}`);
                return await this.ollamaProvider.generateTests(params.code, params.language);
            default:
                console.log(`[RequestRouter] Calling handleGenericRequest for ${toolName}`);
                return await this.ollamaProvider.handleGenericRequest(toolName, params);
        }
    }

    private async handleAgentRequest(toolName: string, params: any): Promise<any> {
        this.logger.info(`Agent request: ${toolName}`);
        
        // Convert to agent task
        const task = {
            id: `task_${Date.now()}`,
            type: this.inferTaskType(params),
            description: params.description || `Execute ${toolName}`,
            context: params.context || {},
            priority: 'medium' as const,
            status: 'pending' as const
        };
        
        return await this.agentManager.executeTask(task);
    }

    private async handleChatRequest(toolName: string, params: any): Promise<string> {
        this.logger.info(`Chat request: ${toolName}`);
        
        // Check if chat request should become agent task
        if (this.shouldEscalateToAgent(params)) {
            const agentResult = await this.handleAgentRequest(toolName, params);
            // Extract text from agent result if it's an object
            if (typeof agentResult === 'object' && agentResult.summary) {
                return agentResult.summary;
            }
            return String(agentResult);
        }
        
        // Handle as simple chat - returns string
        return await this.ollamaProvider.handleChatRequest(params);
    }

    private shouldEscalateToAgent(params: any): boolean {
        if (!params.query && !params.command) return false;
        
        const text = (params.query || params.command || '').toLowerCase();
        const agentTriggers = [
            'create a', 'implement', 'build me', 'setup', 'generate complete',
            'add tests and', 'create api with', 'full implementation'
        ];
        
        return agentTriggers.some(trigger => text.includes(trigger));
    }

    private inferTaskType(params: any): 'implement' | 'fix' | 'test' | 'refactor' | 'analyze' {
        const description = (params.description || '').toLowerCase();
        
        if (description.includes('fix') || description.includes('error')) return 'fix';
        if (description.includes('test')) return 'test';
        if (description.includes('refactor') || description.includes('improve')) return 'refactor';
        if (description.includes('analyze')) return 'analyze';
        return 'implement';
    }
}