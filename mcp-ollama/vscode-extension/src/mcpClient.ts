import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

interface InlineSuggestionParams {
    code: string;
    position: { line: number; character: number };
    language: string;
    triggerKind: string;
    context: {
        fileName: string;
        openFiles: any[];
    };
}

export class MCPClient {
    private baseUrl: string;
    private connected = false;
    private mcpClient?: Client;

    constructor() {
        const config = vscode.workspace.getConfiguration('mcp-ollama');
        const useHttps = config.get<boolean>('useHttps', false);
        const defaultHost = config.get<string>('serverHost', 'localhost');
        const defaultPort = config.get<number>('serverPort', 3077);
        const defaultUrl = `${useHttps ? 'https' : 'http'}://${defaultHost}:${defaultPort}`;
        const serverUrl = config.get<string>('serverUrl') || defaultUrl;
        this.baseUrl = this.validateServerUrl(serverUrl);
    }

    private validateServerUrl(url: string): string {
        try {
            const parsed = new URL(url);
            // Only allow http/https protocols
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                const config = vscode.workspace.getConfiguration('mcp-ollama');
                const defaultHost = config.get<string>('serverHost', 'localhost');
                const defaultPort = config.get<number>('serverPort', 3077);
                return `http://${defaultHost}:${defaultPort}`;
            }
            // Get allowed hosts from configuration
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const allowedHosts = config.get<string[]>('allowedHosts', ['localhost', '127.0.0.1', '::1']);
            const defaultHost = config.get<string>('serverHost', 'localhost');
            const defaultPort = config.get<number>('serverPort', 3077);
            
            if (!allowedHosts.includes(parsed.hostname)) {
                return `http://${defaultHost}:${defaultPort}`;
            }
            return url;
        } catch {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const defaultHost = config.get<string>('serverHost', 'localhost');
            const defaultPort = config.get<number>('serverPort', 3077);
            return `http://${defaultHost}:${defaultPort}`;
        }
    }

    async connect(): Promise<void> {
        try {
            // First check HTTP health endpoint
            const response = await this.makeRequest('GET', '/health');
            if (response.statusCode === 200) {
                this.connected = true;
                console.log('✅ Connected to MCP-Ollama server');
            } else {
                throw new Error(`Server health check failed: ${response.statusCode}`);
            }
        } catch (error) {
            this.connected = false;
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`❌ Failed to connect to MCP server: ${sanitizedError}`);
            throw error; // Throw error to indicate connection failure
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async ensureConnected(): Promise<void> {
        if (!this.connected) {
            await this.connect();
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    private async makeRequest(method: string, path: string, body?: string): Promise<{statusCode: number, statusMessage: string, body: string}> {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl + path);
            const isHttps = url.protocol === 'https:';
            const client = isHttps ? https : http;
            
            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(body && { 'Content-Length': Buffer.byteLength(body) })
                },
                ...(isHttps && { agent: this.createHttpsAgent() })
            };

            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode || 0,
                        statusMessage: res.statusMessage || '',
                        body: data
                    });
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (body) {
                req.write(body);
            }
            req.end();
        });
    }

    private createHttpsAgent(): https.Agent | undefined {
        if (!this.baseUrl.startsWith('https://')) {
            return undefined;
        }

        const config = vscode.workspace.getConfiguration('mcp-ollama');
        const certPath = path.join(process.cwd(), 'certs', 'cert.pem');
        
        try {
            // Try to use local certificate if available
            if (fs.existsSync(certPath)) {
                const cert = fs.readFileSync(certPath);
                return new https.Agent({
                    ca: cert,
                    rejectUnauthorized: true
                });
            }
        } catch (error) {
            console.log('Local certificate not found, using insecure agent for localhost');
        }

        // For development environments, allow self-signed certificates
        const allowSelfSigned = config.get<boolean>('allowSelfSignedCerts', true);
        const devHosts = ['localhost', '127.0.0.1', '::1'];
        
        if (allowSelfSigned && devHosts.some(host => this.baseUrl.includes(host))) {
            return new https.Agent({
                rejectUnauthorized: false
            });
        }

        return undefined;
    }

    async callTool(name: string, args: any): Promise<any> {
        return this.callToolInternal(name, args);
    }

    private async callToolInternal(name: string, args: any): Promise<any> {
        if (!this.connected) {
            throw new Error('MCP client not connected');
        }

        try {
            // Use HTTP API for now since MCP SDK requires stdio transport
            const response = await this.makeRequest('POST', `/tools/${name}`, JSON.stringify(args));
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
            }
            
            return JSON.parse(response.body);
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error calling tool ${name}: ${sanitizedError}`);
            throw error;
        }
    }

    async getInlineSuggestions(params: InlineSuggestionParams): Promise<any[]> {
        try {
            const result = await this.callTool('inline_suggestion', params);
            // Return mock suggestions if server is not responding
            if (!result || !result.suggestions) {
                return this.getMockSuggestions(params.code, params.language);
            }
            return result.suggestions || [];
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error getting inline suggestions: ${sanitizedError}`);
            // Return mock suggestions as fallback
            return this.getMockSuggestions(params.code, params.language);
        }
    }
    
    private getMockSuggestions(code: string, language: string): any[] {
        const lines = code.split('\n');
        const lastLine = lines[lines.length - 1] || '';
        
        if (language === 'javascript' || language === 'typescript') {
            if (lastLine.includes('console.lo')) {
                return [{ text: 'g("Hello World");', confidence: 0.9 }];
            }
            if (lastLine.includes('function ')) {
                return [{ text: '() {\n    // Implementation needed\n    return null;\n}', confidence: 0.8 }];
            }
            if (lastLine.includes('const ')) {
                return [{ text: 'value = ', confidence: 0.7 }];
            }
            if (lastLine.includes('if (')) {
                return [{ text: ') {\n    \n}', confidence: 0.8 }];
            }
        }
        
        if (language === 'python') {
            if (lastLine.includes('def ')) {
                return [{ text: '():\n    pass', confidence: 0.8 }];
            }
            if (lastLine.includes('print(')) {
                return [{ text: '"Hello World")', confidence: 0.9 }];
            }
        }
        
        return [];
    }

    async explainCode(code: string, language: string): Promise<string> {
        try {
            await this.ensureConnected();
            if (!this.connected) {
                return 'MCP server not available. Please check server connection.';
            }
            const result = await this.callTool('explain_code', { code, language, detail: 'detailed' });
            return result.explanation || 'No explanation available';
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error explaining code: ${sanitizedError}`);
            return 'Error explaining code';
        }
    }

    async explainCodeWithModel(code: string, language: string, model: string): Promise<string> {
        try {
            const result = await this.callTool('explain_code', { code, language, detail: 'detailed', model });
            return result.explanation || 'No explanation available';
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error explaining code: ${sanitizedError}`);
            return 'Error explaining code';
        }
    }

    async fixCode(code: string, language: string): Promise<string | null> {
        try {
            const result = await this.callTool('refactor_code', { code, language, focus: 'all' });
            return result.refactoredCode || null;
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error fixing code: ${sanitizedError}`);
            return null;
        }
    }

    async generateTests(code: string, language: string): Promise<string> {
        try {
            const result = await this.callTool('generate_tests', { code, language });
            return result.tests || 'No tests generated';
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error generating tests: ${sanitizedError}`);
            return 'Error generating tests';
        }
    }

    async generateDocs(code: string, language: string): Promise<string> {
        try {
            const result = await this.callTool('generate_docs', { code, language, style: 'markdown' });
            return result.documentation || 'No documentation generated';
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error generating docs: ${sanitizedError}`);
            return 'Error generating documentation';
        }
    }

    async handleSlashCommand(command: string, code: string, language: string): Promise<string> {
        try {
            const result = await this.callTool('slash_command', { command, code, language });
            return result.result || 'No result';
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error handling slash command: ${sanitizedError}`);
            return 'Error executing command';
        }
    }

    async handleSlashCommandWithModel(command: string, code: string, language: string, model: string): Promise<string> {
        try {
            const result = await this.callTool('slash_command', { command, code, language, model });
            return result.result || 'No result';
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error handling slash command: ${sanitizedError}`);
            return 'Error executing command';
        }
    }

    async recordTelemetry(event: string, suggestionId: string, context: any): Promise<void> {
        try {
            // Sanitize context to prevent data leaks
            const sanitizedContext = this.sanitizeTelemetryContext(context);
            await this.callTool('telemetry', { event, suggestionId, context: sanitizedContext, anonymous: true });
        } catch (error) {
            // Don't log context in error to prevent data leaks
            console.error('Error recording telemetry');
        }
    }

    private sanitizeTelemetryContext(context: any): any {
        if (!context || typeof context !== 'object') return {};
        
        const sanitized: any = {};
        for (const [key, value] of Object.entries(context)) {
            if (typeof value === 'string') {
                sanitized[key] = value.substring(0, 100);
            } else if (typeof value === 'number') {
                sanitized[key] = Math.min(value, 10000);
            }
        }
        return sanitized;
    }
    
    async executeAgentTask(params: { description: string; context: any }): Promise<any> {
        try {
            return await this.callTool('agent_execute', {
                description: params.description,
                type: 'implement',
                context: params.context,
                priority: 'high'
            });
        } catch (error) {
            const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
            console.error(`Error executing agent task: ${sanitizedError}`);
            throw error;
        }
    }

    // LSP Integration Methods
    async getLSPDiagnostics(uri: string, code: string, language: string): Promise<any> {
        try {
            return await this.callTool('handleVSCodeLSPIntegration', {
                uri, code, language, action: 'diagnostics'
            });
        } catch (error) {
            console.error('Error getting LSP diagnostics:', error);
            return { diagnostics: [] };
        }
    }

    async getLSPSymbols(uri: string, code: string): Promise<any> {
        try {
            return await this.callTool('handleVSCodeLSPIntegration', {
                uri, code, action: 'symbols'
            });
        } catch (error) {
            console.error('Error getting LSP symbols:', error);
            return [];
        }
    }

    async getLSPCompletion(uri: string, code: string, language: string, position: any): Promise<any> {
        try {
            return await this.callTool('handleVSCodeLSPIntegration', {
                uri, code, language, position, action: 'completion'
            });
        } catch (error) {
            console.error('Error getting LSP completion:', error);
            return { completion: '', symbols: [] };
        }
    }

    // Semantic Integration Methods
    async findSimilarCode(query: string, language: string, workspacePath?: string): Promise<any> {
        try {
            return await this.callTool('handleSemanticProvider', {
                query, language, workspacePath
            });
        } catch (error) {
            console.error('Error finding similar code:', error);
            return { matches: [] };
        }
    }

    async semanticSearch(query: string, limit: number = 5): Promise<any> {
        try {
            return await this.callTool('enhancedSemanticSearch', {
                query, limit
            });
        } catch (error) {
            console.error('Error in semantic search:', error);
            return { matches: [], count: 0 };
        }
    }

    // Enhanced methods using both LSP and Semantic
    async getEnhancedCompletion(code: string, language: string, context: any, filePath?: string): Promise<any> {
        try {
            return await this.callTool('enhancedCodeCompletion', {
                code, language, context, filePath
            });
        } catch (error) {
            console.error('Error getting enhanced completion:', error);
            return { code: '', quality: 0, isValid: false };
        }
    }

    async getCodeAnalysis(code: string, language: string, filePath?: string): Promise<any> {
        try {
            return await this.callTool('enhancedCodeAnalysis', {
                code, language, filePath
            });
        } catch (error) {
            console.error('Error getting code analysis:', error);
            return { diagnostics: [], symbols: [], securityIssues: [], quality: { overall: 0 } };
        }
    }

    async makeOllamaRequest(path: string): Promise<{statusCode: number, statusMessage: string, body: string}> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('mcp-ollama');
            const ollamaHost = config.get<string>('host') || config.get<string>('ollamaHost', 'http://10.10.110.25:11434');
            
            try {
                const url = new URL(ollamaHost + path);
                const isHttps = url.protocol === 'https:';
                const client = isHttps ? https : http;
                
                const options = {
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                const req = client.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        resolve({
                            statusCode: res.statusCode || 0,
                            statusMessage: res.statusMessage || '',
                            body: data
                        });
                    });
                });

                req.on('error', (error) => {
                    reject(new Error(`Ollama connection failed: ${error.message}`));
                });
                
                req.setTimeout(15000, () => {
                    req.destroy();
                    reject(new Error('Ollama timeout'));
                });

                req.end();
            } catch (error) {
                reject(new Error(`Invalid Ollama URL: ${ollamaHost}`));
            }
        });
    }

    async getAvailableModels(): Promise<string[]> {
        try {
            const response = await this.makeOllamaRequest('/api/tags');
            if (response.statusCode === 200) {
                const data = JSON.parse(response.body);
                return data.models?.map((m: any) => m.name) || [];
            }
            return [];
        } catch (error) {
            return [];
        }
    }

    async getGitHubRepoInfo(repoUrl: string): Promise<any> {
        try {
            await this.ensureConnected();
            const result = await this.callTool('github_repo_info', { repoUrl });
            return result;
        } catch (error) {
            console.error('Error getting GitHub repo info:', error);
            return { success: false, error: 'Failed to fetch repository information' };
        }
    }

    async getGitHubFileContent(repoUrl: string, filePath: string, branch = 'main'): Promise<any> {
        try {
            await this.ensureConnected();
            const result = await this.callTool('github_file_content', { repoUrl, filePath, branch });
            return result;
        } catch (error) {
            console.error('Error getting GitHub file content:', error);
            return { success: false, error: 'Failed to fetch file content' };
        }
    }

    async getGitHubDirectoryContents(repoUrl: string, dirPath: string = '', branch?: string): Promise<any> {
        try {
            await this.ensureConnected();
            const result = await this.callTool('github_directory_listing', { repoUrl, dirPath, branch });
            return result;
        } catch (error) {
            console.error('Error getting GitHub directory contents:', error);
            return { success: false, error: 'Failed to fetch directory contents' };
        }
    }
}