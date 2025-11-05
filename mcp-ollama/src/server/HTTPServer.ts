import http from 'http';
import https from 'https';
import fs from 'fs';
import { URL } from 'url';
import { MCPServer } from './MCPServer.js';
import { Logger } from '../utils/Logger.js';
import { OllamaConfig } from '../types/index.js';

export class HTTPServer {
    private server: http.Server | https.Server;
    private mcpServer: MCPServer;
    private logger: Logger;
    private port: number;
    private useHttps: boolean;

    constructor(config: OllamaConfig, port = 3077) {
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
            } else if (url.pathname === '/tools/agent_execute') {
                await this.handleAgentExecute(req, res);
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

    private async handleAgentExecute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        const body = await this.readRequestBody(req);
        
        try {
            const params = JSON.parse(body);
            
            // Check if it's a directory creation request
            if (params.description && params.description.toLowerCase().includes('directory')) {
                const dirName = this.extractDirectoryName(params.description);
                if (dirName) {
                    try {
                        const fs = await import('fs');
                        const path = await import('path');
                        const fullPath = path.resolve('.', dirName);
                        
                        if (!fs.existsSync(fullPath)) {
                            fs.mkdirSync(fullPath, { recursive: true });
                        }
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            taskId: `agent_${Date.now()}`,
                            success: true,
                            steps: [{ id: 'create_dir', action: 'create_directory', status: 'completed', result: { path: fullPath } }],
                            summary: `Created directory: ${dirName}`,
                            filesModified: [fullPath],
                            directExecution: true
                        }));
                        return;
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            taskId: `agent_${Date.now()}`,
                            success: false,
                            error: error instanceof Error ? error.message : 'Directory creation failed'
                        }));
                        return;
                    }
                }
            }
            
            // Fallback to code generation
            const fallback = await this.mcpServer.callTool('code_generation', {
                prompt: params.description || 'create function',
                language: params.context?.language || 'typescript'
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                taskId: `agent_${Date.now()}`,
                success: true,
                steps: [{ id: 'step_1', action: params.description, tool: 'code', params: {}, status: 'completed' }],
                summary: `Generated code for: ${params.description}`,
                filesModified: ['generated.ts'],
                code: fallback.code,
                autonomous: true
            }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                taskId: '',
                success: false,
                steps: [],
                summary: 'Code generation failed',
                filesModified: [],
                error: error instanceof Error ? error.message : 'Code generation failed'
            }));
        }
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
            res.end(JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error'
            }));
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
                res.end('data: {"error": "Unknown stream type"}\\n\\n');
            }
        } catch (error) {
            res.end(`data: {"error": "${error instanceof Error ? error.message : 'Unknown error'}"}\\n\\n`);
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
            res.write(`data: {"token": "${chunk} "}\\n\\n`);
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
        // Allow only alphanumeric characters and underscores
        const sanitized = toolName.replace(/[^a-zA-Z0-9_]/g, '');
        return sanitized.length > 0 ? sanitized : null;
    }

    private sanitizeStreamType(streamType: string): string | null {
        if (!streamType || typeof streamType !== 'string') {
            return null;
        }
        const validTypes = ['completion', 'chat'];
        return validTypes.includes(streamType) ? streamType : null;
    }

    private extractDirectoryName(description: string): string | null {
        const patterns = [
            /create.*directory.*with.*name\s+([\w-]+)/i,
            /create.*directory.*name.*of\s+([\w-]+)/i,
            /create.*directory.*called\s+([\w-]+)/i,
            /create.*directory\s+([\w-]+)/i,
            /make.*directory\s+([\w-]+)/i,
            /mkdir\s+([\w-]+)/i,
            /directory.*name\s+([\w-]+)/i,
            /name\s+([\w-]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = description.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }
        
        return null;
    }

    public async start(): Promise<void> {
        const availablePort = await this.findAvailablePort(this.port);
        this.port = availablePort;
        
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, () => {
                this.logger.info(`${this.useHttps ? 'HTTPS' : 'HTTP'} server running on port ${this.port}`);
                process.env.MCP_SERVER_PORT = this.port.toString();
                process.env.DEFAULT_HTTP_PORT = this.port.toString();
                resolve();
            });
            
            this.server.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    this.logger.error(`Port ${this.port} is already in use`);
                    reject(new Error(`Port ${this.port} is already in use`));
                } else {
                    this.logger.error('Server error:', error);
                    reject(error);
                }
            });
        });
    }

    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => {
                this.logger.info('Server stopped');
                resolve();
            });
        });
    }

    private async findAvailablePort(startPort: number): Promise<number> {
        for (let port = startPort; port < startPort + 100; port++) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        throw new Error('No available ports found');
    }

    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise(async (resolve) => {
            const net = await import('net');
            const server = net.createServer();
            server.listen(port, () => {
                server.close(() => resolve(true));
            });
            server.on('error', () => resolve(false));
        });
    }
}