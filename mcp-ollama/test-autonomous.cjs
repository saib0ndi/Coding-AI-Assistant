#!/usr/bin/env node

const TEST_WORKSPACE = '/home/sb57213v/test-workspace';
const SERVER_URL = 'http://localhost:3077/mcp';

console.log('🧪 Autonomous Agent Test Commands\n');

// Test 1: Create Directory
console.log('📋 Test 1: Create Directory');
console.log(`curl -X POST ${SERVER_URL} \\
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

console.log('\n📋 Test 2: Smart Implementation');
console.log(`curl -X POST ${SERVER_URL} \\
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

console.log('\n📋 Test 3: Check Status');
console.log(`curl -X POST ${SERVER_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "tools/call",
    "params": {
      "name": "autonomous_status",
      "arguments": {}
    }
  }'`);

console.log('\n💡 Server Configuration:');
console.log('- Ollama Host: http://10.10.110.25:11434');
console.log('- MCP Server: http://localhost:3077');
console.log('- Test Workspace:', TEST_WORKSPACE);
console.log('\n🚀 Start server with: npm start');
console.log('📝 Then run the curl commands above to test autonomous agents');