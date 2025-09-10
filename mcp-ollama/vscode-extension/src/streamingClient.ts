import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import fetch from 'node-fetch';

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
            const useHttps = config.get<boolean>('useHttps', true);
            const defaultUrl = useHttps ? 'https://localhost:3077' : 'http://localhost:3077';
            const serverUrl = config.get<string>('serverUrl') || defaultUrl;
            
            const response = await fetch(`${serverUrl}/stream/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, language })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = (response.body as any)?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            let fullText = '';
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.token) {
                                fullText += data.token;
                                onToken(data.token);
                            }
                        } catch (e) {
                            // Ignore malformed JSON
                        }
                    }
                }
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
        onError: (error: Error) => void
    ): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const useHttps = config.get<boolean>('useHttps', true);
            const defaultUrl = useHttps ? 'https://localhost:3077' : 'http://localhost:3077';
            const serverUrl = config.get<string>('serverUrl') || defaultUrl;
            
            const response = await fetch(`${serverUrl}/stream/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, context })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = (response.body as any)?.getReader();
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