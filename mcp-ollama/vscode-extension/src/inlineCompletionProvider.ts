import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private mcpClient: MCPClient;
    private cache = new Map<string, { completion: string; timestamp: number }>();
    private debounceTimer?: NodeJS.Timeout;

    constructor(mcpClient: MCPClient) {
        this.mcpClient = mcpClient;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        
        if (!this.shouldProvideCompletion(document, position, context)) {
            return null;
        }

        try {
            const completion = await this.getCompletion(document, position, token);
            if (!completion || token.isCancellationRequested) {
                return null;
            }

            return [{
                insertText: completion,
                range: new vscode.Range(position, position),
                command: {
                    command: 'mcp-ollama.logAcceptance',
                    title: 'Log Acceptance',
                    arguments: [completion, position]
                }
            }];
        } catch (error) {
            console.error('Inline completion error:', error);
            return null;
        }
    }

    private shouldProvideCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext
    ): boolean {
        // Skip if triggered by undo/redo
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && 
            context.selectedCompletionInfo) {
            return false;
        }

        // Skip in comments (basic check)
        const line = document.lineAt(position.line).text;
        const beforeCursor = line.substring(0, position.character);
        if (beforeCursor.includes('//') || beforeCursor.includes('/*')) {
            return false;
        }

        // Skip if cursor is at beginning of line with only whitespace
        if (beforeCursor.trim().length === 0) {
            return false;
        }

        return true;
    }

    private async getCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<string | null> {
        const cacheKey = this.generateCacheKey(document, position);
        const cached = this.cache.get(cacheKey);
        
        // Return cached result if recent (within 5 seconds)
        if (cached && Date.now() - cached.timestamp < 5000) {
            return cached.completion;
        }

        // Debounce rapid requests
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        return new Promise((resolve) => {
            this.debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve(null);
                    return;
                }

                try {
                    const context = this.buildContext(document, position);
                    const suggestions = await this.mcpClient.getInlineSuggestions({
                        code: context.code,
                        position: { line: position.line, character: position.character },
                        language: document.languageId,
                        triggerKind: 'typing',
                        context: {
                            fileName: document.fileName,
                            openFiles: []
                        }
                    });

                    const completion = suggestions?.[0]?.text || null;
                    if (completion) {
                        this.cache.set(cacheKey, { completion, timestamp: Date.now() });
                    }
                    resolve(completion);
                } catch (error) {
                    console.error('Error getting completion:', error);
                    resolve(null);
                }
            }, 300); // 300ms debounce
        });
    }

    private buildContext(document: vscode.TextDocument, position: vscode.Position) {
        const startLine = Math.max(0, position.line - 20);
        const endLine = Math.min(document.lineCount - 1, position.line + 5);
        
        let code = '';
        for (let i = startLine; i <= endLine; i++) {
            code += document.lineAt(i).text + '\n';
        }

        return { code, startLine, endLine };
    }

    private generateCacheKey(document: vscode.TextDocument, position: vscode.Position): string {
        const line = document.lineAt(position.line).text;
        const prefix = line.substring(0, position.character);
        return `${document.fileName}:${position.line}:${prefix}`;
    }

    dispose() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.cache.clear();
    }
}