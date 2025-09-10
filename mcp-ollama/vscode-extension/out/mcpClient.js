"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClient = void 0;
const vscode = require("vscode");
const node_fetch_1 = require("node-fetch");
class MCPClient {
    constructor() {
        this.connected = false;
        const config = vscode.workspace.getConfiguration('mcp-ollama');
        const useHttps = config.get('useHttps', true);
        const defaultUrl = useHttps ? 'https://localhost:3077' : 'http://localhost:3077';
        const serverUrl = config.get('serverUrl') || defaultUrl;
        this.baseUrl = this.validateServerUrl(serverUrl);
    }
    validateServerUrl(url) {
        try {
            const parsed = new URL(url);
            // Only allow http/https protocols
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return 'https://localhost:3077';
            }
            // Only allow localhost or specific safe hosts
            if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
                return 'https://localhost:3077';
            }
            return url;
        }
        catch {
            return 'https://localhost:3077';
        }
    }
    async connect() {
        try {
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}/health`);
            if (response.ok) {
                this.connected = true;
                console.log('Connected to MCP-Ollama server');
            }
            else {
                throw new Error('Server health check failed');
            }
        }
        catch (error) {
            this.connected = false;
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Failed to connect to MCP server: ${sanitizedError}`);
            throw error;
        }
    }
    async disconnect() {
        this.connected = false;
    }
    async callTool(name, args) {
        if (!this.connected) {
            throw new Error('MCP client not connected');
        }
        try {
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}/tools/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error calling tool ${name}: ${sanitizedError}`);
            throw error;
        }
    }
    async getInlineSuggestions(params) {
        try {
            const result = await this.callTool('inline_suggestion', params);
            // Return mock suggestions if server is not responding
            if (!result || !result.suggestions) {
                return this.getMockSuggestions(params.code, params.language);
            }
            return result.suggestions || [];
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error getting inline suggestions: ${sanitizedError}`);
            // Return mock suggestions as fallback
            return this.getMockSuggestions(params.code, params.language);
        }
    }
    getMockSuggestions(code, language) {
        if (language === 'javascript' || language === 'typescript') {
            if (code.includes('console.lo')) {
                return [{ text: 'g("Hello World");' }];
            }
            if (code.includes('function ')) {
                return [{ text: '\n    // TODO: Implement function\n    return null;\n}' }];
            }
        }
        return [];
    }
    async explainCode(code, language) {
        try {
            const result = await this.callTool('explain_code', { code, language, detail: 'detailed' });
            return result.explanation || 'No explanation available';
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error explaining code: ${sanitizedError}`);
            return 'Error explaining code';
        }
    }
    async fixCode(code, language) {
        try {
            const result = await this.callTool('refactor_code', { code, language, focus: 'all' });
            return result.refactoredCode || null;
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error fixing code: ${sanitizedError}`);
            return null;
        }
    }
    async generateTests(code, language) {
        try {
            const result = await this.callTool('generate_tests', { code, language });
            return result.tests || 'No tests generated';
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error generating tests: ${sanitizedError}`);
            return 'Error generating tests';
        }
    }
    async generateDocs(code, language) {
        try {
            const result = await this.callTool('generate_docs', { code, language, style: 'markdown' });
            return result.documentation || 'No documentation generated';
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error generating docs: ${sanitizedError}`);
            return 'Error generating documentation';
        }
    }
    async handleSlashCommand(command, code, language) {
        try {
            const result = await this.callTool('slash_command', { command, code, language });
            return result.result || 'No result';
        }
        catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error handling slash command: ${sanitizedError}`);
            return 'Error executing command';
        }
    }
    async recordTelemetry(event, suggestionId, context) {
        try {
            // Sanitize context to prevent data leaks
            const sanitizedContext = this.sanitizeTelemetryContext(context);
            await this.callTool('telemetry', { event, suggestionId, context: sanitizedContext, anonymous: true });
        }
        catch (error) {
            // Don't log context in error to prevent data leaks
            console.error('Error recording telemetry');
        }
    }
    sanitizeTelemetryContext(context) {
        if (!context || typeof context !== 'object')
            return {};
        const sanitized = {};
        for (const [key, value] of Object.entries(context)) {
            if (typeof value === 'string') {
                sanitized[key] = value.substring(0, 100);
            }
            else if (typeof value === 'number') {
                sanitized[key] = Math.min(value, 10000);
            }
        }
        return sanitized;
    }
}
exports.MCPClient = MCPClient;
//# sourceMappingURL=mcpClient.js.map