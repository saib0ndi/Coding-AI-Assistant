import fetch from 'node-fetch';

async function askAgentExecuteAll() {
  try {
    console.log('Asking agent to execute the complete arithmetic operations project...');
    
    // First, ask agent to create the bash script that does everything
    const response = await fetch('http://localhost:3077/tools/code_generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `Create a complete bash script that:
1. Creates directory 'arithmetic-operations'
2. Creates files addition.md, subtraction.md, multiplication.md, division.md
3. Adds comprehensive content about each arithmetic operation to respective files
4. Each file should have detailed explanations, examples, properties, and applications
5. Make it executable and ready to run`,
        language: "bash"
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Generated Complete Script:');
    console.log('=====================================');
    console.log(result.code);
    console.log('=====================================');
    
    // Save the script
    const fs = await import('fs');
    fs.writeFileSync('complete-arithmetic-project.sh', result.code);
    console.log('✅ Complete script saved as complete-arithmetic-project.sh');
    
    console.log('\n🎯 Agent has created the complete arithmetic operations project script!');
    console.log('📁 The script will create:');
    console.log('   - arithmetic-operations/ directory');
    console.log('   - addition.md with comprehensive content');
    console.log('   - subtraction.md with comprehensive content');
    console.log('   - multiplication.md with comprehensive content');
    console.log('   - division.md with comprehensive content');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

askAgentExecuteAll();