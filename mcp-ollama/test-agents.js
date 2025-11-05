#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const SERVER_PORT = 3000;
const TEST_WORKSPACE = '/home/sb57213v/test-workspace';

// Create test workspace
const fs = require('fs');
if (!fs.existsSync(TEST_WORKSPACE)) {
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

console.log('🚀 Starting Autonomous Agent Tests...\n');

// Test cases
const tests = [
  {
    name: 'Simple Directory Creation',
    tool: 'autonomous_execute',
    args: {
      description: 'create a directory called title',
      context: { workspacePath: TEST_WORKSPACE }
    }
  },
  {
    name: 'Smart Feature Implementation',
    tool: 'smart_implement',
    args: {
      feature: 'Create a simple calculator function',
      workspacePath: TEST_WORKSPACE,
      language: 'javascript',
      requirements: ['Add, subtract, multiply, divide operations']
    }
  },
  {
    name: 'File Creation Task',
    tool: 'autonomous_execute',
    args: {
      description: 'create a hello world JavaScript file',
      context: { 
        workspacePath: TEST_WORKSPACE,
        language: 'javascript'
      }
    }
  },
  {
    name: 'Task Status Check',
    tool: 'autonomous_status',
    args: {}
  }
];

async function runTest(test) {
  console.log(`\n📋 Test: ${test.name}`);
  console.log(`🔧 Tool: ${test.tool}`);
  console.log(`📝 Args:`, JSON.stringify(test.args, null, 2));
  
  const payload = {
    method: 'tools/call',
    params: {
      name: test.tool,
      arguments: test.args
    }
  };

  try {
    const response = await fetch(`http://localhost:${SERVER_PORT}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ Result:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.log('❌ Error:', error.message);
    return null;
  }
}

async function startServer() {
  console.log('🔄 Starting MCP Server...');
  
  const server = spawn('npm', ['start'], {
    cwd: __dirname,
    stdio: 'pipe'
  });

  server.stdout.on('data', (data) => {
    const output = data.toString();
    if (output.includes('started') || output.includes('listening')) {
      console.log('✅ Server started');
    }
  });

  server.stderr.on('data', (data) => {
    console.log('Server:', data.toString().trim());
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  return server;
}

async function runAllTests() {
  let server;
  
  try {
    // Start server
    server = await startServer();
    
    // Wait a bit more for full startup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n🧪 Running Autonomous Agent Tests...\n');
    
    // Run tests sequentially
    for (const test of tests) {
      await runTest(test);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between tests
    }
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  } finally {
    if (server) {
      console.log('\n🛑 Stopping server...');
      server.kill();
    }
  }
}

// Alternative: Manual test mode
if (process.argv.includes('--manual')) {
  console.log('📖 Manual Test Mode - Server should be running on port 3000');
  console.log('Run these commands manually:\n');
  
  tests.forEach((test, i) => {
    console.log(`${i + 1}. ${test.name}:`);
    console.log(`curl -X POST http://localhost:3000/mcp \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '${JSON.stringify({
      method: 'tools/call',
      params: { name: test.tool, arguments: test.args }
    })}'`);
    console.log('');
  });
} else {
  runAllTests();
}