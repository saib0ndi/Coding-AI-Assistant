import fetch from 'node-fetch';

async function askAgentCodeGeneration() {
  try {
    console.log('Asking agent to generate code for arithmetic operations project...');
    
    const response = await fetch('http://localhost:3077/tools/code_generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: "Create bash script that: 1) Creates directory 'arithmetic-operations' 2) Creates files addition.md, subtraction.md, multiplication.md, division.md 3) Adds comprehensive content about each arithmetic operation to respective files",
        language: "bash"
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Generated Code:');
    console.log(result.code);
    
    // Save the generated script
    const fs = await import('fs');
    fs.writeFileSync('create-arithmetic-ops.sh', result.code);
    console.log('✅ Script saved as create-arithmetic-ops.sh');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

askAgentCodeGeneration();