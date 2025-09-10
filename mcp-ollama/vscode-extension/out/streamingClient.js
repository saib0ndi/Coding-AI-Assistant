"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingClient = void 0;
const vscode = require("vscode");
const node_fetch_1 = require("node-fetch");
class StreamingClient {
    constructor(mcpClient) {
        this.mcpClient = mcpClient;
    }
    async streamCompletion(prompt, language, onToken, onComplete, onError) {
        try {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const useHttps = config.get('useHttps', true);
            const defaultUrl = useHttps ? 'https://localhost:3077' : 'http://localhost:3077';
            const serverUrl = config.get('serverUrl') || defaultUrl;
            const response = await (0, node_fetch_1.default)(`${serverUrl}/stream/completion`, {
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
                if (done)
                    break;
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
                        }
                        catch (e) {
                            // Ignore malformed JSON
                        }
                    }
                }
            }
            onComplete(fullText);
        }
        catch (error) {
            onError(error instanceof Error ? error : new Error('Unknown streaming error'));
        }
    }
    async streamChat(message, context, onToken, onComplete, onError) {
        try {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const useHttps = config.get('useHttps', true);
            const defaultUrl = useHttps ? 'https://localhost:3077' : 'http://localhost:3077';
            const serverUrl = config.get('serverUrl') || defaultUrl;
            const response = await (0, node_fetch_1.default)(`${serverUrl}/stream/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, context })
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
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;
                onToken(chunk);
            }
            onComplete(fullText);
        }
        catch (error) {
            onError(error instanceof Error ? error : new Error('Unknown streaming error'));
        }
    }
}
exports.StreamingClient = StreamingClient;
//# sourceMappingURL=streamingClient.js.map