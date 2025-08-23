#!/usr/bin/env node

import { MCPServer } from './server/MCPServer.js';
import { OllamaConfig } from './types/index.js';
import { Logger } from './utils/Logger.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const logger = new Logger();

async function main() {
  try {
    // Parse environment configuration
    const config: OllamaConfig = {
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'codellama:7b-instruct',
      timeout: parseInt(process.env.COMPLETION_TIMEOUT || '5000')
    };

    logger.info('Starting MCP-Ollama Enhanced Server...');
    logger.info(`Configuration: ${JSON.stringify(config, null, 2)}`);

    // Validate required environment variables
    if (!config.host || !config.model) {
      throw new Error('Missing required configuration: OLLAMA_HOST and OLLAMA_MODEL must be set');
    }

    // Create and start the MCP server
    const server = new MCPServer(config);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      try {
        await server.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      try {
        await server.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection, reason:', reason);
      process.exit(1);
    });

    // Start the server
    await server.start();
    
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to start server: ${errorMessage}`);
    
    if (error instanceof Error && error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
