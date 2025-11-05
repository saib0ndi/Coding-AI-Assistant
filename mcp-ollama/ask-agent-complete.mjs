import fetch from 'node-fetch';

async function askAgentComplete() {
  try {
    console.log('Asking agent to create complete arithmetic operations project...');
    
    const response = await fetch('http://localhost:3077/tools/slash_command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: '/generate',
        code: 'arithmetic-operations project',
        language: 'bash',
        context: 'Create directory arithmetic-operations with files addition.md, subtraction.md, multiplication.md, division.md containing detailed information about each operation'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(result.result);
    
  } catch (error) {
    console.error('❌ Slash command failed:', error.message);
    
    // Try direct agent execution
    console.log('\nTrying direct agent execution...');
    try {
      const directResponse = await fetch('http://localhost:3077/tools/agent_execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: "Execute this task: Create directory 'arithmetic-operations', then create 4 markdown files (addition.md, subtraction.md, multiplication.md, division.md) with comprehensive content about each arithmetic operation including definitions, examples, properties, and applications"
        })
      });
      
      if (directResponse.ok) {
        const directResult = await directResponse.json();
        console.log('✅ Direct Agent Response:');
        console.log(JSON.stringify(directResult, null, 2));
      } else {
        throw new Error(`HTTP ${directResponse.status}`);
      }
    } catch (directError) {
      console.error('❌ Direct execution failed:', directError.message);
      
      // Final fallback - ask for detailed content generation
      console.log('\nTrying content generation...');
      try {
        const contentResponse = await fetch('http://localhost:3077/tools/generate_docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'arithmetic operations: addition, subtraction, multiplication, division',
            language: 'markdown',
            style: 'comprehensive'
          })
        });
        
        if (contentResponse.ok) {
          const contentResult = await contentResponse.json();
          console.log('✅ Content Generation Response:');
          console.log(contentResult.documentation);
        }
      } catch (contentError) {
        console.error('❌ All attempts failed:', contentError.message);
      }
    }
  }
}

askAgentComplete();