import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { resolveAgentFiles } from './resolveAgentFiles';

export interface AgentCommand {
    command: string;
    description: string;
    icon: string;
    handler: (args: string, context: any) => Promise<any>;
}

export class AgentCommandHandler {
    private mcpClient: MCPClient;
    private outputChannel: vscode.OutputChannel;

    constructor(mcpClient?: MCPClient) {
        this.mcpClient = mcpClient ?? new MCPClient();
        this.outputChannel = vscode.window.createOutputChannel('Agent Commands');
    }

    private commands: AgentCommand[] = [
        {
            command: 'dev',
            description: 'Development tasks - implement features, fix bugs',
            icon: '🚀',
            handler: this.handleDevCommand.bind(this)
        },
        {
            command: 'test',
            description: 'Generate and run tests',
            icon: '🧪',
            handler: this.handleTestCommand.bind(this)
        },
        {
            command: 'review',
            description: 'Code review and analysis',
            icon: '👀',
            handler: this.handleReviewCommand.bind(this)
        },
        {
            command: 'docs',
            description: 'Generate documentation',
            icon: '📝',
            handler: this.handleDocsCommand.bind(this)
        },
        {
            command: 'suggest',
            description: 'Get project-wide architectural and quality suggestions',
            icon: '💡',
            handler: this.handleSuggestCommand.bind(this)
        }
    ];

    parseCommand(input: string): { command: string; args: string } | null {
        const match = input.match(/^\/(\w+)(?:\s+(.+))?$/);
        if (!match) return null;
        
        const [, command, args] = match;
        return this.commands.find(cmd => cmd.command === command) 
            ? { command, args: args || '' } 
            : null;
    }

    async executeCommand(command: string, args: string, context: any): Promise<any> {
        const cmd = this.commands.find(c => c.command === command);
        if (!cmd) throw new Error(`Unknown command: /${command}`);
        
        this.outputChannel.appendLine(`Executing /${command}: ${args}`);
        return await cmd.handler(args, context);
    }

    private async handleDevCommand(args: string, context: any): Promise<any> {
        try {
            await this.mcpClient.connect();
            
            const workspacePath = this.getWorkspacePath();
            const files = await resolveAgentFiles(args, workspacePath);

            const task = {
                type: 'implement',
                description: args,
                taskId: context?.taskId,
                context: {
                    workspacePath,
                    language: this.detectLanguage(),
                    ...(files.length > 0 ? { files } : {}),
                    previewChanges: true,
                    verify: true,
                }
            };

            return await this.mcpClient.executeAgentTask(task);
        } catch (error) {
            throw new Error(`Dev command failed: ${error}`);
        }
    }

    private async handleTestCommand(args: string, context: any): Promise<any> {
        try {
            await this.mcpClient.connect();
            
            const workspacePath = this.getWorkspacePath();
            const files = await resolveAgentFiles(args, workspacePath);

            const task = {
                type: 'test',
                description: args,
                taskId: context?.taskId,
                context: {
                    workspacePath,
                    language: this.detectLanguage(),
                    ...(files.length > 0 ? { files } : {}),
                    previewChanges: true,
                    verify: true,
                }
            };

            return await this.mcpClient.executeAgentTask(task);
        } catch (error) {
            throw new Error(`Test command failed: ${error}`);
        }
    }

    private async handleReviewCommand(args: string, context: any): Promise<any> {
        try {
            await this.mcpClient.connect();
            
            const workspacePath = this.getWorkspacePath();
            const files = await resolveAgentFiles(args, workspacePath);

            const task = {
                type: 'analyze',
                description: args,
                taskId: context?.taskId,
                context: {
                    workspacePath,
                    language: this.detectLanguage(),
                    ...(files.length > 0 ? { files } : {}),
                    previewChanges: true,
                    verify: false,
                }
            };

            return await this.mcpClient.executeAgentTask(task);
        } catch (error) {
            throw new Error(`Review command failed: ${error}`);
        }
    }

    private async handleDocsCommand(args: string, context: any): Promise<any> {
        try {
            await this.mcpClient.connect();
            
            const response = await this.mcpClient.handleSlashCommandWithModel(
                '/docs', 
                args, 
                'documentation', 
                'deepseek-coder-v2:236b'
            );

            return { description: 'Documentation generated', content: response };
        } catch (error) {
            throw new Error(`Docs command failed: ${error}`);
        }
    }

    private async handleSuggestCommand(args: string, context: any): Promise<any> {
        try {
            await this.mcpClient.connect();
            
            const workspacePath = this.getWorkspacePath();
            const response = await this.mcpClient.callTool('project_suggestions', {
                workspacePath,
                query: args,
                focus: 'all'
            });

            return { summary: response.summary, success: response.success };
        } catch (error) {
            throw new Error(`Suggest command failed: ${error}`);
        }
    }

    private getWorkspacePath(): string {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder?.uri.fsPath ?? vscode.workspace.rootPath ?? process.cwd();
    }

    private detectLanguage(): string {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return 'typescript';
        
        const languageId = activeEditor.document.languageId;
        return languageId || 'typescript';
    }

    getAvailableCommands(): AgentCommand[] {
        return this.commands;
    }
}
