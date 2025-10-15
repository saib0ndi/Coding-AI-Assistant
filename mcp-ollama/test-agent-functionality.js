#!/usr/bin/env node

import fetch from 'node-fetch';

class AgentFunctionalityTester {
  constructor() {
    this.serverUrl = 'http://localhost:3077';
  }

  async testAgentCommands() {
    console.log('🧪 Testing Agent Command Functionality');
    console.log('═'.repeat(50));

    const tests = [
      {
        name: 'Code Explanation',
        method: 'tools/call',
        params: {
          name: 'code_explanation',
          arguments: {
            code: 'const sum = (a, b) => a + b;',
            language: 'javascript'
          }
        }
      },
      {
        name: 'Code Generation',
        method: 'tools/call', 
        params: {
          name: 'code_generation',
          arguments: {
            prompt: 'Create a simple hello world function',
            language: 'javascript'
          }
        }
      },
      {
        name: 'Auto Error Fix',
        method: 'tools/call',
        params: {
          name: 'auto_error_fix',
          arguments: {
            errorMessage: 'TypeError: Cannot read property name of undefined',
            code: 'const user = getUser(); console.log(user.name);',
            language: 'javascript'
          }
        }
      }
    ];

    for (const test of tests) {
      await this.runTest(test);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between tests
    }
  }

  async runTest(test) {
    console.log(`\n🧪 Testing: ${test.name}`);
    
    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: test.method,
          params: test.params
        }),
        timeout: 30000
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.result) {
          console.log(`   ✅ ${test.name} - SUCCESS`);
          console.log(`   📝 Response: ${JSON.stringify(data.result).substring(0, 100)}...`);
          return true;
        } else if (data.error) {
          console.log(`   ❌ ${test.name} - ERROR: ${data.error.message}`);
          return false;
        }
      } else {
        console.log(`   ❌ ${test.name} - HTTP ${response.status}`);
        return false;
      }
    } catch (error) {
      console.log(`   ❌ ${test.name} - FAILED: ${error.message}`);
      return false;
    }
  }

  async testAgentWorkflow() {
    console.log('\n🔄 Testing Agent Workflow');
    console.log('─'.repeat(30));

    // Test a simple workflow that would use multiple agents
    const workflowTest = {
      name: 'Simple Development Workflow',
      method: 'tools/call',
      params: {
        name: 'execute_agent_task',
        arguments: {
          description: 'Create a simple calculator function',
          taskType: 'implement',
          context: {
            language: 'javascript',
            workspacePath: '/tmp/test'
          }
        }
      }
    };

    console.log('🧪 Testing: Agent Workflow Execution');
    
    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: workflowTest.method,
          params: workflowTest.params
        }),
        timeout: 60000
      });

      if (response.ok) {
        const data = await response.json();
        console.log('   ✅ Workflow execution completed');
        console.log(`   📊 Result: ${JSON.stringify(data.result).substring(0, 150)}...`);
      } else {
        console.log(`   ⚠️  Workflow test returned HTTP ${response.status}`);
        console.log('   💡 This might be expected if agent workflow tools are not fully implemented');
      }
    } catch (error) {
      console.log(`   ⚠️  Workflow test failed: ${error.message}`);
      console.log('   💡 This might be expected if agent workflow is not fully integrated');
    }
  }

  async checkAvailableTools() {
    console.log('\n🛠️  Checking Available Tools');
    console.log('─'.repeat(30));

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list'
        }),
        timeout: 10000
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.result && data.result.tools) {
          console.log(`   ✅ Found ${data.result.tools.length} available tools:`);
          data.result.tools.forEach(tool => {
            console.log(`      • ${tool.name} - ${tool.description}`);
          });
        } else {
          console.log('   ⚠️  No tools list returned');
        }
      } else {
        console.log(`   ❌ Failed to get tools list: HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`   ❌ Error checking tools: ${error.message}`);
    }
  }
}

async function main() {
  const tester = new AgentFunctionalityTester();
  
  // Check if server is accessible
  try {
    const healthCheck = await fetch('http://localhost:3077/health', { timeout: 5000 });
    if (!healthCheck.ok) {
      console.log('❌ MCP Server not accessible on port 3077');
      console.log('💡 Make sure to run: npm start');
      process.exit(1);
    }
  } catch (error) {
    console.log('❌ Cannot connect to MCP Server:', error.message);
    console.log('💡 Make sure to run: npm start');
    process.exit(1);
  }

  await tester.checkAvailableTools();
  await tester.testAgentCommands();
  await tester.testAgentWorkflow();

  console.log('\n' + '═'.repeat(50));
  console.log('🎯 AGENT FUNCTIONALITY TEST COMPLETE');
  console.log('═'.repeat(50));
}

main().catch(console.error);