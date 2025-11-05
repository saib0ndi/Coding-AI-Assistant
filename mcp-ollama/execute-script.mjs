import fetch from 'node-fetch';

async function executeScript() {
  try {
    console.log('Asking agent to execute the arithmetic operations script...');
    
    const response = await fetch('http://localhost:3077/tools/slash_command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: '/generate',
        code: 'bash ./complete-arithmetic-project.sh',
        language: 'bash'
      })
    });
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(result.result);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

executeScript();