import * as vscode from 'vscode';
import type { CommandServices } from './types';

function getEditorCode(editor: vscode.TextEditor): { code: string; language: string; selection: vscode.Selection } {
    const selection = editor.selection;
    const code = editor.document.getText(selection.isEmpty ? undefined : selection);
    return { code, language: editor.document.languageId, selection };
}

export function registerEditorCommands(services: CommandServices): vscode.Disposable[] {
    const { mcpClient, outputChannel, chatUI } = services;

    return [
        vscode.commands.registerCommand('mcp-ollama.explain', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                const { code, language } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected or document is empty');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Explain the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Explaining code...',
                        cancellable: false,
                    }, async () => {
                        const explanation = await mcpClient.explainCode(code, language);
                        if (explanation) {
                            const doc = await vscode.workspace.openTextDocument({
                                content: `Code Explanation:\n\n${explanation}`,
                                language: 'markdown',
                            });
                            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                        } else {
                            vscode.window.showWarningMessage('No explanation received');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
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

                const { code, language, selection } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected or document is empty');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Fix any issues or bugs in the following ${language} code and suggest improvements:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Fixing code...',
                        cancellable: false,
                    }, async () => {
                        const fix = await mcpClient.fixCode(code, language);
                        if (fix && fix.trim() !== code.trim()) {
                            await editor.edit(editBuilder => {
                                if (selection.isEmpty) {
                                    const entireRange = new vscode.Range(
                                        editor.document.positionAt(0),
                                        editor.document.positionAt(editor.document.getText().length)
                                    );
                                    editBuilder.replace(entireRange, fix);
                                } else {
                                    editBuilder.replace(selection, fix);
                                }
                            });
                            vscode.window.showInformationMessage('Code fixed successfully');
                        } else {
                            vscode.window.showInformationMessage('No fixes were suggested for this code');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
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

                const { code, language } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected or document is empty');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Generate unit tests for the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Generating tests...',
                        cancellable: false,
                    }, async () => {
                        const tests = await mcpClient.generateTests(code, language);
                        if (tests) {
                            const doc = await vscode.workspace.openTextDocument({ content: tests, language });
                            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                            vscode.window.showInformationMessage('Tests generated successfully');
                        } else {
                            vscode.window.showWarningMessage('No tests were generated');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
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

                const { code, language, selection } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected or document is empty');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Generate documentation or docstrings for the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Generating documentation...',
                        cancellable: false,
                    }, async () => {
                        const docs = await mcpClient.generateDocs(code, language);
                        if (docs) {
                            await editor.edit(editBuilder => {
                                const insertPosition = selection.isEmpty ? new vscode.Position(0, 0) : selection.start;
                                editBuilder.insert(insertPosition, docs + '\n');
                            });
                            vscode.window.showInformationMessage('Documentation generated successfully');
                        } else {
                            vscode.window.showWarningMessage('No documentation was generated');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                const errorMsg = `Docs command failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                vscode.window.showErrorMessage(errorMsg);
                outputChannel.appendLine(`Error: ${errorMsg}`);
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.optimizeCode', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                const { code, language } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Optimize the performance and runtime of the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand('/optimize', code, language);
                    const doc = await vscode.workspace.openTextDocument({
                        content: `Performance Optimization:\n\n${result}`,
                        language: 'markdown',
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Optimization failed');
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.securityScan', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                const { code, language } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Run a security scan on the following ${language} code to identify vulnerabilities:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand('/security', code, language);
                    const doc = await vscode.workspace.openTextDocument({
                        content: `Security Scan Results:\n\n${result}`,
                        language: 'markdown',
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Security scan failed');
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.translateCode', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                const { code, language } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }

                const targetLang = await vscode.window.showQuickPick(
                    ['python', 'javascript', 'typescript', 'java', 'go', 'rust', 'cpp'],
                    { placeHolder: 'Select target language' }
                );
                if (!targetLang) return;

                if (chatUI) {
                    await chatUI.handleEditorAction(`Translate the following ${language} code to ${targetLang}:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand(`/translate ${targetLang}`, code, language);
                    const doc = await vscode.workspace.openTextDocument({ content: result, language: targetLang });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Code translation failed');
            }
        }),

        vscode.commands.registerCommand('mcp-ollama.codeReview', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                const { code, language } = getEditorCode(editor);
                if (!code.trim()) {
                    vscode.window.showWarningMessage('No code selected');
                    return;
                }

                if (chatUI) {
                    await chatUI.handleEditorAction(`Provide a comprehensive code review for the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``);
                } else if (mcpClient) {
                    await mcpClient.connect();
                    const result = await mcpClient.handleSlashCommand('/review', code, language);
                    const doc = await vscode.workspace.openTextDocument({
                        content: `Code Review:\n\n${result}`,
                        language: 'markdown',
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } else {
                    vscode.window.showErrorMessage('MCP client not initialized');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Code review failed');
            }
        }),
    ];
}
