import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';

export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
    private currentSuggestions: vscode.InlineCompletionItem[] = [];
    private currentIndex = 0;
    private suggestionVisible = false;

    constructor(private mcpClient: MCPClient) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        
        console.log('SmartCode-AIAssist: provideInlineCompletionItems called');
        
        const config = vscode.workspace.getConfiguration('mcp-ollama');
        if (!config.get('enabled', true)) {
            console.log('SmartCode-AIAssist: Extension disabled');
            return [];
        }

        // Get current line and context
        const line = document.lineAt(position);
        const textBeforeCursor = line.text.substring(0, position.character);
        const textAfterCursor = line.text.substring(position.character);

        console.log('SmartCode-AIAssist: textBeforeCursor:', textBeforeCursor);
        
        // Always provide suggestions - remove restrictive filtering
        // if (textAfterCursor.match(/^[a-zA-Z0-9_]/) && !textBeforeCursor.endsWith('.')) {
        //     return [];
        // }

        // Get surrounding context (10 lines before and after)
        const startLine = Math.max(0, position.line - 10);
        const endLine = Math.min(document.lineCount - 1, position.line + 10);
        const contextRange = new vscode.Range(startLine, 0, endLine, 0);
        const contextCode = document.getText(contextRange);

        try {
            // Get suggestions from MCP server
            const suggestions = await this.mcpClient.getInlineSuggestions({
                code: contextCode,
                position: { line: position.line - startLine, character: position.character },
                language: document.languageId,
                triggerKind: this.getTriggerKind(context),
                context: {
                    fileName: document.fileName,
                    openFiles: this.getOpenFiles()
                }
            });

            // If no suggestions from server, generate smart suggestions
            let finalSuggestions = suggestions;
            if (!suggestions || suggestions.length === 0) {
                finalSuggestions = this.generateSmartSuggestions(textBeforeCursor, document.languageId, contextCode);
            }

            // Convert to VS Code inline completion items
            const items = finalSuggestions.map((suggestion: any, index: number) => {
                const suggestionText = suggestion.text || suggestion.ghostText || suggestion;
                const item = new vscode.InlineCompletionItem(
                    suggestionText,
                    new vscode.Range(position, position)
                );
                return item;
            });

            this.currentSuggestions = items;
            this.currentIndex = 0;
            this.suggestionVisible = items.length > 0;

            // Update context for keybindings
            vscode.commands.executeCommand('setContext', 'mcp-ollama.suggestionVisible', this.suggestionVisible);

            return items;

        } catch (error) {
            console.error('Error getting inline suggestions:', error);
            // Fallback to smart suggestions
            const fallbackSuggestions = this.generateSmartSuggestions(textBeforeCursor, document.languageId, contextCode);
            console.log('SmartCode-AIAssist: Generated fallback suggestions:', fallbackSuggestions);
            const items = fallbackSuggestions.map(suggestion => 
                new vscode.InlineCompletionItem(suggestion, new vscode.Range(position, position))
            );
            console.log('SmartCode-AIAssist: Returning', items.length, 'fallback suggestions');
            return items;
        }
    }

    private getTriggerKind(context: vscode.InlineCompletionContext): string {
        switch (context.triggerKind) {
            case vscode.InlineCompletionTriggerKind.Invoke:
                return 'invoke';
            case vscode.InlineCompletionTriggerKind.Automatic:
                return 'auto';
            default:
                return 'typing';
        }
    }

    private getOpenFiles(): any[] {
        return vscode.workspace.textDocuments.map(doc => ({
            path: doc.fileName,
            language: doc.languageId,
            content: doc.getText().substring(0, 1000) // Limit content size
        }));
    }

    nextSuggestion() {
        if (this.currentSuggestions.length > 1) {
            this.currentIndex = (this.currentIndex + 1) % this.currentSuggestions.length;
            this.showCurrentSuggestion();
        }
    }

    previousSuggestion() {
        if (this.currentSuggestions.length > 1) {
            this.currentIndex = this.currentIndex === 0 
                ? this.currentSuggestions.length - 1 
                : this.currentIndex - 1;
            this.showCurrentSuggestion();
        }
    }

    showAlternatives() {
        if (this.currentSuggestions.length > 1) {
            const items = this.currentSuggestions.map((item, index) => ({
                label: `Suggestion ${index + 1}`,
                description: item.insertText.toString().substring(0, 50) + '...',
                index
            }));

            vscode.window.showQuickPick(items).then(selected => {
                if (selected) {
                    this.currentIndex = selected.index;
                    this.showCurrentSuggestion();
                }
            });
        }
    }

    acceptSuggestion() {
        const editor = vscode.window.activeTextEditor;
        if (editor && this.suggestionVisible && this.currentSuggestions[this.currentIndex]) {
            const suggestion = this.currentSuggestions[this.currentIndex];
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, suggestion.insertText.toString());
            });

            // Record telemetry (sanitized)
            const sanitizedContext = {
                language: editor.document.languageId.replace(/[^a-zA-Z0-9]/g, ''),
                suggestionLength: Math.min(suggestion.insertText.toString().length, 1000)
            };
            this.mcpClient.recordTelemetry('accept', this.generateSuggestionId(), sanitizedContext);

            this.clearSuggestions();
        }
    }

    private showCurrentSuggestion() {
        // Trigger re-evaluation of inline completions
        vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }

    private clearSuggestions() {
        this.currentSuggestions = [];
        this.currentIndex = 0;
        this.suggestionVisible = false;
        vscode.commands.executeCommand('setContext', 'mcp-ollama.suggestionVisible', false);
    }

    private generateSuggestionId(): string {
        return `suggestion_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    private generateSmartSuggestions(textBeforeCursor: string, language: string, contextCode: string): string[] {
        const suggestions: string[] = [];
        
        if (language === 'javascript' || language === 'typescript') {
            // Console completions
            if (textBeforeCursor.endsWith('console.lo')) {
                suggestions.push('g("Hello World");');
                suggestions.push('g(data);');
            } else if (textBeforeCursor.endsWith('console.log(')) {
                suggestions.push('"Hello World");');
                suggestions.push('data);');
                suggestions.push('error);');
            } else if (textBeforeCursor.endsWith('console.')) {
                suggestions.push('log();');
                suggestions.push('error();');
                suggestions.push('warn();');
            }
            // Function completions
            else if (textBeforeCursor.includes('function ') && textBeforeCursor.endsWith('{')) {
                suggestions.push('\n    // TODO: Implement function\n    return null;\n}');
            }
            // Variable declarations
            else if (textBeforeCursor.endsWith('const ')) {
                suggestions.push('result = ');
                suggestions.push('data = ');
            } else if (textBeforeCursor.endsWith('let ')) {
                suggestions.push('count = 0;');
                suggestions.push('result;');
            }
            // Import statements
            else if (textBeforeCursor.startsWith('import ')) {
                suggestions.push('{ useState } from "react";');
                suggestions.push('express from "express";');
            }
            // Arrow functions
            else if (textBeforeCursor.endsWith('=> ')) {
                suggestions.push('{\n    \n}');
                suggestions.push('console.log();');
            }
            // Generic completions based on context
            else if (textBeforeCursor.trim() === '') {
                // Empty line suggestions
                if (contextCode.includes('function')) {
                    suggestions.push('console.log();');
                    suggestions.push('return;');
                }
            }
        }
        
        return suggestions.slice(0, 3); // Limit to 3 suggestions
    }
}