import fetch from 'node-fetch';

async function testAgentDirectoryCapability() {
  console.log('🔍 Testing Agent Directory Creation Capabilities...\n');
  
  const tests = [
    {
      name: 'Agent Execute',
      endpoint: '/tools/agent_execute',
      payload: { description: 'create directory test-dir-1' }
    },
    {
      name: 'File System Operation', 
      endpoint: '/tools/file_system_operation',
      payload: { operation: 'create_directory', path: './test-dir-2' }
    },
    {
      name: 'Build Operation',
      endpoint: '/tools/build_operation', 
      payload: { operation: 'install', workspacePath: '.', script: 'mkdir test-dir-3' }
    },
    {
      name: 'Autonomous Execute',
      endpoint: '/tools/autonomous_execute',
      payload: { description: 'create directory test-dir-4', autonomous: true }
    }
  ];
  
  for (const test of tests) {
    try {
      console.log(`Testing: ${test.name}`);
      
      const response = await fetch(`http://localhost:3077${test.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.payload)
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`✅ ${test.name}: Available`);
        console.log(`   Response: ${JSON.stringify(result).substring(0, 100)}...`);
      } else {
        console.log(`❌ ${test.name}: HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
    }
    console.log('');
  }
  
  // Test what actually works
  console.log('🎯 Testing What Actually Creates Directories:\n');
  
  try {
    const response = await fetch('http://localhost:3077/tools/code_generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'create bash command to make directory test-agent-dir',
        language: 'bash'
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Code Generation Works:');
      console.log(`   Generated: ${result.code}`);
    }
  } catch (error) {
    console.log('❌ Code Generation Failed');
  }
}

testAgentDirectoryCapability();