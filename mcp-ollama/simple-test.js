#!/usr/bin/env node

// Simple test without server startup
const TEST_WORKSPACE = process.env.TEST_WORKSPACE || '/tmp/mcp-ollama-test-workspace';

console.log('🧪 Simple Autonomous Agent Test\n');

// Create test workspace
const fs = require('fs');
if (!fs.existsSync(TEST_WORKSPACE)) {
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
  console.log('✅ Created test workspace:', TEST_WORKSPACE);
}

// Test: Create directory
console.log('\n📋 Test 1: Create Directory');
console.log('Command:');
console.log(`curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "tools/call",
    "params": {
      "name": "autonomous_execute",
      "arguments": {
        "description": "create a directory called title",
        "context": {"workspacePath": "${TEST_WORKSPACE}"}
      }
    }
  }'`);

// Test: Smart implementation
console.log('\n📋 Test 2: Smart Implementation');
console.log('Command:');
console.log(`curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "tools/call",
    "params": {
      "name": "smart_implement",
      "arguments": {
        "feature": "Create a simple calculator function",
        "workspacePath": "${TEST_WORKSPACE}",
        "language": "javascript",
        "requirements": ["Add, subtract, multiply, divide"]
      }
    }
  }'`);

// Test: Check status
console.log('\n📋 Test 3: Check Status');
console.log('Command:');
console.log(`curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "tools/call",
    "params": {
      "name": "autonomous_status",
      "arguments": {}
    }
  }'`);

console.log('\n💡 Instructions:');
console.log('1. Start the MCP server: npm start');
console.log('2. Run the curl commands above in another terminal');
console.log('3. Watch the autonomous agent work!');
