import * as vscode from 'vscode';
import { getPendingAgentChanges, openAgentReviewPanel } from '../agentReview';
import type { CommandServices } from './types';

export function registerCoreCommands(
    context: vscode.ExtensionContext,
    services: CommandServices
): vscode.Disposable[] {
    const {
        suggestionProvider,
        chatUI,
        telemetryManager,
        multiLineGenerator,
        astParser,
        outputChannel,
        mcpClient,
        inlineCompletionProvider,
        chatProvider,
    } = services;

    return [
        vscode.commands.registerCommand('mcp-ollama.reviewAgentChanges', () => {
            const pending = getPendingAgentChanges();
            if (pending.length === 0) {
                void vscode.window.showInformationMessage(
                    'No pending agent changes. Run /dev, /test, or toggle 🤖 Agent mode in chat first.'
                );
                return;
            }
            openAgentReviewPanel(context, pending);
        }),

        vscode.commands.registerCommand('mcp-ollama.enable', async () => {
            try {
                await vscode.workspace.getConfiguration('mcp-ollama').update('enabled', true, true);
                vscode.window.showInformationMessage('MCP-Ollama Copilot enabled');
                outputChannel.appendLine('Extension enabled');
            } catch (error) {
                const errorMsg = 'Failed to enable MCP-Ollama Copilot';
                vscode.window.showErrorMessage(errorMsg);
                outputChannel.appendLine(`Error: ${errorMsg} - ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.disable', async () => {
            try {
                await vscode.workspace.getConfiguration('mcp-ollama').update('enabled', false, true);
                vscode.window.showInformationMessage('MCP-Ollama Copilot disabled');
                outputChannel.appendLine('Extension disabled');
            } catch (error) {
                const errorMsg = 'Failed to disable MCP-Ollama Copilot';
                vscode.window.showErrorMessage(errorMsg);
                outputChannel.appendLine(`Error: ${errorMsg} - ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.nextSuggestion', () => {
            try {
                suggestionProvider?.nextSuggestion();
            } catch (error) {
                outputChannel.appendLine(`Error in nextSuggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.previousSuggestion', () => {
            try {
                suggestionProvider?.previousSuggestion();
            } catch (error) {
                outputChannel.appendLine(`Error in previousSuggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.alternatives', () => {
            try {
                suggestionProvider?.showAlternatives();
            } catch (error) {
                outputChannel.appendLine(`Error in showAlternatives: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.acceptSuggestion', () => {
            try {
                suggestionProvider?.acceptSuggestion();
            } catch (error) {
                outputChannel.appendLine(`Error in acceptSuggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.showChatPanel', () => {
            try {
                if (chatUI) {
                    chatUI.show();
                    vscode.window.showInformationMessage('Chat panel opened!');
                } else {
                    vscode.window.showErrorMessage('Extension not properly initialized');
                }
            } catch {
                vscode.window.showErrorMessage('Failed to show chat panel');
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.showLogs', () => {
            outputChannel.show();
        }),

        vscode.commands.registerCommand('mcp-ollama.status', () => {
            const status = {
                mcpClient: mcpClient ? 'initialized' : 'not initialized',
                suggestionProvider: suggestionProvider ? 'initialized' : 'not initialized',
                inlineCompletionProvider: inlineCompletionProvider ? 'initialized' : 'not initialized',
                chatProvider: chatProvider ? 'initialized' : 'not initialized',
                chatUI: chatUI ? 'initialized' : 'not initialized',
                telemetryManager: telemetryManager ? 'initialized' : 'not initialized',
            };

            const statusMessage = Object.entries(status)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n');

            vscode.window.showInformationMessage('Extension Status', { modal: true, detail: statusMessage });
        }),

        vscode.commands.registerCommand('mcp-ollama.showStats', () => {
            if (telemetryManager) {
                telemetryManager.showStats();
            } else {
                vscode.window.showErrorMessage('Telemetry manager not initialized');
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.logAcceptance', (_completion: string, position: vscode.Position) => {
            if (telemetryManager) {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    telemetryManager.recordEvent('accept',
                        telemetryManager.generateSuggestionId(),
                        editor.document.languageId,
                        {
                            lineLength: editor.document.lineAt(position.line).text.length,
                            fileType: editor.document.fileName.split('.').pop() || 'unknown',
                            triggerKind: 'inline',
                        }
                    );
                }
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.generateFunction', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !multiLineGenerator) return;

            const signature = await vscode.window.showInputBox({
                prompt: 'Enter function signature',
                placeHolder: 'function myFunction(param1, param2)',
            });

            if (signature) {
                const code = await multiLineGenerator.generateFunction(editor.document, editor.selection.active, signature);
                if (code) {
                    await editor.edit(editBuilder => {
                        editBuilder.insert(editor.selection.active, code);
                    });
                }
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.generateClass', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !multiLineGenerator) return;

            const className = await vscode.window.showInputBox({
                prompt: 'Enter class name',
                placeHolder: 'MyClass',
            });

            if (className) {
                const code = await multiLineGenerator.generateClass(editor.document, editor.selection.active, className);
                if (code) {
                    await editor.edit(editBuilder => {
                        editBuilder.insert(editor.selection.active, code);
                    });
                }
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.analyzeAST', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !astParser) return;

            const ast = await astParser.parseDocument(editor.document);
            if (!ast) {
                vscode.window.showInformationMessage('AST analysis not supported for this file type');
                return;
            }

            const symbols = astParser.getAvailableSymbols(ast, editor.selection.active);
            vscode.window.showInformationMessage(`Found ${symbols.length} symbols: ${symbols.slice(0, 5).join(', ')}`);
        }),
    ];
}
