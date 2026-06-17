import http from 'http';
import https from 'https';
import fs from 'fs';
import { URL } from 'url';
import { MCPServer } from './MCPServer.js';
import { Logger } from '../utils/Logger.js';
import { OllamaConfig } from '../types/index.js';
import { loadAppConfig, parsePositiveInteger } from '../config/AppConfig.js';
import { cloudSettingsStorage } from '../providers/OllamaProvider.js';
import { ScaledOllamaProvider } from '../scaling/ScaledOllamaProvider.js';
import { getDLQ } from '../workflows/DeadLetterQueue.js';
import metricsRegistry, { httpRequestsTotal, httpRequestDurationMs, circuitBreakerState, dlqSizeGauge } from '../utils/Metrics.js';
import { withTrace } from '../utils/Tracing.js';


export class HTTPServer {
    private server: http.Server | https.Server;
    private readonly openSockets = new Set<import('net').Socket>();
    private mcpServer: MCPServer;
    private logger: Logger;
    private port: number;
    private useHttps: boolean;
    private appConfig = loadAppConfig();
    private scaledProvider?: ScaledOllamaProvider;
    private embeddingHealthCache?: { value: Record<string, unknown>; expiresAt: number };

    constructor(config: OllamaConfig, port = 3078, sharedMcpServer?: MCPServer, scaledProvider?: ScaledOllamaProvider) {
        this.logger = new Logger();
        this.port = port;
        this.mcpServer = sharedMcpServer ?? new MCPServer(config);
        if (scaledProvider) this.scaledProvider = scaledProvider;
        if (!sharedMcpServer) {
            this.logger.warn(
                'HTTPServer created a second MCPServer instance; pass the shared instance from index.ts to avoid duplicate Ollama/agent init'
            );
        }
        this.useHttps = process.env.USE_HTTPS === 'true';
        
        if (this.useHttps) {
            const httpsOptions = this.getHttpsOptions();
            this.server = https.createServer(httpsOptions, this.handleRequest.bind(this));
            this.server.timeout = this.appConfig.server.requestTimeoutMs;
        } else {
            this.server = http.createServer(this.handleRequest.bind(this));
            this.server.timeout = this.appConfig.server.requestTimeoutMs;
        }
        // Track open sockets so stop() can destroy them immediately on shutdown.
        this.server.on('connection', (socket) => {
            this.openSockets.add(socket);
            socket.once('close', () => this.openSockets.delete(socket));
        });
    }

    private static readonly MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const startMs = Date.now();
        const method = req.method ?? 'GET';

        // Capture status code via finish event so metrics are always recorded
        res.on('finish', () => {
            const path = this.coarsePathLabel(req.url ?? '/');
            const status = String(res.statusCode);
            const duration = Date.now() - startMs;
            httpRequestsTotal.inc({ method, path, status });
            httpRequestDurationMs.observe(duration, { method, path });
        });

        const cloudApiKey = req.headers['x-cloud-api-key'] as string | undefined;
        const cloudBaseUrl = req.headers['x-cloud-base-url'] as string | undefined;
        const cloudModel = req.headers['x-cloud-model'] as string | undefined;
        const useCloudModel = req.headers['x-use-cloud-model'] === 'true';

        const resolvedApiKey = cloudApiKey ||
            (useCloudModel ? (process.env.CLOUD_API_KEY || process.env.OPENAI_API_KEY) : undefined);
        const resolvedBaseUrl = cloudBaseUrl ||
            (useCloudModel ? (process.env.CLOUD_BASE_URL || process.env.OPENAI_API_BASE) : undefined);
        const resolvedModel = cloudModel ||
            (useCloudModel ? (process.env.CLOUD_MODEL || process.env.OPENAI_MODEL_NAME) : undefined);

        const cloudSettings = { apiKey: resolvedApiKey, baseUrl: resolvedBaseUrl, model: resolvedModel };

