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

        const description = params.description.toLowerCase();

        // Must have both an action verb AND a code/project noun to be considered a real agent task.
        // This prevents conversational questions containing action words from becoming agent tasks.
        const actionVerbs = ['implement', 'build', 'setup', 'generate', 'create', 'add', 'write'];
        const codeNouns = [
            'api', 'endpoint', 'service', 'component', 'module', 'class', 'function',
            'test', 'authentication', 'auth', 'database', 'schema', 'project', 'app',
            'server', 'route', 'controller', 'middleware', 'interface', 'type'
        ];

        const hasVerb = actionVerbs.some(v => description.includes(v));
        const hasNoun = codeNouns.some(n => description.includes(n));
        return hasVerb && hasNoun;
    }

    private async handleSimpleRequest(toolName: string, params: any): Promise<string> {
        this.logger.info(`[RequestRouter] Processing simple request: ${toolName}`);
        
        // All tool calls go through handleGenericRequest so the response
        // is always a plain string — no unwrapping needed in MCPServer.
        switch (toolName) {
            case 'explain_code':
                return await this.ollamaProvider.explainCode(params.code, params.language);
            case 'fix_code':
                return await this.ollamaProvider.fixCode(params.code, params.language);
            case 'generate_tests':
                return await this.ollamaProvider.generateTests(params.code, params.language);
            default:
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

        // Only escalate explicit multi-step implementation requests, not conversational questions.
        const agentTriggers = [
            'implement a', 'implement the', 'build me a', 'create a working',
            'generate complete', 'create api with', 'full implementation',
            'setup authentication', 'add tests and'
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