import * as http from 'http';
import { MCPServer } from '../server/MCPServer.js';
import { Logger } from '../utils/Logger.js';

export class RestServer {
  private server: http.Server;
  private mcpServer: MCPServer;
  private logger: Logger;
  private port: number;
  private host: string;

  constructor(mcpServer: MCPServer, port: number = Number(process.env.PORT) || 3002) {
    this.mcpServer = mcpServer;
    this.port = port;
    this.host = process.env.BIND_HOST || '0.0.0.0';
    this.logger = new Logger('info', 'RestAPI');
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS with restricted origins
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'];
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // parse path (robust to trailing slashes)
    const reqUrl = req.url || '/';
    const pathname = reqUrl.replace(/\?.*$/, '').replace(/\/+$/, '') || '/';

    try {
      if (req.method === 'POST') {
        let raw: string;
        try {
          raw = await this.getRequestBody(req);
        } catch (error) {
          this.logger.error('Failed to read request body:', error);
          return this.sendError(res, 400, 'Failed to read request body');
        }
        
        let data: any;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          return this.sendError(res, 400, 'Invalid JSON body');
        }

        switch (pathname) {
          case '/api/fix-error':
            return this.handleFixError(data, res);
          case '/api/complete-code':
          case '/api/generate':   // alias
            return this.handleCodeCompletion(data, res);
          case '/api/analyze-code':
            return this.handleCodeAnalysis(data, res);
          default:
            return this.sendError(res, 404, `Endpoint not found: ${pathname}`);
        }
      }

      if (req.method === 'GET') {
        switch (pathname) {
          case '/api/health':
          case '/health':
            return this.handleHealth(res);
          case '/':
            return this.handleRoot(res);
          default:
            return this.sendError(res, 404, `Endpoint not found: ${pathname}`);
        }
      }

      return this.sendError(res, 405, `Method ${req.method} not allowed`);
    } catch (err: any) {
      this.logger.error(`Unhandled error: ${err?.stack || err?.message || err}`);
      return this.sendError(res, 500, 'Internal server error');
    }
  }

  // ---------------- Handlers ----------------

  private async handleFixError(data: any, res: http.ServerResponse): Promise<void> {
    const { code, errorMessage, language } = data || {};
    if (!code || !errorMessage) {
      return this.sendError(res, 400, 'Missing "code" or "errorMessage" in request body');
    }
    try {
      if (!language) {
        return this.sendError(res, 400, 'Missing "language" in request body');
      }
      const result = await (this.mcpServer as any).handleAutoErrorFix({ code, errorMessage, language });
      return this.sendSuccess(res, result);
    } catch (e: any) {
      this.logger.error(`[fix-error] ${e?.message || e}`);
      return this.sendError(res, 500, `Fix processing failed: ${String(e?.message || e)}`);
    }
  }

  private async handleCodeCompletion(data: any, res: http.ServerResponse): Promise<void> {
    // Accept prefix OR prompt OR code; normalize to "prefix"
    const prefix: string | undefined = data?.prefix ?? data?.prompt ?? data?.code;
    const language: string | undefined = data?.language;
    const maxTokens: number | undefined = data?.maxTokens;

    if (!prefix) {
      return this.sendError(res, 400, 'Missing "prefix" (or "prompt"/"code") in request body');
    }
    if (!language) {
      return this.sendError(res, 400, 'Missing "language" in request body');
    }

    try {
      const result = await (this.mcpServer as any).handleCodeCompletion({ prefix, language, maxTokens });
      return this.sendSuccess(res, result);
    } catch (e: any) {
      this.logger.error(`[complete-code] ${e?.message || e}`);
      return this.sendError(res, 500, `Completion failed: ${String(e?.message || e)}`);
    }
  }

  private async handleCodeAnalysis(data: any, res: http.ServerResponse): Promise<void> {
    const { code, language } = data || {};
    if (!code) {
      return this.sendError(res, 400, 'Missing "code" in request body');
    }
    if (!language) {
      return this.sendError(res, 400, 'Missing "language" in request body');
    }

    try {
      const result = await (this.mcpServer as any).handleCodeAnalysis({ code, language, analysisType: 'explanation' });
      return this.sendSuccess(res, result);
    } catch (e: any) {
      this.logger.error(`[analyze-code] ${e?.message || e}`);
      return this.sendError(res, 500, `Analysis failed: ${String(e?.message || e)}`);
    }
  }

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const health = { status: 'healthy', timestamp: new Date().toISOString() };
    this.sendSuccess(res, health);
  }

  private async handleRoot(res: http.ServerResponse): Promise<void> {
    const endpoints = {
      health: ['/api/health', '/health'],
      codeCompletion: ['/api/complete-code', '/api/generate'],
      codeAnalysis: ['/api/analyze-code'],
      fixError: ['/api/fix-error'],
    };
    this.sendSuccess(res, { message: 'MCP-Ollama REST API', endpoints });
  }

  // ---------------- Utils ----------------

  private async getRequestBody(req: http.IncomingMessage): Promise<string> {
    const maxSize = 10 * 1024 * 1024; // 10MB limit
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new Error('Request body too large'));
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', (error) => reject(error));
    });
  }

  private sendSuccess(res: http.ServerResponse, data: any): void {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data }));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status);
    res.end(JSON.stringify({ success: false, error: message }));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        this.logger.info(`REST API server started on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }
}
