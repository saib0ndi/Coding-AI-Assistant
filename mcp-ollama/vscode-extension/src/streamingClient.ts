import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';

export class StreamingClient {
    constructor(private mcpClient: MCPClient) {}

    async streamCompletion(
        prompt: string,
        language: string,
        onToken: (token: string) => void,
        onComplete: (fullText: string) => void,
        onError: (error: Error) => void
    ): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const serverUrl = config.get<string>('serverUrl') || 'http://localhost:3078';
            
            const response = await fetch(`${serverUrl}/stream/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, language })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            let fullText = '';
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;
                onToken(chunk);
            }

            onComplete(fullText);
        } catch (error) {
            onError(error instanceof Error ? error : new Error('Unknown streaming error'));
        }
    }

    async streamChat(
        message: string,
        context: any,
        onToken: (token: string) => void,
        onComplete: (fullText: string) => void,
        onError: (error: Error) => void,
        options?: { model?: string; messages?: Array<{ role: string; content: string }>; language?: string }
    ): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const serverUrl = config.get<string>('serverUrl') || 'http://localhost:3078';
            
            const response = await fetch(`${serverUrl}/stream/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    context,
                    model: options?.model,
                    messages: options?.messages,
                    language: options?.language
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            let fullText = '';
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;
                onToken(chunk);
            }

            onComplete(fullText);
        } catch (error) {
            onError(error instanceof Error ? error : new Error('Unknown streaming error'));
        }
    }
}
