#!/usr/bin/env node

const { spawn } = require('child_process');
const { createReadStream, createWriteStream } = require('fs');

class MCPClient {
  constructor() {
    this.requestId = 1;
  }

  async testServer() {
    console.log('🚀 Testing MCP-Ollama Server...\n');
    
    // Start MCP server
    const server = spawn('node', ['/home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama/dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OLLAMA_HOST: 'http://10.10.110.25:11434',
        OLLAMA_MODEL: 'codellama:7b-instruct'
      }
    });

    let responseBuffer = '';

    server.stdout.on('data', (data) => {
      responseBuffer += data.toString();
      this.processResponses(responseBuffer);
    });

    server.stderr.on('data', (data) => {
      console.error('Server Error:', data.toString());
    });

    // Initialize connection
    await this.sendRequest(server, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    });

    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 1: List available tools
    console.log('📋 Test 1: Listing available tools...');
    await this.sendRequest(server, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list'
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: Auto error fix
    console.log('\n🔧 Test 2: Testing auto_error_fix...');
    await this.sendRequest(server, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'auto_error_fix',
        arguments: {
          errorMessage: "TypeError: Cannot read property 'name' of undefined",
          code: "const user = getUser(); console.log(user.name);",
          language: "javascript",
          filePath: "test.js",
          lineNumber: 2
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 3: Code completion
    console.log('\n💡 Test 3: Testing code_completion...');
    await this.sendRequest(server, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'code_completion',
        arguments: {
          code: "function calculateTotal(items) {\n  return items.",
          language: "javascript",
          position: { line: 1, character: 15 }
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n✅ Tests completed!');
    server.kill();
  }

  async sendRequest(server, request) {
    const message = JSON.stringify(request) + '\n';
    server.stdin.write(message);
    console.log('📤 Sent:', request.method);
  }

  processResponses(buffer) {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          console.log('📥 Response:', JSON.stringify(response, null, 2));
        } catch (e) {
          console.log('📥 Raw:', line);
        }
      }
    }
  }
}

// Run the test
const client = new MCPClient();
client.testServer().catch(console.error);
