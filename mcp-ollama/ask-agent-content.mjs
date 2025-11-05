import fetch from 'node-fetch';

async function askAgentForContent() {
  const operations = ['addition', 'subtraction', 'multiplication', 'division'];
  
  console.log('Asking agent to generate content for each arithmetic operation...');
  
  for (const operation of operations) {
    try {
      console.log(`\n📝 Generating content for ${operation}...`);
      
      const response = await fetch('http://localhost:3077/tools/generate_docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: `${operation} arithmetic operation`,
          language: 'markdown',
          style: 'comprehensive'
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log(`✅ Content for ${operation}.md:`);
      console.log('---');
      console.log(result.documentation);
      console.log('---');
      
    } catch (error) {
      console.error(`❌ Failed to generate content for ${operation}:`, error.message);
    }
  }
}

askAgentForContent();