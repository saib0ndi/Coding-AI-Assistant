import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { InlineSuggestionProvider } from './inlineSuggestionProvider';
import { InlineCompletionProvider } from './inlineCompletionProvider';
import { CopilotChatProvider } from './copilotChatProvider';
import { StreamingClient } from './streamingClient';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { ChatUI } from './chatUI';
import { TelemetryManager } from './telemetryManager';
import { ContextAnalyzer } from './contextAnalyzer';
import { MultiLineGenerator } from './multiLineGenerator';
import { CopilotLabs } from './copilotLabs';
import { ASTParser } from './astParser';
import { ServerManager } from './serverManager';
import { LSPIntegration } from './lsp/LSPIntegration';
import { ResponseValidator } from './quality/ResponseValidator';
import { SemanticProvider } from './semantic/SemanticProvider';

// Global variables for extension services
let mcpClient: MCPClient | undefined;
let suggestionProvider: InlineSuggestionProvider | undefined;
let inlineCompletionProvider: InlineCompletionProvider | undefined;
let chatProvider: CopilotChatProvider | undefined;
let streamingClient: StreamingClient | undefined;
let workspaceAnalyzer: WorkspaceAnalyzer | undefined;
let chatUI: ChatUI | undefined;
let telemetryManager: TelemetryManager | undefined;
let contextAnalyzer: ContextAnalyzer | undefined;
let multiLineGenerator: MultiLineGenerator | undefined;
let copilotLabs: CopilotLabs | undefined;
let astParser: ASTParser | undefined;
let serverManager: ServerManager | undefined;
let lspIntegration: LSPIntegration | undefined;
let responseValidator: ResponseValidator | undefined;
let semanticProvider: SemanticProvider | undefined;

