#!/usr/bin/env node

// Direct test of the running MCP server
const net = require('net');

console.log('🔍 Testing the ALREADY RUNNING MCP server...\n');

// Your MCP server is running as PID 131631
// Let's try to connect to it via stdio (it's designed for stdio communication)

const { spawn } = require('child_process');

// Test by spawning a NEW instance and seeing immediate response
const testServer = spawn('node', ['/home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama/dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    OLLAMA_HOST: 'http://10.10.110.25:11434',
    OLLAMA_MODEL: 'codellama:7b-instruct'
  }
});

console.log('📡 Started test MCP server instance...');

// Listen for immediate output
testServer.stdout.on('data', (data) => {
  console.log('✅ Server Output:', data.toString());
});

testServer.stderr.on('data', (data) => {
  console.log('📋 Server Logs:', data.toString());
});

// Send a simple initialization
setTimeout(() => {
  console.log('📤 Sending initialization...');
  testServer.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'direct-test', version: '1.0.0' }
    }
  }) + '\n');
}, 1000);

// Clean up after 10 seconds
setTimeout(() => {
  console.log('🛑 Stopping test...');
  testServer.kill();
  process.exit(0);
}, 10000);