/**
 * McpClientManager — federate tools from external MCP servers.
 *
 * Configuration (env or AGENTS.md front-matter is the future goal; for now env):
 *   MCP_OLLAMA_REMOTE_SERVERS=<name>:<url>[,<name>:<url> ...]
 *
 * Example:
 *   MCP_OLLAMA_REMOTE_SERVERS=github:http://localhost:9000,linear:http://localhost:9001
 *
 * Each remote server is expected to expose:
 *   GET  /tools         → { tools: [{ name, description, inputSchema }] }
 *   POST /tools/<name>  → { result: any }
 *
 * Federated tools are registered with the local MCP server under the name
 *   <serverName>/<toolName>
 * to avoid collisions.
 *
 * The manager reconnects automatically (exponential backoff) and surfaces
 * server health via getHealth().
 */

import { Logger } from '../utils/Logger.js';

export interface RemoteToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface RemoteServerConfig {
    name: string;
    url: string;
}

export interface FederatedTool {
    federatedName: string;  // e.g. "github/search_issues"
    serverName: string;
    toolName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    invoke: (args: unknown) => Promise<unknown>;
}

interface ServerState {
    config: RemoteServerConfig;
    tools: FederatedTool[];
    healthy: boolean;
    lastError?: string;
    retryCount: number;
    retryTimer?: ReturnType<typeof setTimeout>;
}

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

function backoff(retryCount: number): number {
    return Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS);
}

export class McpClientManager {
    private servers = new Map<string, ServerState>();
    private logger: Logger;

    constructor() {
        this.logger = new Logger();
        this.loadFromEnv();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /** Add (or replace) a remote MCP server at runtime. */
    async addServer(config: RemoteServerConfig): Promise<void> {
        const existing = this.servers.get(config.name);
        if (existing?.retryTimer) clearTimeout(existing.retryTimer);
        const state: ServerState = { config, tools: [], healthy: false, retryCount: 0 };
        this.servers.set(config.name, state);
        await this.connect(state);
    }

    /** Remove a remote server and clear its tools. */
    removeServer(name: string): void {
        const state = this.servers.get(name);
        if (state?.retryTimer) clearTimeout(state.retryTimer);
        this.servers.delete(name);
    }

    /** Return all federated tools from all healthy servers. */
    getFederatedTools(): FederatedTool[] {
        const out: FederatedTool[] = [];
        for (const state of this.servers.values()) {
            if (state.healthy) out.push(...state.tools);
        }
        return out;
    }

    /** Health summary for observability endpoints. */
    getHealth(): Record<string, { healthy: boolean; tools: number; lastError?: string }> {
        const result: Record<string, { healthy: boolean; tools: number; lastError?: string }> = {};
        for (const [name, state] of this.servers) {
            const entry: { healthy: boolean; tools: number; lastError?: string } = {
                healthy: state.healthy,
                tools: state.tools.length,
            };
            if (state.lastError !== undefined) entry.lastError = state.lastError;
            result[name] = entry;
        }
        return result;
    }

    /** Shutdown — cancel all pending timers. */
    dispose(): void {
        for (const state of this.servers.values()) {
            if (state.retryTimer) clearTimeout(state.retryTimer);
        }
        this.servers.clear();
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    private loadFromEnv(): void {
        const raw = process.env.MCP_OLLAMA_REMOTE_SERVERS?.trim();
        if (!raw) return;
        for (const entry of raw.split(',')) {
            const colon = entry.indexOf(':');
            if (colon < 1) continue;
            const name = entry.slice(0, colon).trim();
            const url = entry.slice(colon + 1).trim();
            if (name && url) {
                // Fire-and-forget; errors are handled internally.
                this.addServer({ name, url }).catch(() => void 0);
            }
        }
    }

    private async connect(state: ServerState): Promise<void> {
        try {
            const defs = await this.fetchTools(state.config.url);
            state.tools = defs.map(def => this.buildFederatedTool(state.config, def));
            state.healthy = true;
            delete state.lastError;
            state.retryCount = 0;
            this.logger.info(`[MCP consumer] Connected to "${state.config.name}" — ${state.tools.length} tools`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            state.healthy = false;
            state.tools = [];
            state.lastError = msg;
            this.logger.warn(`[MCP consumer] Failed to connect to "${state.config.name}": ${msg}`);
            this.scheduleRetry(state);
        }
    }

    private scheduleRetry(state: ServerState): void {
        if (state.retryCount >= MAX_RETRIES) {
            this.logger.warn(`[MCP consumer] Giving up on "${state.config.name}" after ${MAX_RETRIES} retries`);
            return;
        }
        const delay = backoff(state.retryCount++);
        const timer = setTimeout(() => {
            delete state.retryTimer;
            this.connect(state).catch(() => void 0);
        }, delay);
        // Prevent the retry timer from holding the event loop open.
        timer.unref?.();
        state.retryTimer = timer;
    }

    private async fetchTools(serverUrl: string): Promise<RemoteToolDef[]> {
        const url = serverUrl.replace(/\/$/, '') + '/tools';
        // Use native fetch (Node 18+) — no extra dependency.
        const res = await (globalThis.fetch as typeof fetch)(url, {
            signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
        const body = await res.json() as { tools?: RemoteToolDef[] };
        if (!Array.isArray(body?.tools)) throw new Error(`${url} did not return a "tools" array`);
        return body.tools;
    }

    private buildFederatedTool(cfg: RemoteServerConfig, def: RemoteToolDef): FederatedTool {
        const federatedName = `${cfg.name}/${def.name}`;
        const invoke = async (args: unknown): Promise<unknown> => {
            const url = cfg.url.replace(/\/$/, '') + `/tools/${def.name}`;
            const res = await (globalThis.fetch as typeof fetch)(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args),
                signal: AbortSignal.timeout(30_000),
            });
            if (!res.ok) throw new Error(`POST ${url} returned ${res.status}`);
            const body = await res.json() as { result?: unknown };
            return body?.result ?? body;
        };
        return {
            federatedName,
            serverName: cfg.name,
            toolName: def.name,
            description: `[${cfg.name}] ${def.description}`,
            inputSchema: def.inputSchema,
            invoke,
        };
    }
}

// Singleton accessor — mirrors the pattern used by ScaledOllamaProvider.
let _instance: McpClientManager | null = null;
export function getMcpClientManager(): McpClientManager {
    if (!_instance) _instance = new McpClientManager();
    return _instance;
}
