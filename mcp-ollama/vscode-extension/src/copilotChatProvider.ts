import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { AgentCommandHandler } from './agentCommands';
import { presentAgentResult } from './agentReview';
import * as path from 'path';

export class CopilotChatProvider {
    private agentCommands = new AgentCommandHandler();

    constructor(
        private mcpClient: MCPClient,
        private context: vscode.ExtensionContext
    ) {}

    async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        
        const message = request.prompt;
        
        // Handle slash commands
        if (message.startsWith('/')) {
            await this.handleSlashCommand(message, stream, token);
            return;
        }

        // Check for GitHub requests
        if (this.isGitHubRequest(message)) {
            await this.handleGitHubRequest(message, stream, token);
            return;
        }

        // Regular chat interaction
        try {
            stream.progress('Thinking...');
            
            const editor = vscode.window.activeTextEditor;
            let contextCode = '';
            let language = 'text';
            
            if (editor) {
                const selection = editor.selection;
                contextCode = editor.document.getText(selection.isEmpty ? undefined : selection);
                language = editor.document.languageId;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const workspacePath = workspaceFolder?.uri.fsPath;

            const result = await this.mcpClient.callTool('chat_assistant', {
                query: message,
                context: {
                    code: contextCode,
                    language: language,
                    workspacePath: workspacePath,
                    activeFilePath: editor ? editor.document.uri.fsPath : undefined,
                    activeFileName: editor ? path.basename(editor.document.uri.fsPath) : undefined
                },
                language: language,
                workspacePath: workspacePath
            });
            
            const response = result?.response || result || 'No response available';
            stream.markdown(response);
            
        } catch (error) {
            stream.markdown(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleSlashCommand(
        message: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const parts = message.split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ').trim();

        const agentCommands = ['/dev', '/test', '/review', '/docs'];
        if (agentCommands.includes(command)) {
            await this.handleAgentSlashCommand(command, args, stream);
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            stream.markdown('No active editor found');
            return;
        }

        const selection = editor.selection;
        const code = editor.document.getText(selection.isEmpty ? undefined : selection);
        const language = editor.document.languageId;

        if (!code.trim()) {
            stream.markdown('No code selected or available');
            return;
        }

        try {
            stream.progress(`Executing ${command}...`);

            let result: string;
            
            switch (command) {
                case '/fix':
                    result = await this.mcpClient.handleSlashCommand('/fix', code, language);
                    stream.markdown('## Fixed Code\\n\\n```' + language + '\\n' + result + '\\n```');
                    
                    // Offer to apply the fix
                    stream.button({
                        command: 'mcp-ollama.applyFix',
                        title: 'Apply Fix',
                        arguments: [result, selection]
                    });
                    break;

                case '/explain':
                    result = await this.mcpClient.explainCode(code, language);
                    stream.markdown('## Code Explanation\\n\\n' + result);
                    break;

                case '/tests':
                    result = await this.mcpClient.generateTests(code, language);
                    stream.markdown('## Generated Tests\\n\\n```' + language + '\\n' + result + '\\n```');
                    
                    stream.button({
                        command: 'mcp-ollama.createTestFile',
                        title: 'Create Test File',
                        arguments: [result, language]
                    });
                    break;

                case '/doc':
                    result = await this.mcpClient.generateDocs(code, language);
                    stream.markdown('## Generated Documentation\\n\\n' + result);
                    
                    stream.button({
                        command: 'mcp-ollama.insertDocs',
                        title: 'Insert Documentation',
                        arguments: [result, selection]
                    });
                    break;

                case '/optimize':
                    result = await this.mcpClient.handleSlashCommand('/optimize', code, language);
                    stream.markdown('## Optimized Code\\n\\n```' + language + '\\n' + result + '\\n```');
                    break;

                case '/security':
                    result = await this.mcpClient.handleSlashCommand('/security', code, language);
                    stream.markdown('## Security Scan\\n\\n' + result);
                    break;

                case '/translate':
                    const targetLang = (args || 'python').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
                    result = await this.mcpClient.handleSlashCommand(`/translate ${targetLang}`, code, language);
                    const sanitizedResult = result.replace(/[<>"'&]/g, '');
                    stream.markdown(`## Translated to ${targetLang}\\n\\n\`\`\`${targetLang}\\n${sanitizedResult}\\n\`\`\``);
                    break;

                default:
                    stream.markdown(`Unknown command: ${command}\n\n**Code commands** (need selection):\n- /fix · /explain · /tests · /doc · /optimize · /security · /translate\n\n**Agent commands** (edit real files with preview):\n- /dev [task] — implement or fix\n- /test [task] — generate tests\n- /review [task] — analyze code\n- /docs [task] — documentation`);
            }

        } catch (error) {
            const sanitizedCommand = command.replace(/[<>"'&`*_\[\]]/g, '');
            const sanitizedError = error instanceof Error ? error.message.replace(/[<>"'&`*_\[\]]/g, '') : 'Unknown error';
            stream.markdown(`Error executing ${sanitizedCommand}: ${sanitizedError}`);
        }
    }

    private async handleAgentSlashCommand(
        command: string,
        args: string,
        stream: vscode.ChatResponseStream
    ): Promise<void> {
        if (!args) {
            stream.markdown(`Usage: \`${command} <task description>\`\n\nExample:\n\`${command} Add a comment above embed() in mcp-ollama/src/indexing/EmbeddingService.ts\``);
            return;
        }

        const workspacePath =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
            vscode.workspace.rootPath ??
            process.cwd();

        const cmd = command.replace('/', '');
        stream.progress(`Agent running /${cmd}…`);

        try {
            const result = await this.agentCommands.executeCommand(cmd, args, {
                workspacePath,
            });
            const markdown = presentAgentResult(this.context, result, workspacePath);
            stream.markdown(`## 🤖 Agent: /${cmd}\n\n${markdown}`);

            stream.button({
                command: 'mcp-ollama.reviewAgentChanges',
                title: 'Review Agent Changes',
            });
        } catch (error) {
            stream.markdown(
                `❌ Agent /${cmd} failed: ${error instanceof Error ? error.message : String(error)}\n\nEnsure MCP server is running (\`cd mcp-ollama && npm start\`).`
            );
        }
    }

    // Register additional commands for chat buttons
    static registerChatCommands(context: vscode.ExtensionContext, mcpClient: MCPClient) {
        const commands = [
            vscode.commands.registerCommand('mcp-ollama.applyFix', this.createEditorCommand((editor, editBuilder, fixedCode, selection) => {
                editBuilder.replace(selection, fixedCode);
            })),

            vscode.commands.registerCommand('mcp-ollama.createTestFile', this.createDocumentCommand()),

            vscode.commands.registerCommand('mcp-ollama.insertDocs', this.createEditorCommand((editor, editBuilder, docs, selection) => {
                editBuilder.insert(selection.start, docs + '\\n');
            })),

            vscode.commands.registerCommand('mcp-ollama.applyOptimization', this.createEditorCommand((editor, editBuilder, optimizedCode, selection) => {
                editBuilder.replace(selection, optimizedCode);
            })),

            vscode.commands.registerCommand('mcp-ollama.createTranslatedFile', this.createDocumentCommand())
        ];

        context.subscriptions.push(...commands);
    }

    private static createEditorCommand(editAction: (editor: vscode.TextEditor, editBuilder: vscode.TextEditorEdit, ...args: any[]) => void) {
        return async (...args: any[]) => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await editor.edit(editBuilder => editAction(editor, editBuilder, ...args));
            }
        };
    }

    private static createDocumentCommand() {
        return async (content: string, language: string) => {
            const doc = await vscode.workspace.openTextDocument({ content, language });
            await vscode.window.showTextDocument(doc);
        };
    }

    private isGitHubRequest(message: string): boolean {
        const lowerMessage = message.toLowerCase();
        return (
            lowerMessage.includes('github.com') ||
            lowerMessage.includes('get readme') ||
            lowerMessage.includes('fetch file') ||
            lowerMessage.includes('show file') ||
            lowerMessage.includes('get package.json') ||
            lowerMessage.includes('get src/') ||
            lowerMessage.includes('get index.') ||
            lowerMessage.includes('get main.') ||
            lowerMessage.includes('get app.') ||
            (lowerMessage.includes('get') && lowerMessage.includes('file')) ||
            (lowerMessage.includes('show') && lowerMessage.includes('me')) ||
            lowerMessage.includes('repository') ||
            lowerMessage.includes('repo info') ||
            /get\s+[\w\-\/\.]+\.[a-z]+/i.test(message)
        );
    }

    private async handleGitHubRequest(
        message: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            stream.progress('Fetching from GitHub...');
            
            const urlMatch = message.match(/https:\/\/github\.com\/[^\s?]+/);
            if (!urlMatch) {
                stream.markdown('❌ Please provide a valid GitHub repository URL');
                return;
            }
            
            const repoUrl = urlMatch[0].replace(/\?.*$/, '');
            
            // Use smart query to handle all GitHub requests with automatic branch detection
            const result = await this.mcpClient.callTool('github_smart_query', {
                repoUrl,
                query: message,
                context: 'VS Code extension request'
            });
            
            if (result.success) {
                // Handle different types of smart query results
                if (result.type === 'file_content' && result.file) {
                    const lang = this.getLanguageFromExtension(result.file.path);
                    stream.markdown(`# ${result.file.name} (${result.file.branch})\n\n\`\`\`${lang}\n${result.file.content}\n\`\`\``);
                } else if (result.type === 'readme_search' && result.file) {
                    stream.markdown(`# README (${result.file.branch})\n\n${result.file.content}`);
                } else if (result.repository) {
                    const repo = result.repository;
                    stream.markdown(`# ${repo.name}\n\n**Description:** ${repo.description || 'No description'}\n**Language:** ${repo.language}\n**Stars:** ${repo.stars}\n**Default Branch:** ${repo.defaultBranch}\n**Owner:** ${repo.owner.login}`);
                } else {
                    stream.markdown(`# GitHub Query Result\n\n${JSON.stringify(result, null, 2)}`);
                }
            } else {
                stream.markdown(`❌ GitHub request failed: ${result.error}`);
            }
            
        } catch (error) {
            stream.markdown(`❌ GitHub request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private getLanguageFromExtension(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const langMap = new Map<string, string>([
            ['js', 'javascript'],
            ['ts', 'typescript'],
            ['py', 'python'],
            ['java', 'java'],
            ['cpp', 'cpp'],
            ['c', 'c'],
            ['cs', 'csharp'],
            ['php', 'php'],
            ['rb', 'ruby'],
            ['go', 'go'],
            ['rs', 'rust'],
            ['swift', 'swift'],
            ['kt', 'kotlin'],
            ['scala', 'scala'],
            ['sh', 'bash'],
            ['yml', 'yaml'],
            ['yaml', 'yaml'],
            ['json', 'json'],
            ['xml', 'xml'],
            ['html', 'html'],
            ['css', 'css'],
            ['md', 'markdown']
        ]);
        return langMap.get(ext || '') || 'text';
    }
}