        return await cloudSettingsStorage.run(cloudSettings, () =>
            withTrace(`http:${method}`, async () => {
                const origin = req.headers['origin'] || '';
                if (this.appConfig.server.corsAllowedOrigins.includes(origin)) {
                    res.setHeader('Access-Control-Allow-Origin', origin);
                    res.setHeader('Vary', 'Origin');
                }
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cloud-api-key, x-cloud-base-url, x-cloud-model, x-use-cloud-model');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                const host = this.appConfig.server.host;
                const url = new URL(req.url || '/', `http://${host}:${this.port}`);

                try {
                    if (url.pathname === '/health') {
                        await this.handleHealth(res);
                    } else if (url.pathname === '/api/stats') {
                        await this.handleStats(res);
                    } else if (url.pathname === '/api/dlq') {
                        await this.handleDLQ(req, res, url);
                    } else if (url.pathname === '/metrics') {
                        await this.handleMetrics(res);
                    } else if (url.pathname === '/api/mcp-health') {
                        await this.handleMcpHealth(res);
                    } else if (url.pathname === '/webhook/github' && req.method === 'POST') {
                        await this.handleGitHubWebhook(req, res);
                    } else if (url.pathname.startsWith('/tools/')) {
                        await this.handleToolCall(req, res, url);
                    } else if (url.pathname.startsWith('/stream/')) {
                        await this.handleStream(req, res, url);
                    } else if (url.pathname === '/') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ message: 'MCP-Ollama Server', version: this.appConfig.server.version }));
                    } else {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Not found' }));
                    }
                } catch (error) {
                    this.logger.error('Request handling error:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
            })
        );
    }

    /** Collapse dynamic path segments so metric cardinality stays bounded. */
    private coarsePathLabel(rawUrl: string): string {
        const pathname = rawUrl.split('?')[0];
        if (pathname.startsWith('/tools/')) return '/tools/:name';
        if (pathname.startsWith('/stream/')) return '/stream/:name';
        return pathname;
    }

    /**
     * Probe the embedding backend with a tiny live embed call so degradation to
     * the hash-based fallback (e.g. Ollama OOM) is visible instead of silent.
     * Result is cached briefly to avoid hammering Ollama on every health hit.
     */
    private async getEmbeddingHealth(): Promise<Record<string, unknown>> {
        const now = Date.now();
        if (this.embeddingHealthCache && this.embeddingHealthCache.expiresAt > now) {
            return this.embeddingHealthCache.value;
        }

        let value: Record<string, unknown>;
        try {
            const { EmbeddingService } = await import('../indexing/EmbeddingService.js');
            const svc = new EmbeddingService();
            const vector = await svc.embed('healthcheck');
            const backend = svc.getBackend();
            value = {
                backend,
                healthy: backend === 'ollama',
                host: this.appConfig.ollama.embedHost,
                model: svc.getModel(),
                dimensions: vector.length,
                ...(backend === 'fallback'
                    ? { warning: 'Ollama embeddings unavailable; using degraded hash-based fallback vectors (semantic search quality reduced). Check OLLAMA_EMBED_HOST / GPU memory.' }
                    : {}),
            };
        } catch (error) {
            value = {
                backend: 'fallback',
                healthy: false,
                host: this.appConfig.ollama.embedHost,
                error: error instanceof Error ? error.message : String(error),
            };
        }

        this.embeddingHealthCache = { value, expiresAt: now + 30_000 };
        return value;
    }

    private async handleHealth(res: http.ServerResponse): Promise<void> {
        const host = this.appConfig.server.host;
        const protocol = this.useHttps ? 'https' : 'http';
        let hallucination: unknown = null;
        try {
            const { HallucinationMetrics } = await import('../quality/HallucinationMetrics.js');
            hallucination = HallucinationMetrics.getInstance().getSummary();
        } catch {
            hallucination = null;
        }
        const embeddings = await this.getEmbeddingHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            port: this.port,
            baseUrl: `${protocol}://${host}:${this.port}`,
            embeddings,
            hallucination,
            toolsUrl: `${protocol}://${host}:${this.port}/tools`,
            timestamp: new Date().toISOString(),
        }));
    }

    private async handleStats(res: http.ServerResponse): Promise<void> {
        const scaling = this.scaledProvider ? this.scaledProvider.getSystemStats() : null;
        let circuits: unknown = null;
        try {
            circuits = (this.mcpServer as any).getAgentManager?.()?.getCircuitStats?.() ?? null;
        } catch { /* agent manager not available */ }
        const embeddings = await this.getEmbeddingHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            timestamp: new Date().toISOString(),
            scaling: scaling ?? { message: 'ScaledOllamaProvider not active' },
            circuits,
            embeddings,
            dlq: { size: getDLQ().size() },
        }));
    }

    private async handleMetrics(res: http.ServerResponse): Promise<void> {
        // Snapshot live values into gauges right before rendering
        const dlq = getDLQ();
        dlqSizeGauge.set(dlq.size());

        try {
            const agentManager = (this.mcpServer as any).getAgentManager?.();
            if (agentManager) {
                const STATES: Record<string, number> = { closed: 0, 'half-open': 1, open: 2 };
                const stats: Record<string, { state: string }> = agentManager.getCircuitStats?.() ?? {};
                for (const [role, info] of Object.entries(stats)) {
                    circuitBreakerState.set(STATES[info.state] ?? 0, { role });
                }
            }
        } catch { /* best-effort */ }

        const body = metricsRegistry.format();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(body);
    }

    private async handleMcpHealth(res: http.ServerResponse): Promise<void> {
        const { getMcpClientManager } = await import('../mcp/McpClientManager.js');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getMcpClientManager().getHealth(), null, 2));
    }

    private async handleGitHubWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>(resolve => req.on('end', resolve));

        const rawBody = Buffer.concat(chunks).toString('utf8');
        const signature = req.headers['x-hub-signature-256'] as string | undefined;

        const { PRReviewBot } = await import('../services/PRReviewBot.js');
        if (!PRReviewBot.verifySignature(rawBody, signature)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid webhook signature' }));
            return;
        }

        const event = req.headers['x-github-event'] as string | undefined;
        if (event !== 'pull_request') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ignored: true, event }));
            return;
        }

        let payload: any;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
            return;
        }

        // Acknowledge immediately so GitHub doesn't retry on timeout.
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));

        // Run the review in the background — don't await.
        const ollamaProvider = (this.mcpServer as any).getOllamaProvider?.();
        if (!ollamaProvider) {
            this.logger.warn('[Webhook] No OllamaProvider available for PR review bot');
            return;
        }
        const bot = new PRReviewBot(ollamaProvider);
        bot.handleWebhook(payload).catch(err =>
            this.logger.error(`[Webhook] PR review bot error: ${err}`)
        );
    }

    private async handleDLQ(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
        const dlq = getDLQ();

        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ entries: dlq.list(), size: dlq.size() }));
            return;
        }

        if (req.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (id) {
                const removed = dlq.remove(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ removed }));
            } else {
                dlq.clear();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ cleared: true }));
            }
            return;
        }

        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    getPort(): number {
        return this.port;
    }

    getBaseUrl(): string {
        const host = this.appConfig.server.host;
        const protocol = this.useHttps ? 'https' : 'http';
        return `${protocol}://${host}:${this.port}`;
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
            await new Promise(resolve => setTimeout(resolve, parsePositiveInteger(process.env.STREAM_DELAY_MS, 50)));
        }
        
        res.end();
    }

    private async streamChat(params: any, res: http.ServerResponse): Promise<void> {
        const { message, context, model, messages, language } = params;

        // Pass model + conversation history through to chat_assistant so the
        // streaming path keeps model selection and continuity (parity with the
        // non-streaming contextual chat path).
        const toolArgs: Record<string, unknown> = { query: message };
        if (context !== undefined) {
            toolArgs.context = typeof context === 'string' ? context : JSON.stringify(context);
        }
        if (model) toolArgs.model = model;
        if (Array.isArray(messages) && messages.length > 0) toolArgs.messages = messages;
        if (language) toolArgs.language = language;

        const response = await this.mcpServer.callTool('chat_assistant', toolArgs);

        // chat_assistant returns a plain string; tolerate object shapes too.
        const text =
            typeof response === 'string'
                ? response
                : (response?.response ?? response?.text ?? response?.explanation ?? JSON.stringify(response ?? '')) || 'No response';

        // Stream by whitespace tokens, preserving the original separators so
        // markdown (code blocks, indentation, line breaks) is not mangled.
        const tokens = text.split(/(\s+)/);
        for (const token of tokens) {
            if (token.length === 0) continue;
            res.write(token);
            // Only delay on word tokens, not on the whitespace separators.
            if (!/^\s+$/.test(token)) {
                await new Promise(resolve => setTimeout(resolve, parsePositiveInteger(process.env.CHAT_DELAY_MS, 40)));
            }
        }

        res.end();
    }

    private readRequestBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            let size = 0;
            req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > HTTPServer.MAX_BODY_BYTES) {
                    req.destroy();
                    reject(new Error('Request body too large'));
                    return;
                }
                body += chunk.toString();
            });
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

    public async start(): Promise<void> {
        const autoIncrement = ['1', 'true', 'yes', 'on'].includes(
            (process.env.MCP_PORT_AUTO_INCREMENT || '').toLowerCase()
        );
        const bindPort = autoIncrement
            ? await this.findAvailablePort(this.port)
            : this.port;
        this.port = bindPort;

        return new Promise((resolve, reject) => {
            this.server.listen(this.port, () => {
                const base = this.getBaseUrl();
                this.logger.info(`${this.useHttps ? 'HTTPS' : 'HTTP'} server running on port ${this.port}`);
                this.logger.info(`Health:  ${base}/health`);
                this.logger.info(`Tools:   ${base}/tools/<tool_name>  (e.g. ${base}/tools/agent_execute)`);
                process.env.MCP_SERVER_PORT = this.port.toString();
                process.env.DEFAULT_HTTP_PORT = this.port.toString();
                resolve();
            });

            this.server.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    this.logger.error(
                        `Port ${this.port} is already in use. Stop the other process or set MCP_SERVER_PORT to a free port.`
                    );
                    reject(new Error(`Port ${this.port} is already in use`));
                } else {
                    this.logger.error('Server error:', error);
                    reject(error);
                }
            });
        });
    }

    public async stop(): Promise<void> {
        // Destroy all open sockets so the port is released immediately.
        for (const socket of this.openSockets) socket.destroy();
        this.openSockets.clear();
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
