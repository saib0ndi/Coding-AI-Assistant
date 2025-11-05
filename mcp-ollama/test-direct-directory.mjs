import fetch from 'node-fetch';

async function testDirectoryCreation() {
  try {
    console.log('Testing direct file system tool to create directory...');
    
    const response = await fetch('http://localhost:3077/tools/file_system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_directory',
        path: '/home/sb57213v/Coding-AI-Assistant/mcp-ollama/test-agent-created-dir'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ File System Tool Response:');
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

testDirectoryCreation();