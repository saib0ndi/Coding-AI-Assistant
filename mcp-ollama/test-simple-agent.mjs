import fetch from 'node-fetch';

async function testSimpleAgent() {
  try {
    console.log('Asking agent to create directory with simple request...');
    
    const response = await fetch('http://localhost:3077/tools/agent_execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'create directory named my-new-folder'
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
    const path = '/home/sb57213v/Coding-AI-Assistant/mcp-ollama/my-new-folder';
    
    if (fs.existsSync(path)) {
      console.log('✅ Directory successfully created at:', path);
    } else {
      console.log('❌ Directory was not created at expected location');
      
      // Check current directory
      const currentDir = process.cwd();
      const localPath = `${currentDir}/my-new-folder`;
      if (fs.existsSync(localPath)) {
        console.log('✅ Directory found at:', localPath);
      } else {
        console.log('❌ Directory not found in current directory either');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testSimpleAgent();