import * as vscode from 'vscode';
import type { CommandServices } from './types';

export function registerAgentCommands(services: CommandServices): vscode.Disposable[] {
    const { mcpClient, serverManager, outputChannel, chatUI } = services;

    return [
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

        vscode.commands.registerCommand('mcp-ollama.analyzeLargeCode', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                const code = editor.document.getText();
                const language = editor.document.languageId;
                const lines = code.split('\n').length;

                if (lines < 100) {
                    vscode.window.showInformationMessage(`This file has only ${lines} lines. Use regular 'Explain Code' for smaller files.`);
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Analyze the following large ${language} file:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `📊 Analyzing large ${language} file (${lines} lines)...`,
                        cancellable: false,
                    }, async (progress) => {
                        progress.report({ message: 'Processing code structure...' });
                        await mcpClient.connect();

                        progress.report({ message: 'Generating comprehensive analysis...' });
                        const analysis = await mcpClient.callTool('analyze_large_code', {
                            code,
                            language,
                            analysisType: 'comprehensive',
                        });

                        progress.report({ message: 'Analysis complete!' });

                        if (analysis) {
                            const doc = await vscode.workspace.openTextDocument({
                                content: `# 📊 Large Code Analysis\n\n**File**: ${editor.document.fileName}\n**Language**: ${language}\n**Lines**: ${lines}\n**Characters**: ${code.length}\n\n---\n\n${analysis}`,
                                language: 'markdown',
                            });
                            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                            vscode.window.showInformationMessage(`✅ Analysis complete for ${lines}-line ${language} file!`);
                        } else {
                            vscode.window.showWarningMessage('No analysis was generated');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                const errorMsg = `Large code analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                vscode.window.showErrorMessage(errorMsg);
                outputChannel.appendLine(`Error: ${errorMsg}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.generateLargeCode', async () => {
            try {
                const description = await vscode.window.showInputBox({
                    prompt: '🏠 Describe the large code to generate',
                    placeHolder: 'e.g., "Complete REST API with authentication, database, and tests"',
                    ignoreFocusOut: true,
                });
                if (!description) return;

                const language = await vscode.window.showQuickPick(
                    ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'cpp', 'csharp'],
                    { placeHolder: 'Select programming language' }
                );
                if (!language) return;

                const codeType = await vscode.window.showQuickPick(
                    [
                        { label: 'Complete Application', value: 'complete_application' },
                        { label: 'Full Class/Module', value: 'comprehensive_module' },
                        { label: 'Entire System', value: 'entire_system' },
                        { label: 'Full Class Implementation', value: 'full_class' },
                    ],
                    { placeHolder: 'Select code type to generate' }
                );
                if (!codeType) return;

                if (chatUI) {
                    await chatUI.handleEditorAction(`Generate a complete ${language} program based on this description: ${description}\nCode Type: ${codeType.label}`);
                } else if (mcpClient) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `🏠 Generating large ${language} code...`,
                        cancellable: false,
                    }, async (progress) => {
                        progress.report({ message: 'Connecting to AI model...' });
                        await mcpClient.connect();

                        progress.report({ message: 'Generating comprehensive code (this may take 5-10 minutes)...' });
                        const generatedCode = await mcpClient.callTool('generate_large_code', {
                            description,
                            language,
                            codeType: codeType.value,
                        });

                        progress.report({ message: 'Code generation complete!' });

                        if (generatedCode && generatedCode.length > 100) {
                            const lineCount = generatedCode.split('\n').length;
                            const doc = await vscode.workspace.openTextDocument({ content: generatedCode, language });
                            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
                            vscode.window.showInformationMessage(`✅ Generated ${lineCount} lines of ${language} code!`);
                        } else {
                            vscode.window.showWarningMessage('Generated code was too short. Try a more detailed description.');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                const errorMsg = `Large code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                vscode.window.showErrorMessage(errorMsg);
                outputChannel.appendLine(`Error: ${errorMsg}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.executeAgentTask', async () => {
            const instruction = await vscode.window.showInputBox({
                prompt: '🤖 Agent Instruction',
                placeHolder: 'e.g., "Create a user authentication system with tests"',
                ignoreFocusOut: true,
            });
            if (!instruction) return;

            if (chatUI) {
                await chatUI.handleEditorAction(`/dev ${instruction}`);
            } else if (mcpClient) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                const editor = vscode.window.activeTextEditor;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '🤖 Agent executing task...',
                    cancellable: false,
                }, async (progress) => {
                    progress.report({ message: 'Planning workflow...' });
                    await mcpClient.connect();

                    const result = await mcpClient.executeAgentTask({
                        description: instruction,
                        context: {
                            workspacePath: workspaceFolder?.uri.fsPath || process.cwd(),
                            language: editor?.document.languageId || 'typescript',
                            currentFile: editor?.document.fileName,
                        },
                    });

                    progress.report({ message: 'Task completed!' });

                    const doc = await vscode.workspace.openTextDocument({
                        content: `🤖 Agent Task Results\n\n**Task**: ${instruction}\n\n**Status**: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n\n**Summary**: ${result.summary}\n\n**Files Modified**: ${result.filesModified?.length || 0}\n${result.filesModified?.map((f: string) => `- ${f}`).join('\n') || ''}\n\n**Steps Executed**: ${result.steps?.length || 0}\n${result.steps?.map((s: any) => `- ${s.action} (${s.status})`).join('\n') || ''}`,
                        language: 'markdown',
                    });

                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `🎉 Agent completed task successfully! Modified ${result.filesModified?.length || 0} files.`
                        );
                    } else {
                        vscode.window.showErrorMessage(`❌ Agent task failed: ${result.error || 'Unknown error'}`);
                    }
                });
            } else {
                vscode.window.showErrorMessage('MCP client not initialized');
            }
        }),
    ];
}
