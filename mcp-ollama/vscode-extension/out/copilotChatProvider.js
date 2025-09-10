"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotChatProvider = void 0;
const vscode = require("vscode");
class CopilotChatProvider {
    constructor(mcpClient) {
        this.mcpClient = mcpClient;
    }
    async handleChatRequest(request, context, stream, token) {
        const message = request.prompt;
        // Handle slash commands
        if (message.startsWith('/')) {
            await this.handleSlashCommand(message, stream, token);
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
            const result = await this.mcpClient.handleSlashCommand('chat', message, language);
            stream.markdown(result || 'No response available');
        }
        catch (error) {
            stream.markdown(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleSlashCommand(message, stream, token) {
        const parts = message.split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');
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
            let result;
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
                    stream.markdown(`Unknown command: ${command}\\n\\nAvailable commands:\\n- /fix - Fix code issues\\n- /explain - Explain code\\n- /tests - Generate tests\\n- /doc - Generate documentation\\n- /optimize - Optimize performance\\n- /security - Security scan\\n- /translate [language] - Translate code`);
            }
        }
        catch (error) {
            const sanitizedCommand = command.replace(/[<>"'&`*_\[\]]/g, '');
            const sanitizedError = error instanceof Error ? error.message.replace(/[<>"'&`*_\[\]]/g, '') : 'Unknown error';
            stream.markdown(`Error executing ${sanitizedCommand}: ${sanitizedError}`);
        }
    }
    // Register additional commands for chat buttons
    static registerChatCommands(context, mcpClient) {
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
    static createEditorCommand(editAction) {
        return async (...args) => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await editor.edit(editBuilder => editAction(editor, editBuilder, ...args));
            }
        };
    }
    static createDocumentCommand() {
        return async (content, language) => {
            const doc = await vscode.workspace.openTextDocument({ content, language });
            await vscode.window.showTextDocument(doc);
        };
    }
}
exports.CopilotChatProvider = CopilotChatProvider;
//# sourceMappingURL=copilotChatProvider.js.map