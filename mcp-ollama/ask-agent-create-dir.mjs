import fetch from 'node-fetch';

async function askAgentCreateDirectory() {
  try {
    console.log('Asking agent to create arithmetic-operations directory...');
    
    const response = await fetch('http://localhost:3077/tools/agent_execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: "create directory arithmetic-operations"
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(JSON.stringify(result, null, 2));
    
    // Check if directory was created
    const fs = await import('fs');
    if (fs.existsSync('./arithmetic-operations')) {
      console.log('✅ Directory successfully created!');
    } else {
      console.log('❌ Directory not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

askAgentCreateDirectory();