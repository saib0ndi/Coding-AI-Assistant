import fetch from 'node-fetch';

async function askAgentArithmetic() {
  try {
    console.log('Asking agent to create arithmetic operations project...');
    
    const response = await fetch('http://localhost:3077/tools/autonomous_execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: "Create a directory called 'arithmetic-operations' and inside it create 4 files: addition.md, subtraction.md, multiplication.md, division.md. Each file should contain comprehensive information about that arithmetic operation including definitions, examples, properties, and real-world applications.",
        context: {
          workspacePath: "/home/sb57213v/Coding-AI-Assistant/mcp-ollama",
          language: "markdown"
        },
        autonomous: true
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Fallback to simpler agent call
    console.log('\nTrying simpler agent request...');
    try {
      const fallbackResponse = await fetch('http://localhost:3077/tools/code_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: "Create bash commands to make directory 'arithmetic-operations' and create files addition.md, subtraction.md, multiplication.md, division.md with content about each operation",
          language: "bash"
        })
      });
      
      if (fallbackResponse.ok) {
        const fallbackResult = await fallbackResponse.json();
        console.log('✅ Fallback Response:');
        console.log(JSON.stringify(fallbackResult, null, 2));
      }
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
    }
  }
}

askAgentArithmetic();