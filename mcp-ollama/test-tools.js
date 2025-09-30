#!/usr/bin/env node

import { MCPServer } from './dist/server/MCPServer.js';

const config = {
  host: process.env.OLLAMA_HOST || 'http://10.10.110.25:11434',
  model: process.env.OLLAMA_MODEL || 'deepseek-coder-v2:236b',
  timeout: 30000
};

console.log('🧪 Testing All MCP Tools\n');

const testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

async function testTool(name, params) {
  testResults.total++;
  try {
    const server = new MCPServer(config);
    const result = await server.callTool(name, params);
    
    if (result && typeof result === 'object') {
      console.log(`✅ ${name}`);
      testResults.passed++;
      return true;
    } else {
      console.log(`❌ ${name} - Invalid response`);
      testResults.failed++;
      return false;
    }
  } catch (error) {
    console.log(`❌ ${name} - ${error.message}`);
    testResults.failed++;
    return false;
  }
}

async function runAllTests() {
  console.log('Testing Core Tools...');
  
  // Core Tools
  await testTool('code_completion', {
    code: 'function hello() {',
    language: 'javascript',
    position: { line: 0, character: 17 }
  });
  
  await testTool('code_generation', {
    prompt: 'Create a simple calculator function',
    language: 'javascript'
  });
  
  await testTool('code_explanation', {
    code: 'const x = [1,2,3].map(n => n * 2);',
    language: 'javascript'
  });
  
  console.log('\nTesting Error Fixing Tools...');
  
  await testTool('auto_error_fix', {
    errorMessage: 'ReferenceError: x is not defined',
    code: 'console.log(x);',
    language: 'javascript'
  });
  
  await testTool('diagnose_code', {
    code: 'var x = 1; if (x = 2) { console.log("test"); }',
    language: 'javascript'
  });
  
  await testTool('quick_fix', {
    code: 'function test() { return; }',
    language: 'javascript',
    issueType: 'syntax_error',
    issueDescription: 'Missing return value'
  });
  
  console.log('\nTesting Analysis Tools...');
  
  await testTool('code_analysis', {
    code: 'function factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); }',
    language: 'javascript',
    analysisType: 'explanation'
  });
  
  await testTool('security_scan', {
    code: 'eval(userInput);',
    language: 'javascript'
  });
  
  await testTool('optimize_performance', {
    code: 'for(let i=0; i<arr.length; i++) { console.log(arr[i]); }',
    language: 'javascript'
  });
  
  console.log('\nTesting Copilot Features...');
  
  await testTool('inline_suggestion', {
    code: 'const users = [];\nusers.',
    position: { line: 1, character: 6 },
    language: 'javascript'
  });
  
  await testTool('slash_command', {
    command: '/explain',
    code: 'const result = await fetch("/api/data");',
    language: 'javascript'
  });
  
  await testTool('chat_assistant', {
    query: 'How do I handle errors in JavaScript?'
  });
  
  console.log('\nTesting Advanced Features...');
  
  await testTool('translate_code', {
    code: 'def hello(): print("Hello World")',
    fromLanguage: 'python',
    toLanguage: 'javascript'
  });
  
  await testTool('generate_tests', {
    code: 'function add(a, b) { return a + b; }',
    language: 'javascript'
  });
  
  await testTool('generate_docs', {
    code: 'function calculateTax(income, rate) { return income * rate; }',
    language: 'javascript'
  });
  
  await testTool('refactor_code', {
    code: 'var x=1;var y=2;var z=x+y;console.log(z);',
    language: 'javascript',
    focus: 'readability'
  });
  
  console.log('\nTesting Enterprise Features...');
  
  await testTool('multi_model', {
    models: ['codellama:7b-instruct'],
    prompt: 'Explain async/await',
    strategy: 'best'
  });
  
  await testTool('telemetry', {
    event: 'accept',
    suggestionId: 'test-123',
    anonymous: true
  });
  
  await testTool('workspace_analysis', {
    workspaceRoot: '/tmp',
    analysisDepth: 'shallow'
  });
  
  // Summary
  console.log('\n📊 Tool Test Results:');
  console.log(`   Total Tools: ${testResults.total}`);
  console.log(`   Working: ${testResults.passed}`);
  console.log(`   Failed: ${testResults.failed}`);
  console.log(`   Success Rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`);
  
  if (testResults.failed === 0) {
    console.log('\n🎉 All tools are working correctly!');
  } else {
    console.log(`\n⚠️  ${testResults.failed} tool(s) failed. Check Ollama server connection.`);
  }
  
  process.exit(testResults.failed === 0 ? 0 : 1);
}

runAllTests().catch(console.error);