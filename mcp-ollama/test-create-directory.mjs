import fetch from 'node-fetch';

async function testAgentCreateDirectory() {
  try {
    console.log('Asking agent to create a directory...');
    
    const response = await fetch('http://localhost:3077/tools/agent_execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Create a new directory called "test-agent-created-dir" in the current workspace',
        context: { 
          workingDirectory: '/home/sb57213v/Coding-AI-Assistant/mcp-ollama',
          task: 'directory_creation',
          language: 'bash'
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(JSON.stringify(result, null, 2));
    
    // Check if directory was actually created
    const fs = await import('fs');
    const path = '/home/sb57213v/Coding-AI-Assistant/mcp-ollama/test-agent-created-dir';
    
    if (fs.existsSync(path)) {
      console.log('✅ Directory successfully created at:', path);
    } else {
      console.log('❌ Directory was not created');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAgentCreateDirectory();