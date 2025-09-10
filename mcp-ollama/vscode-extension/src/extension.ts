import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { InlineSuggestionProvider } from './inlineSuggestionProvider';
import { CopilotChatProvider } from './copilotChatProvider';
import { StreamingClient } from './streamingClient';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { CopilotUI } from './copilotUI';

// Global variables for extension services
let mcpClient: MCPClient | undefined;
let suggestionProvider: InlineSuggestionProvider | undefined;
let chatProvider: CopilotChatProvider | undefined;
let streamingClient: StreamingClient | undefined;
let workspaceAnalyzer: WorkspaceAnalyzer | undefined;
let copilotUI: CopilotUI | undefined;

// Output channel for logging
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    console.log('MCP-Ollama Copilot extension activated');

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MCP-Ollama Copilot');
    outputChannel.appendLine('Extension activation started');

    try {
        // Initialize MCP client and services
        mcpClient = new MCPClient();
        suggestionProvider = new InlineSuggestionProvider(mcpClient);
        chatProvider = new CopilotChatProvider(mcpClient);
        streamingClient = new StreamingClient(mcpClient);
        workspaceAnalyzer = new WorkspaceAnalyzer(mcpClient);
        copilotUI = new CopilotUI(mcpClient);

        // Register inline completion provider
        const completionProvider = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            suggestionProvider
        );

        // Register chat provider with proper error handling
        let chatProviderRegistration: vscode.ChatParticipant | undefined;
        try {
            chatProviderRegistration = vscode.chat.createChatParticipant(
                'smartcode-aiassist',
                chatProvider.handleChatRequest.bind(chatProvider)
            );
            
            // Set icon path if file exists
            const iconPath = context.asAbsolutePath('images/icon.png');
            if (await fileExists(iconPath)) {
                chatProviderRegistration.iconPath = vscode.Uri.file(iconPath);
            }
            
            chatProviderRegistration.followupProvider = {
                provideFollowups: () => [
                    { prompt: '/fix', label: 'Fix Code Issues' },
                    { prompt: '/explain', label: 'Explain Code' },
                    { prompt: '/tests', label: 'Generate Tests' },
                    { prompt: '/doc', label: 'Generate Documentation' }
                ]
            };
        } catch (error) {
            outputChannel.appendLine(`Warning: Failed to register chat provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Continue without chat provider
        }

        // Register commands with proper error handling
        const commands = [
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

            vscode.commands.registerCommand('mcp-ollama.explain', async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage('No active editor found');
                        return;
                    }

                    if (!mcpClient) {
                        vscode.window.showErrorMessage('MCP client not initialized');
                        return;
                    }

                    const selection = editor.selection;
                    const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                    const language = editor.document.languageId;

                    if (!code.trim()) {
                        vscode.window.showWarningMessage('No code selected or document is empty');
                        return;
                    }

                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Explaining code...',
                        cancellable: false
                    }, async () => {
                        try {
                            const explanation = await mcpClient!.explainCode(code, language);
                            if (explanation) {
                                // Show explanation in a new document instead of just a message
                                const doc = await vscode.workspace.openTextDocument({
                                    content: `Code Explanation:\n\n${explanation}`,
                                    language: 'markdown'
                                });
                                await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                            } else {
                                vscode.window.showWarningMessage('No explanation received');
                            }
                        } catch (error) {
                            const errorMsg = `Failed to explain code: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            vscode.window.showErrorMessage(errorMsg);
                            outputChannel.appendLine(`Error: ${errorMsg}`);
                        }
                    });
                } catch (error) {
                    const errorMsg = `Explain command failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    vscode.window.showErrorMessage(errorMsg);
                    outputChannel.appendLine(`Error: ${errorMsg}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.fix', async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage('No active editor found');
                        return;
                    }

                    if (!mcpClient) {
                        vscode.window.showErrorMessage('MCP client not initialized');
                        return;
                    }

                    const selection = editor.selection;
                    const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                    const language = editor.document.languageId;

                    if (!code.trim()) {
                        vscode.window.showWarningMessage('No code selected or document is empty');
                        return;
                    }

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Fixing code...',
                        cancellable: false
                    }, async () => {
                        try {
                            const fix = await mcpClient!.fixCode(code, language);
                            if (fix && fix.trim() !== code.trim()) {
                                await editor.edit(editBuilder => {
                                    if (selection.isEmpty) {
                                        // Replace entire document
                                        const entireRange = new vscode.Range(
                                            editor.document.positionAt(0),
                                            editor.document.positionAt(editor.document.getText().length)
                                        );
                                        editBuilder.replace(entireRange, fix);
                                    } else {
                                        // Replace selection
                                        editBuilder.replace(selection, fix);
                                    }
                                });
                                vscode.window.showInformationMessage('Code fixed successfully');
                            } else {
                                vscode.window.showInformationMessage('No fixes were suggested for this code');
                            }
                        } catch (error) {
                            const errorMsg = `Failed to fix code: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            vscode.window.showErrorMessage(errorMsg);
                            outputChannel.appendLine(`Error: ${errorMsg}`);
                        }
                    });
                } catch (error) {
                    const errorMsg = `Fix command failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    vscode.window.showErrorMessage(errorMsg);
                    outputChannel.appendLine(`Error: ${errorMsg}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.tests', async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage('No active editor found');
                        return;
                    }

                    if (!mcpClient) {
                        vscode.window.showErrorMessage('MCP client not initialized');
                        return;
                    }

                    const selection = editor.selection;
                    const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                    const language = editor.document.languageId;

                    if (!code.trim()) {
                        vscode.window.showWarningMessage('No code selected or document is empty');
                        return;
                    }

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Generating tests...',
                        cancellable: false
                    }, async () => {
                        try {
                            const tests = await mcpClient!.generateTests(code, language);
                            if (tests) {
                                // Create new document with tests
                                const testFileName = getTestFileName(editor.document.fileName, language);
                                const doc = await vscode.workspace.openTextDocument({
                                    content: tests,
                                    language: language
                                });
                                await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                                vscode.window.showInformationMessage('Tests generated successfully');
                            } else {
                                vscode.window.showWarningMessage('No tests were generated');
                            }
                        } catch (error) {
                            const errorMsg = `Failed to generate tests: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            vscode.window.showErrorMessage(errorMsg);
                            outputChannel.appendLine(`Error: ${errorMsg}`);
                        }
                    });
                } catch (error) {
                    const errorMsg = `Tests command failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    vscode.window.showErrorMessage(errorMsg);
                    outputChannel.appendLine(`Error: ${errorMsg}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.docs', async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage('No active editor found');
                        return;
                    }

                    if (!mcpClient) {
                        vscode.window.showErrorMessage('MCP client not initialized');
                        return;
                    }

                    const selection = editor.selection;
                    const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                    const language = editor.document.languageId;

                    if (!code.trim()) {
                        vscode.window.showWarningMessage('No code selected or document is empty');
                        return;
                    }

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Generating documentation...',
                        cancellable: false
                    }, async () => {
                        try {
                            const docs = await mcpClient!.generateDocs(code, language);
                            if (docs) {
                                // Insert docs above the selected code or at the top of document
                                await editor.edit(editBuilder => {
                                    const insertPosition = selection.isEmpty ? 
                                        new vscode.Position(0, 0) : 
                                        selection.start;
                                    editBuilder.insert(insertPosition, docs + '\n');
                                });
                                vscode.window.showInformationMessage('Documentation generated successfully');
                            } else {
                                vscode.window.showWarningMessage('No documentation was generated');
                            }
                        } catch (error) {
                            const errorMsg = `Failed to generate documentation: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            vscode.window.showErrorMessage(errorMsg);
                            outputChannel.appendLine(`Error: ${errorMsg}`);
                        }
                    });
                } catch (error) {
                    const errorMsg = `Docs command failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    vscode.window.showErrorMessage(errorMsg);
                    outputChannel.appendLine(`Error: ${errorMsg}`);
                }
            }),

            // Keyboard shortcuts with error handling
            vscode.commands.registerCommand('mcp-ollama.nextSuggestion', () => {
                try {
                    if (suggestionProvider) {
                        suggestionProvider.nextSuggestion();
                    }
                } catch (error) {
                    outputChannel.appendLine(`Error in nextSuggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.previousSuggestion', () => {
                try {
                    if (suggestionProvider) {
                        suggestionProvider.previousSuggestion();
                    }
                } catch (error) {
                    outputChannel.appendLine(`Error in previousSuggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.alternatives', () => {
                try {
                    if (suggestionProvider) {
                        suggestionProvider.showAlternatives();
                    }
                } catch (error) {
                    outputChannel.appendLine(`Error in showAlternatives: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.acceptSuggestion', () => {
                try {
                    if (suggestionProvider) {
                        suggestionProvider.acceptSuggestion();
                    }
                } catch (error) {
                    outputChannel.appendLine(`Error in acceptSuggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.openChat', () => {
                try {
                    if (copilotUI) {
                        copilotUI.showChatPanel();
                    } else {
                        vscode.window.showErrorMessage('Copilot UI not initialized');
                    }
                } catch (error) {
                    const errorMsg = `Failed to open chat: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    vscode.window.showErrorMessage(errorMsg);
                    outputChannel.appendLine(`Error: ${errorMsg}`);
                }
            }),

            // Add diagnostic and debugging commands
            vscode.commands.registerCommand('mcp-ollama.showLogs', () => {
                outputChannel.show();
            }),

            vscode.commands.registerCommand('mcp-ollama.status', () => {
                const status = {
                    mcpClient: mcpClient ? 'initialized' : 'not initialized',
                    suggestionProvider: suggestionProvider ? 'initialized' : 'not initialized',
                    chatProvider: chatProvider ? 'initialized' : 'not initialized',
                    copilotUI: copilotUI ? 'initialized' : 'not initialized'
                };
                
                const statusMessage = Object.entries(status)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n');
                
                vscode.window.showInformationMessage('Extension Status', { modal: true, detail: statusMessage });
            })
        ];

        // Register chat commands with error handling
        try {
            if (chatProvider) {
                CopilotChatProvider.registerChatCommands(context, mcpClient);
            }
        } catch (error) {
            outputChannel.appendLine(`Warning: Failed to register chat commands: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Add all disposables to context
        const disposables = [
            completionProvider,
            outputChannel,
            ...commands
        ];

        if (chatProviderRegistration) {
            disposables.push(chatProviderRegistration);
        }

        context.subscriptions.push(...disposables);

        // Initialize MCP connection with retry logic
        await initializeMCPConnection();

        outputChannel.appendLine('Extension activation completed successfully');
        vscode.window.showInformationMessage('MCP-Ollama Copilot activated successfully');

    } catch (error) {
        const errorMsg = `Failed to activate MCP-Ollama extension: ${error instanceof Error ? error.message : 'Unknown error'}`;
        outputChannel.appendLine(`Error: ${errorMsg}`);
        vscode.window.showErrorMessage(errorMsg);
        
        // Still try to initialize with limited functionality
        try {
            context.subscriptions.push(outputChannel);
        } catch (e) {
            console.error('Failed to add output channel to subscriptions:', e);
        }
    }
}

export async function deactivate() {
    console.log('MCP-Ollama Copilot extension deactivated');
    
    try {
        if (outputChannel) {
            outputChannel.appendLine('Extension deactivation started');
        }

        // Dispose all services that have dispose methods
        const disposableServices = [suggestionProvider, chatProvider, streamingClient, workspaceAnalyzer, copilotUI];
        
        for (const service of disposableServices) {
            if (service && 'dispose' in service && typeof service.dispose === 'function') {
                try {
                    await service.dispose();
                } catch (error) {
                    console.error('Error disposing service:', error);
                    if (outputChannel) {
                        outputChannel.appendLine(`Error disposing service: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                }
            }
        }

        // Disconnect MCP client specifically
        if (mcpClient && typeof mcpClient.disconnect === 'function') {
            try {
                await mcpClient.disconnect();
            } catch (error) {
                console.error('Error disconnecting MCP client:', error);
            }
        }

        if (outputChannel) {
            outputChannel.appendLine('Extension deactivation completed');
        }

    } catch (error) {
        console.error('Error during deactivation:', error);
    } finally {
        // Clear references
        mcpClient = undefined;
        suggestionProvider = undefined;
        chatProvider = undefined;
        streamingClient = undefined;
        workspaceAnalyzer = undefined;
        copilotUI = undefined;
    }
}

// Helper functions
async function fileExists(path: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path));
        return true;
    } catch {
        return false;
    }
}

function getTestFileName(originalFileName: string, language: string): string {
    const path = require('path');
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    
    switch (language) {
        case 'javascript':
        case 'typescript':
            return `${baseName}.test${ext}`;
        case 'python':
            return `test_${baseName}.py`;
        case 'java':
            return `${baseName}Test.java`;
        case 'csharp':
            return `${baseName}Tests.cs`;
        default:
            return `${baseName}_test${ext}`;
    }
}

async function initializeMCPConnection(retries: number = 3): Promise<void> {
    if (!mcpClient) {
        throw new Error('MCP client not initialized');
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            outputChannel.appendLine(`Attempting to connect to MCP server (attempt ${attempt}/${retries})`);
            await mcpClient.connect();
            outputChannel.appendLine('Successfully connected to MCP server');
            return;
        } catch (error) {
            const errorMsg = `Failed to connect to MCP server (attempt ${attempt}/${retries}): ${error instanceof Error ? error.message : 'Unknown error'}`;
            outputChannel.appendLine(errorMsg);
            
            if (attempt === retries) {
                // Final attempt failed
                vscode.window.showErrorMessage('Failed to connect to MCP-Ollama server after multiple attempts. Some features may not work.');
                throw error;
            } else {
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }
}