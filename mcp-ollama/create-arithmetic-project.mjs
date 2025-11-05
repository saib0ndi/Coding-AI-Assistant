import fetch from 'node-fetch';

async function createArithmeticProject() {
  try {
    console.log('Asking agent to create arithmetic operations project...');
    
    const response = await fetch('http://localhost:3077/tools/agent_execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `Create directory "arithmetic-operations" and inside it create files: addition.md, subtraction.md, multiplication.md, division.md. Fill each file with detailed information about that arithmetic operation including examples, properties, and use cases.`
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(JSON.stringify(result, null, 2));
    
    // Verify the directory and files were created
    const fs = await import('fs');
    const path = await import('path');
    
    const dirPath = './arithmetic-operations';
    const files = ['addition.md', 'subtraction.md', 'multiplication.md', 'division.md'];
    
    if (fs.existsSync(dirPath)) {
      console.log('✅ Directory created:', dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          console.log(`✅ ${file} created (${content.length} chars)`);
        } else {
          console.log(`❌ ${file} not found`);
        }
      }
    } else {
      console.log('❌ Directory not created');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createArithmeticProject();