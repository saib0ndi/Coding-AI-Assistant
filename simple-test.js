#!/usr/bin/env node

const { spawn } = require('child_process');

async function testMCPTool() {
  console.log('🧪 Testing MCP auto_error_fix tool...\n');
  
  const server = spawn('node', ['/home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama/dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OLLAMA_HOST: 'http://10.10.110.25:11434',
      OLLAMA_MODEL: 'codellama:7b-instruct'
    }
  });

  // Initialize
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test auto_error_fix
  console.log('📤 Sending auto_error_fix request...');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'auto_error_fix',
      arguments: {
        errorMessage: "TypeError: Cannot read property 'name' of undefined",
        code: "const user = getUser(); console.log(user.name);",
        language: "javascript"
      }
    }
  }) + '\n');

  let responseData = '';
  server.stdout.on('data', (data) => {
    responseData += data.toString();
    const lines = responseData.split('\n');
    
    for (const line of lines) {
      if (line.trim() && line.startsWith('{')) {
        try {
          const response = JSON.parse(line);
          if (response.id === 2 && response.result) {
            console.log('✅ Got fix response!');
            console.log('📋 Result:', JSON.stringify(response.result, null, 2));
            server.kill();
            return;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  });

  server.stderr.on('data', (data) => {
    const output = data.toString();
    if (!output.includes('[INFO]')) {
      console.log('❌ Error:', output);
    }
  });

  setTimeout(() => {
    console.log('⏰ Test timeout - killing server');
    server.kill();
  }, 15000);
}

testMCPTool().catch(console.error);