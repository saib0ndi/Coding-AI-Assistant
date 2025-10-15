const fetch = require('node-fetch');

async function getClientFiles() {
  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MCP-Ollama-Server'
    };
    
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }
    
    const response = await fetch('https://api.github.com/repos/modelcontextprotocol/typescript-sdk/contents/src/client', {
      headers
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('📁 Files in /src/client directory:');
    console.log('=====================================');
    
    data.forEach(item => {
      const icon = item.type === 'dir' ? '📂' : '📄';
      const size = item.size ? ` (${Math.round(item.size / 1024)}KB)` : '';
      console.log(`${icon} ${item.name}${size}`);
    });
    
    console.log(`\n📊 Total: ${data.length} items`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getClientFiles();