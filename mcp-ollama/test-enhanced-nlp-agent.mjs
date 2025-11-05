#!/usr/bin/env node

import fetch from 'node-fetch';

async function testEnhancedNLPAgent() {
  console.log('🧠 Testing Enhanced NLP Agent with Semantic Understanding');
  console.log('═'.repeat(60));

  const testCases = [
    {
      input: "Create a directory with the name of myproject",
      expected: "create_directory"
    },
    {
      input: "I need you to make a folder called components",
      expected: "create_directory"
    },
    {
      input: "Please implement a user authentication system",
      expected: "implement_feature"
    },
    {
      input: "Fix the bug in the login function",
      expected: "fix_code"
    },
    {
      input: "Generate unit tests for the calculator module",
      expected: "generate_tests"
    },
    {
      input: "Can you create a new file named utils.js",
      expected: "create_file"
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🧪 Testing: "${testCase.input}"`);
    
    try {
      const response = await fetch('http://localhost:3079', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'agent_execute',
            arguments: {
              description: testCase.input,
              type: 'implement',
              context: {
                workspacePath: process.cwd(),
                language: 'typescript'
              },
              priority: 'high'
            }
          }
        })
      });

      const result = await response.json();
      
      if (result.result) {
        const parsed = JSON.parse(result.result.content[0].text);
        console.log(`   ✅ Intent: ${parsed.intent || 'unknown'}`);
        console.log(`   📊 Confidence: ${parsed.confidence || 'N/A'}`);
        console.log(`   🎯 Success: ${parsed.success ? 'YES' : 'NO'}`);
        console.log(`   📝 Summary: ${parsed.summary}`);
        
        if (parsed.intent === testCase.expected) {
          console.log(`   🎉 CORRECT INTENT DETECTED!`);
        } else {
          console.log(`   ⚠️  Expected: ${testCase.expected}, Got: ${parsed.intent}`);
        }
      } else {
        console.log(`   ❌ No result returned`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🎯 NLP AGENT TEST COMPLETE');
  console.log('═'.repeat(60));
}

testEnhancedNLPAgent().catch(console.error);