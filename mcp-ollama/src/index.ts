#!/usr/bin/env node

import * as dotenv from 'dotenv';
dotenv.config({ override: false }); // let shell env (e.g. PORT) win over .env

import { MCPServer } from './server/MCPServer.js';
import { OllamaConfig } from './types/index.js';
import { Logger } from './utils/Logger.js';
import { RestServer } from './api/RestServer.js';
import { PerformanceTracker } from './analytics/PerformanceTracker.js';
import { TeamManager } from './utils/TeamManager.js';

const logger = new Logger();

async function main() {
  try {
    // ---- Model / Ollama configuration ----
    const parseTimeout = (value: string | undefined): number => {
      const parsed = Number(value);
      return isNaN(parsed) || parsed <= 0 ? 120000 : parsed;
    };
    
    const parsePort = (value: string | undefined): number => {
      const parsed = Number(value);
      return isNaN(parsed) || parsed <= 0 || parsed > 65535 ? 3002 : parsed;
    };

    const config: OllamaConfig = {
      host: process.env.OLLAMA_HOST || 'http://10.10.110.25:11434',
      model: process.env.OLLAMA_MODEL || 'codellama:7b-instruct',
      timeout: parseTimeout(process.env.OLLAMA_TIMEOUT_MS ?? process.env.COMPLETION_TIMEOUT),
    };

    // ---- REST bind configuration (PORT takes precedence) ----
    const restHost = process.env.BIND_HOST || '0.0.0.0';
    const restPort = parsePort(
      process.env.PORT ??
      process.env.MCP_SERVER_PORT ??
      process.env.REST_API_PORT
    );

    logger.info('Starting MCP-Ollama Enhanced Server...');
    logger.info(`Configuration: ${JSON.stringify(config, null, 2).replace(/[\r\n]/g, ' ')}`);
    logger.info(`REST bind target: ${restHost}:${restPort}`);

    if (!config.host || !config.model) {
      throw new Error('Missing required configuration: OLLAMA_HOST and OLLAMA_MODEL must be set');
    }

    // ---- Create services ----
    const mcpServer = new MCPServer(config);
    const restServer = new RestServer(mcpServer, restPort);
    const performanceTracker = new PerformanceTracker();
    const teamManager = new TeamManager(); // kept for initialization side-effects if any
    void teamManager; // avoid unused warning if no methods are called

    // ---- Graceful shutdown ----
    let reportInterval: NodeJS.Timeout;
    
    const graceful = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        if (reportInterval) clearInterval(reportInterval);
        await mcpServer.stop();
      } catch (e) {
        logger.error('Error during shutdown:', e);
        process.exitCode = 1;
      } finally {
        process.exit();
      }
    };
    process.on('SIGINT', () => void graceful('SIGINT'));
    process.on('SIGTERM', () => void graceful('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      const sanitizedReason = typeof reason === 'string' ? reason.replace(/[\r\n]/g, ' ') : 'Unknown rejection';
      logger.error('Unhandled rejection:', sanitizedReason);
      process.exit(1);
    });

    // ---- Start servers ----
    await mcpServer.start();
    await restServer.start();

    // ---- Periodic performance report ----
    reportInterval = setInterval(() => {
      try {
        logger.info('Performance Report:', performanceTracker.generateReport());
      } catch (e) {
        logger.error('Failed to generate performance report:', e);
      }
    }, 60 * 60 * 1000); // hourly

    // ---- Capability banner ----
    logger.info('MCP-Ollama Enhanced Server is running and ready to accept connections');
    logger.info('Server capabilities:');
    logger.info('- Intelligent Code Completion');
    logger.info('- Code Analysis & Explanation');
    logger.info('- Code Generation');
    logger.info('- Auto Error Fixing');
    logger.info('- Real-time Diagnostics');
    logger.info('- Batch Error Processing');
    logger.info('- Error Pattern Analysis');
    logger.info('- Context-aware Suggestions');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to start server: ${msg}`);
    if (error instanceof Error && error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  const sanitizedError = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ') : 'Unknown fatal error';
  console.error('Fatal error:', sanitizedError);
  process.exit(1);
});
