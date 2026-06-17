#!/usr/bin/env node

// MUST be the first import: loads .env before any other module initializes,
// so import-time singletons (e.g. the shared EmbeddingService) read the
// correct Ollama hosts. See src/env.ts for details.
import './env.js';

import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { MCPServerEnhanced } from './server/MCPServerEnhanced.js';
import { HTTPServer } from './server/HTTPServer.js';
import { OllamaConfig, ModelConfig } from './types/index.js';
import { Logger } from './utils/Logger.js';
import { DEFAULT_HTTP_PORT, DEFAULT_OLLAMA_MODEL, loadAppConfig, parsePositiveInteger } from './config/AppConfig.js';
import { getScaledProvider } from './scaling/ScaledOllamaProvider.js';
import fetch from 'node-fetch';

const logger = new Logger();

function ollamaHeaders(): Record<string, string> {
  const token = loadAppConfig().ollama.authToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function main() {
  try {
    // ---- Model / Ollama configuration ----
    const appConfig = loadAppConfig();
    const parseTimeout = (value: string | undefined): number => {
      const defaultTimeout = parsePositiveInteger(process.env.DEFAULT_TIMEOUT, appConfig.ollama.timeoutMs);
      return parsePositiveInteger(value, defaultTimeout);
    };
    
    const parsePort = (value: string | undefined): number => {
      const parsed = Number(value);
      const defaultPort = DEFAULT_HTTP_PORT;
      return isNaN(parsed) || parsed <= 0 || parsed > 65535 ? defaultPort : parsed;
    };

    // Fetch available models from Ollama server
    const fetchAvailableModels = async (host: string): Promise<ModelConfig[]> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), parseTimeout(process.env.OLLAMA_TIMEOUT_MS));
        
        const response = await fetch(`${host}/api/tags`, {
          headers: ollamaHeaders(),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json() as { models?: any[] };
        const models = data.models || [];
        
        return models.map((model: any) => ({
          name: model.name,
          provider: 'ollama',
          endpoint: host,
          capabilities: ['completion', 'analysis', 'generation', 'explanation', 'error_fixing']
        }));
      } catch (error) {
        const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
        logger.warn(`Failed to fetch models from ${host}: ${sanitizedError}`);
        return [];
      }
    };

    const ollamaHost = appConfig.ollama.host;
    const modelConfigs = await fetchAvailableModels(ollamaHost);

    // Dynamic model selection based on availability and performance
    const selectOptimalModel = (models: ModelConfig[]): string => {
      if (process.env.OLLAMA_MODEL) return appConfig.ollama.model;
      
      // Prefer smaller, faster models for better responsiveness
      const fastModels = models.filter(m => 
        m.name.includes('llama3.1:8b') || 
        m.name.includes('qwen2.5:14b') ||
        m.name.includes('qwen2.5:7b') ||
        m.name.includes('deepseek-coder-v2:236b') ||
        m.name.includes('llama3.2')
      );
      
      // Prioritize by speed (smaller models first)
      const priorityOrder = [
        DEFAULT_OLLAMA_MODEL,
        'llama3.2:latest', 
        'qwen2.5:14b-instruct-q4_K_M',
        'qwen2.5:7b-instruct-q4_K_M',
        'deepseek-coder-v2:236b'
      ];
      
      for (const preferred of priorityOrder) {
        const found = models.find(m => m.name === preferred);
        if (found) return found.name;
      }
      
      return fastModels[0]?.name || models[0]?.name || DEFAULT_OLLAMA_MODEL;
    };
    
    const primaryModel = selectOptimalModel(modelConfigs);
    
    const config: OllamaConfig = {
      host: ollamaHost,
      model: primaryModel,
      timeout: appConfig.ollama.timeoutMs,
    };
    
    logger.info(`Found ${modelConfigs.length} models: ${modelConfigs.map(m => m.name).join(', ')}`);
    logger.info(`Using primary model: ${primaryModel}`);

    logger.info('Starting MCP-Ollama Server...');
    logger.info(`Configuration: ${JSON.stringify(config, null, 2).replace(/[\r\n]/g, ' ')}`);

    if (!config.host || !config.model) {
      throw new Error('Missing required configuration: OLLAMA_HOST and OLLAMA_MODEL must be set');
    }

    // ---- Create servers ----
    // Shared singleton — the agent request path (AgentOllamaRegistry) routes
    // through the same instance, so /api/stats reflects real traffic.
    const scaledProvider = getScaledProvider();
    const mcpServer = new MCPServerEnhanced(config);
    const httpPort = parsePort(process.env.PORT || process.env.MCP_SERVER_PORT) || appConfig.server.port;
    const httpServer = new HTTPServer(config, httpPort, mcpServer, scaledProvider);

    // ---- Graceful shutdown ----
    const graceful = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await Promise.all([
          mcpServer.stop(),
          httpServer.stop()
        ]);
      } catch (e) {
        const sanitizedError = e instanceof Error ? e.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
        logger.error(`Error during shutdown: ${sanitizedError}`);
        process.exitCode = 1;
      } finally {
        process.exit();
      }
    };
    process.on('SIGINT', () => void graceful('SIGINT'));
    process.on('SIGTERM', () => void graceful('SIGTERM'));

    process.on('uncaughtException', (error) => {
      const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
      logger.error(`Uncaught exception: ${sanitizedError}`);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      const sanitizedReason = typeof reason === 'string' ? reason.replace(/[\r\n]/g, ' ') : 'Unknown rejection';
      logger.error('Unhandled rejection:', sanitizedReason);
      process.exit(1);
    });

    // ---- Start servers ----
    await Promise.all([
      mcpServer.start(),
      httpServer.start()
    ]);

    // ---- Agent health check ----
    const agentHealth = await mcpServer.getAgentManager().initialize();
    if (!agentHealth.healthy) {
      logger.warn('No agent providers are reachable — check OLLAMA_HOST and model availability');
    }

    // ---- Capability banner ----
    logger.info('MCP-Ollama Server is running and ready to accept connections');
    const baseUrl = httpServer.getBaseUrl();
    logger.info(`HTTP API: ${baseUrl}`);
    logger.info(`Example: curl -s ${baseUrl}/health | jq .port`);
    logger.info('Server capabilities:');
    logger.info('- Code Completion & Analysis');
    logger.info('- Code Generation & Explanation');
    logger.info('- Auto Error Fixing');
    logger.info('- Real-time Diagnostics');
    logger.info('- Context-aware Suggestions');
    logger.info('- HTTP REST API & Streaming');
  } catch (error) {
    const msg = error instanceof Error ? error.message.replace(/[\r\n\t]/g, '_') : 'Unknown error';
    logger.error(`Failed to start server: ${msg}`);
    if (error instanceof Error && error.stack) {
      const sanitizedStack = error.stack.replace(/[\r\n\t]/g, '_');
      logger.error(`Stack trace: ${sanitizedStack}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ') : 'Unknown fatal error';
  console.error('Fatal error:', sanitizedError);
  process.exit(1);
});
