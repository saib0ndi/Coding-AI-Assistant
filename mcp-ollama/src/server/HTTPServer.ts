import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { MCPServer } from './MCPServer.js';
import { Logger } from '../utils/Logger.js';
import { OllamaConfig } from '../types/index.js';

export class HTTPServer {
    private server: http.Server | https.Server;
    private mcpServer: MCPServer;
    private logger: Logger;
    private port: number;
    private useHttps: boolean;

    constructor(config: OllamaConfig, port = Number(process.env.DEFAULT_HTTP_PORT || 3077)) {
        this.logger = new Logger();
        this.port = port;
        this.mcpServer = new MCPServer(config);
        this.useHttps = process.env.USE_HTTPS === 'true';
        
        if (this.useHttps) {
            const httpsOptions = this.getHttpsOptions();
            this.server = https.createServer(httpsOptions, this.handleRequest.bind(this));
            this.server.timeout = 120000; // 2 minutes for AI responses
        } else {
            this.server = http.createServer(this.handleRequest.bind(this));
        this.server.timeout = 120000; // 2 minutes for AI responses
        }
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const host = process.env.SERVER_HOST || 'localhost';
        const url = new URL(req.url || '/', `http://${host}:${this.port}`);
        
        try {
            if (url.pathname === '/health') {
                await this.handleHealth(req, res);
            } else if (url.pathname.startsWith('/tools/')) {
                await this.handleToolCall(req, res, url);
            } else if (url.pathname.startsWith('/stream/')) {
                await this.handleStream(req, res, url);
            } else if (url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'MCP-Ollama Server', version: process.env.SERVER_VERSION || '2.0.0' }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (error) {
            this.logger.error('Request handling error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }

    private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    }

    private async handleToolCall(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        const pathParts = url.pathname.split('/tools/');
        if (pathParts.length !== 2) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid tool path' }));
            return;
        }

        const toolName = this.sanitizeToolName(pathParts[1]);
        if (!toolName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid tool name' }));
            return;
        }

        const body = await this.readRequestBody(req);
        
        try {
            const params = JSON.parse(body);
            const result = await this.mcpServer.callTool(toolName, params);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        }
    }

    private async handleStream(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        const pathParts = url.pathname.split('/stream/');
        if (pathParts.length !== 2) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid stream path' }));
            return;
        }

        const streamType = this.sanitizeStreamType(pathParts[1]);
        if (!streamType) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid stream type' }));
            return;
        }

        const body = await this.readRequestBody(req);
        
        try {
            const params = JSON.parse(body);
            
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });

            if (streamType === 'completion') {
                await this.streamCompletion(params, res);
            } else if (streamType === 'chat') {
                await this.streamChat(params, res);
            } else {
                res.end('data: {"error": "Unknown stream type"}\n\n');
            }
        } catch (error) {
            res.end(`data: {"error": "${error instanceof Error ? error.message : 'Unknown error'}"}\n\n`);
        }
    }

    private async streamCompletion(params: any, res: http.ServerResponse): Promise<void> {
        const { prompt, language } = params;
        
        // Simulate streaming by sending chunks
        const response = await this.mcpServer.callTool('code_completion', { 
            code: prompt, 
            language, 
            position: { line: 0, character: prompt.length } 
        });
        
        const text = response.suggestions?.[0]?.text || '';
        const chunks = text.split(' ');
        
        for (const chunk of chunks) {
            res.write(`data: {"token": "${chunk} "}\n\n`);
            await new Promise(resolve => setTimeout(resolve, Number(process.env.STREAM_DELAY_MS || 50)));
        }
        
        res.end();
    }

    private async streamChat(params: any, res: http.ServerResponse): Promise<void> {
        const { message, context } = params;
        
        const response = await this.mcpServer.callTool('chat_assistant', { 
            query: message, 
            context: JSON.stringify(context) 
        });
        
        const text = response.response || 'No response';
        const chunks = text.split(' ');
        
        for (const chunk of chunks) {
            res.write(`${chunk} `);
            await new Promise(resolve => setTimeout(resolve, Number(process.env.CHAT_DELAY_MS || 100)));
        }
        
        res.end();
    }

    private readRequestBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }

    private getHttpsOptions(): https.ServerOptions {
        const certPath = this.findCertificate([
            process.env.SSL_CERT_PATH,
            './certs/cert.pem',
            '/etc/ssl/certs/cert.pem',
            '~/.ssl/cert.pem'
        ]);
        const keyPath = this.findCertificate([
            process.env.SSL_KEY_PATH,
            './certs/key.pem',
            '/etc/ssl/private/key.pem',
            '~/.ssl/key.pem'
        ]);
        
        try {
            return {
                cert: fs.readFileSync(certPath),
                key: fs.readFileSync(keyPath)
            };
        } catch (error) {
            this.logger.warn('SSL certificates not found, falling back to HTTP');
            this.useHttps = false;
            throw new Error('SSL certificates required for HTTPS');
        }
    }
    
    private findCertificate(paths: (string | undefined)[]): string {
        for (const path of paths) {
            if (path && fs.existsSync(path)) {
                return path;
            }
        }
        throw new Error('Certificate file not found in any of the specified paths');
    }

    private sanitizeToolName(toolName: string): string | null {
        if (!toolName || typeof toolName !== 'string') {
            return null;
        }
        
        // Only allow alphanumeric characters, underscores, and hyphens
        const sanitized = toolName.replace(/[^a-zA-Z0-9_-]/g, '');
        
        // Validate against known tool names
        const validTools = [
            'code_completion', 'code_generation', 'code_explanation', 'auto_error_fix',
            'diagnose_code', 'quick_fix', 'batch_error_fix', 'error_pattern_analysis',
            'validate_fix', 'code_analysis', 'context_analysis', 'refactoring_suggestions',
            'chat_assistant', 'explain_code', 'refactor_code', 'generate_tests',
            'generate_docs', 'security_scan', 'optimize_performance', 'translate_code',
            'suggest_imports', 'code_review', 'inline_suggestion', 'multi_file_suggestion',
            'slash_command', 'lsp_integration', 'suggestion_filter', 'multi_model',
            'keyboard_shortcut', 'telemetry', 'enterprise_tools', 'copilot_labs',
            'streaming_suggestion', 'context_window', 'ghost_text', 'persistent_cache',
            'workspace_analysis'
        ];
        
        return validTools.includes(sanitized) ? sanitized : null;
    }

    private sanitizeStreamType(streamType: string): string | null {
        if (!streamType || typeof streamType !== 'string') {
            return null;
        }
        
        const sanitized = streamType.replace(/[^a-zA-Z0-9_-]/g, '');
        const validTypes = ['completion', 'chat'];
        
        return validTypes.includes(sanitized) ? sanitized : null;
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, () => {
                const protocol = this.useHttps ? 'HTTPS' : 'HTTP';
                this.logger.info(`${protocol} server listening on port ${this.port}`);
                resolve();
            });
            
            this.server.on('error', reject);
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.close((error) => {
                if (error) {
                    this.logger.error('Error stopping HTTP server:', error);
                    reject(error);
                } else {
                    this.logger.info('HTTP server stopped');
                    resolve();
                }
            });
        });
    }
}