// Output channel for logging
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    console.log('MCP-Ollama Copilot extension activated');

    // Check if extension is enabled
    const config = vscode.workspace.getConfiguration('mcp-ollama');
    if (!config.get('enabled', true)) {
        console.log('MCP-Ollama extension is disabled');
        return;
    }

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MCP-Ollama Copilot');
    outputChannel.appendLine('Extension activation started');

    try {
        // Initialize MCP client and services
        mcpClient = new MCPClient();
        telemetryManager = new TelemetryManager();
        contextAnalyzer = new ContextAnalyzer();
        astParser = new ASTParser();
        serverManager = new ServerManager();
        multiLineGenerator = new MultiLineGenerator(mcpClient, contextAnalyzer);
        copilotLabs = new CopilotLabs(mcpClient);
        lspIntegration = new LSPIntegration(mcpClient);
        responseValidator = new ResponseValidator();
        semanticProvider = new SemanticProvider(mcpClient);
        suggestionProvider = new InlineSuggestionProvider(mcpClient);
        inlineCompletionProvider = new InlineCompletionProvider(mcpClient);
        chatProvider = new CopilotChatProvider(mcpClient);
        streamingClient = new StreamingClient(mcpClient);
        workspaceAnalyzer = new WorkspaceAnalyzer(mcpClient);
        chatUI = new ChatUI(context);
        
        // Disable automatic document event handlers to prevent infinite loops
        outputChannel.appendLine('Document event handlers disabled to prevent crashes');
        
        // Prevent document event loops by not registering onDidOpenTextDocument
        // This fixes the "Aborted()" error spam in console

        // Register inline completion providers
        const completionProvider = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            suggestionProvider
        );
        
        const enhancedCompletionProvider = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineCompletionProvider
        );

        // Register chat provider with proper error handling
        let chatProviderRegistration: vscode.ChatParticipant | undefined;
        try {
            // Register chat participant
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

            vscode.commands.registerCommand('mcp-ollama.showChatPanel', () => {
                try {
                    if (chatUI) {
                        chatUI.show();
                        vscode.window.showInformationMessage('Chat panel opened!');
                    } else {
                        vscode.window.showErrorMessage('Extension not properly initialized');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to show chat panel');
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
                    inlineCompletionProvider: inlineCompletionProvider ? 'initialized' : 'not initialized',
                    chatProvider: chatProvider ? 'initialized' : 'not initialized',
                    chatUI: chatUI ? 'initialized' : 'not initialized',
                    telemetryManager: telemetryManager ? 'initialized' : 'not initialized'
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
            
            vscode.commands.registerCommand('mcp-ollama.logAcceptance', (completion: string, position: vscode.Position) => {
                if (telemetryManager) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        telemetryManager.recordEvent('accept', 
                            telemetryManager.generateSuggestionId(),
                            editor.document.languageId,
                            {
                                lineLength: editor.document.lineAt(position.line).text.length,
                                fileType: editor.document.fileName.split('.').pop() || 'unknown',
                                triggerKind: 'inline'
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
                    placeHolder: 'function myFunction(param1, param2)'
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
                    placeHolder: 'MyClass'
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
            
            vscode.commands.registerCommand('mcp-ollama.openLabs', () => {
                if (copilotLabs) {
                    copilotLabs.showLabsPanel();
                } else {
                    vscode.window.showErrorMessage('Copilot Labs not initialized');
                }
            }),
            
            vscode.commands.registerCommand('mcp-ollama.analyzeAST', () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !astParser) return;
                
                const ast = astParser.parseDocument(editor.document);
                if (!ast) {
                    vscode.window.showInformationMessage('AST analysis not supported for this file type');
                    return;
                }
                
                const symbols = astParser.getAvailableSymbols(ast, editor.selection.active);
                vscode.window.showInformationMessage(`Found ${symbols.length} symbols: ${symbols.slice(0, 5).join(', ')}`);
            }),

            vscode.commands.registerCommand('mcp-ollama.optimizeCode', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !mcpClient) return;
                
                const selection = editor.selection;
                const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                const language = editor.document.languageId;
                
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }
                
                try {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand('/optimize', code, language);
                    
                    const doc = await vscode.workspace.openTextDocument({
                        content: `Performance Optimization:\n\n${result}`,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } catch (error) {
                    vscode.window.showErrorMessage('Optimization failed');
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.securityScan', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !mcpClient) return;
                
                const selection = editor.selection;
                const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                const language = editor.document.languageId;
                
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }
                
                try {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand('/security', code, language);
                    
                    const doc = await vscode.workspace.openTextDocument({
                        content: `Security Scan Results:\n\n${result}`,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } catch (error) {
                    vscode.window.showErrorMessage('Security scan failed');
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.translateCode', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !mcpClient) return;
                
                const selection = editor.selection;
                const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                const language = editor.document.languageId;
                
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }
                
                const targetLang = await vscode.window.showQuickPick(
                    ['python', 'javascript', 'typescript', 'java', 'go', 'rust', 'cpp'],
                    { placeHolder: 'Select target language' }
                );
                
                if (!targetLang) return;
                
                try {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand(`/translate ${targetLang}`, code, language);
                    
                    const doc = await vscode.workspace.openTextDocument({
                        content: result,
                        language: targetLang
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } catch (error) {
                    vscode.window.showErrorMessage('Code translation failed');
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.codeReview', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !mcpClient) return;
                
                const selection = editor.selection;
                const code = editor.document.getText(selection.isEmpty ? undefined : selection);
                const language = editor.document.languageId;
                
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }
                
                try {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand('/review', code, language);
                    
                    const doc = await vscode.workspace.openTextDocument({
                        content: `Code Review:\n\n${result}`,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } catch (error) {
                    vscode.window.showErrorMessage('Code review failed');
                }
            }),

            // Agent Mode Commands
            vscode.commands.registerCommand('mcp-ollama.toggleAgentMode', async () => {
                const config = vscode.workspace.getConfiguration('mcp-ollama');
                const currentMode = config.get('agentMode', false);
                await config.update('agentMode', !currentMode, true);
                
                const status = !currentMode ? '🤖 ACTIVATED' : '💤 DEACTIVATED';
                vscode.window.showInformationMessage(`Agent Mode ${status}`);
                
                if (!currentMode) {
                    vscode.window.showInformationMessage(
                        '🤖 Agent Mode Active! Give me instructions and I\'ll execute them autonomously.',
                        'Open Chat'
                    ).then(selection => {
                        if (selection === 'Open Chat') {
                            vscode.commands.executeCommand('mcp-ollama.showChatPanel');
                        }
                    });
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.startServer', async () => {
                try {
                    if (serverManager) {
                        const port = await serverManager.startServer();
                        vscode.window.showInformationMessage(`🚀 MCP Server started on port ${port}`);
                    } else {
                        vscode.window.showErrorMessage('Server manager not initialized');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }),

            vscode.commands.registerCommand('mcp-ollama.executeAgentTask', async () => {
                const instruction = await vscode.window.showInputBox({
                    prompt: '🤖 Agent Instruction',
                    placeHolder: 'e.g., "Create a user authentication system with tests"',
                    ignoreFocusOut: true
                });
                
                if (!instruction) return;
                
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                const editor = vscode.window.activeTextEditor;
                
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '🤖 Agent executing task...',
                    cancellable: false
                }, async (progress) => {
                    try {
                        if (!mcpClient) {
                            throw new Error('MCP client not initialized');
                        }
                        
                        await mcpClient.connect();
                        
                        progress.report({ message: 'Planning workflow...' });
                        
                        const result = await mcpClient.executeAgentTask({
                            description: instruction,
                            context: {
                                workspacePath: workspaceFolder?.uri.fsPath || process.cwd(),
                                language: editor?.document.languageId || 'typescript',
                                currentFile: editor?.document.fileName
                            }
                        });
                        
                        progress.report({ message: 'Task completed!' });
                        
                        // Show results
                        const doc = await vscode.workspace.openTextDocument({
                            content: `🤖 Agent Task Results\n\n**Task**: ${instruction}\n\n**Status**: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n\n**Summary**: ${result.summary}\n\n**Files Modified**: ${result.filesModified?.length || 0}\n${result.filesModified?.map((f: string) => `- ${f}`).join('\n') || ''}\n\n**Steps Executed**: ${result.steps?.length || 0}\n${result.steps?.map((s: any) => `- ${s.action} (${s.status})`).join('\n') || ''}`,
                            language: 'markdown'
                        });
                        
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                        
                        if (result.success) {
                            vscode.window.showInformationMessage(
                                `🎉 Agent completed task successfully! Modified ${result.filesModified?.length || 0} files.`
                            );
                        } else {
                            vscode.window.showErrorMessage(
                                `❌ Agent task failed: ${result.error || 'Unknown error'}`
                            );
                        }
                        
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `🤖 Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                        );
                    }
                });
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
        const allDisposables = [
            completionProvider,
            enhancedCompletionProvider,
            outputChannel,
            ...commands
        ];

        if (chatProviderRegistration) {
            allDisposables.push(chatProviderRegistration);
        }

        context.subscriptions.push(...allDisposables);

        // Connect to MCP server
        try {
            outputChannel.appendLine('Connecting to MCP server...');
            await mcpClient.connect();
            outputChannel.appendLine('Successfully connected to MCP server');
        } catch (error) {
            outputChannel.appendLine(`Warning: Failed to connect to MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
            outputChannel.appendLine('Extension will work with limited functionality');
        }
        
        outputChannel.appendLine('Extension activation completed successfully');

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
        const disposableServices = [suggestionProvider, chatProvider, streamingClient, workspaceAnalyzer, chatUI];
        
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
        // Dispose services
        if (telemetryManager) {
            telemetryManager.dispose();
        }
        if (inlineCompletionProvider) {
            inlineCompletionProvider.dispose();
        }
        
        // Clear references
        mcpClient = undefined;
        suggestionProvider = undefined;
        inlineCompletionProvider = undefined;
        chatProvider = undefined;
        streamingClient = undefined;
        workspaceAnalyzer = undefined;
        chatUI = undefined;
        telemetryManager = undefined;
        contextAnalyzer = undefined;
        multiLineGenerator = undefined;
        if (copilotLabs) {
            copilotLabs.dispose();
        }
        if (serverManager) {
            await serverManager.stopServer();
        }
        copilotLabs = undefined;
        astParser = undefined;
        serverManager = undefined;
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
    
    // Sanitize input to prevent path traversal
    const sanitizedFileName = path.basename(originalFileName);
    const ext = path.extname(sanitizedFileName);
    const baseName = path.basename(sanitizedFileName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedLanguage = language.replace(/[^a-zA-Z]/g, '');
    
    switch (sanitizedLanguage) {
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