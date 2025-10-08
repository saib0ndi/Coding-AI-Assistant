import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';

export interface AgentCommand {
    command: string;
    description: string;
    icon: string;
    handler: (args: string, context: any) => Promise<any>;
}

export class AgentCommandHandler {
    private mcpClient: MCPClient;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.mcpClient = new MCPClient();
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
        }
    ];

    parseCommand(input: string): { command: string; args: string } | null {
        const match = input.match(/^\/(\w+)\s+(.+)$/);
        if (!match) return null;
        
        const [, command, args] = match;
        return this.commands.find(cmd => cmd.command === command) 
            ? { command, args } 
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
            
            const task = {
                type: 'implement',
                description: args,
                context: {
                    workspacePath: vscode.workspace.rootPath,
                    language: this.detectLanguage(),
                    files: await this.getRelevantFiles()
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
            
            const task = {
                type: 'test',
                description: args,
                context: {
                    workspacePath: vscode.workspace.rootPath,
                    language: this.detectLanguage(),
                    files: await this.getRelevantFiles()
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
            
            const task = {
                type: 'analyze',
                description: args,
                context: {
                    workspacePath: vscode.workspace.rootPath,
                    language: this.detectLanguage(),
                    files: await this.getRelevantFiles()
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

    private detectLanguage(): string {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return 'typescript';
        
        const languageId = activeEditor.document.languageId;
        return languageId || 'typescript';
    }

    private async getRelevantFiles(): Promise<string[]> {
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,go,rs}', '**/node_modules/**', 50);
        return files.map(f => f.fsPath);
    }

    getAvailableCommands(): AgentCommand[] {
        return this.commands;
    }
}