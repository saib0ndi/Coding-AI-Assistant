#!/usr/bin/env node

import { MCPServerEnhanced } from './dist/server/MCPServerEnhanced.js';

const config = {
  host: process.env.OLLAMA_HOST || 'http://10.10.110.25:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_K_M',
  timeout: 30000
};

async function clearCache() {
  try {
    const server = new MCPServerEnhanced(config);
    
    const result = await server.callTool('persistent_cache', {
      action: 'clear'
    });
    
    console.log('✅ Cache cleared successfully:', result);
  } catch (error) {
    console.error('❌ Failed to clear cache:', error.message);
  }
}

clearCache();