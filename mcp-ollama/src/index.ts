#!/usr/bin/env node

import * as dotenv from 'dotenv';
dotenv.config({ override: false });

import { MCPServer } from './server/MCPServer.js';
import { HTTPServer } from './server/HTTPServer.js';
import { OllamaConfig, ModelConfig } from './types/index.js';
import { Logger } from './utils/Logger.js';
import fetch from 'node-fetch';

const logger = new Logger();

async function main() {
  try {
    // ---- Model / Ollama configuration ----
    const parseTimeout = (value: string | undefined): number => {
      const parsed = Number(value);
      const defaultTimeout = Number(process.env.DEFAULT_TIMEOUT) || 120000;
      return isNaN(parsed) || parsed <= 0 ? defaultTimeout : parsed;
    };
    
    const parsePort = (value: string | undefined): number => {
      const parsed = Number(value);
      const defaultPort = Number(process.env.DEFAULT_MCP_PORT) || 3077;
      return isNaN(parsed) || parsed <= 0 || parsed > 65535 ? defaultPort : parsed;
    };

    // Fetch available models from Ollama server
    const fetchAvailableModels = async (host: string): Promise<ModelConfig[]> => {
      try {
        const response = await fetch(`${host}/api/tags`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
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

    const ollamaHost = process.env.OLLAMA_HOST || `https://localhost:${process.env.OLLAMA_PORT || 11434}`;
    const modelConfigs = await fetchAvailableModels(ollamaHost);

    // Dynamic model selection based on availability and performance
    const selectOptimalModel = (models: ModelConfig[]): string => {
      if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
      
      // Prefer coding models
      const codingModels = models.filter(m => 
        m.name.includes('coder') || m.name.includes('code') || m.name.includes('deepseek')
      );
      
      return codingModels[0]?.name || models[0]?.name || 'deepseek-coder-v2:236b';
    };
    
    const primaryModel = selectOptimalModel(modelConfigs);
    
    const config: OllamaConfig = {
      host: ollamaHost,
      model: primaryModel,
      timeout: parseTimeout(process.env.OLLAMA_TIMEOUT_MS || process.env.COMPLETION_TIMEOUT),
    };
    
    logger.info(`Found ${modelConfigs.length} models: ${modelConfigs.map(m => m.name).join(', ')}`);
    logger.info(`Using primary model: ${primaryModel}`);

    logger.info('Starting MCP-Ollama Server...');
    logger.info(`Configuration: ${JSON.stringify(config, null, 2).replace(/[\r\n]/g, ' ')}`);

    if (!config.host || !config.model) {
      throw new Error('Missing required configuration: OLLAMA_HOST and OLLAMA_MODEL must be set');
    }

    // ---- Create servers ----
    const mcpServer = new MCPServer(config);
    const httpServer = new HTTPServer(config, parsePort(process.env.MCP_SERVER_PORT));

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

    // ---- Capability banner ----
    logger.info('MCP-Ollama Server is running and ready to accept connections');
    const protocol = process.env.USE_HTTPS === 'true' ? 'HTTPS' : 'HTTP';
    logger.info(`${protocol} API available on port ${parsePort(process.env.MCP_SERVER_PORT)}`);
    if (protocol === 'HTTPS') {
      logger.info('SSL certificates should be placed in ./certs/ directory');
    }
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
