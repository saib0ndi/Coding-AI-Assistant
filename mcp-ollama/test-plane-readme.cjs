const fetch = require('node-fetch');

async function testPlaneReadme() {
  console.log('🔍 Testing Plane Repository README Access');
  console.log('========================================\n');
  
  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MCP-Ollama-Server'
    };
    
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }
    
    // Test 1: Get repository info
    console.log('1. Testing repository access...');
    const repoResponse = await fetch('https://api.github.com/repos/makeplane/plane', { headers });
    
    if (!repoResponse.ok) {
      console.log(`❌ Repository access failed: ${repoResponse.status} ${repoResponse.statusText}`);
      return;
    }
    
    const repoData = await repoResponse.json();
    console.log(`✅ Repository found: ${repoData.name}`);
    console.log(`   Description: ${repoData.description}`);
    console.log(`   Default branch: ${repoData.default_branch}`);
    
    // Test 2: Get README file
    console.log('\n2. Testing README file access...');
    const readmeResponse = await fetch('https://api.github.com/repos/makeplane/plane/contents/README.md', { headers });
    
    if (!readmeResponse.ok) {
      console.log(`❌ README access failed: ${readmeResponse.status} ${readmeResponse.statusText}`);
      
      // Try alternative README files
      const alternatives = ['readme.md', 'Readme.md', 'README.MD', 'readme.txt'];
      for (const alt of alternatives) {
        console.log(`   Trying ${alt}...`);
        const altResponse = await fetch(`https://api.github.com/repos/makeplane/plane/contents/${alt}`, { headers });
        if (altResponse.ok) {
          console.log(`✅ Found alternative: ${alt}`);
          const altData = await altResponse.json();
          const content = Buffer.from(altData.content, 'base64').toString('utf-8');
          console.log(`   Content length: ${content.length} characters`);
          console.log(`   First 200 characters: ${content.substring(0, 200)}...`);
          return;
        }
      }
      
      // List root directory to see what files exist
      console.log('\n   Listing root directory files:');
      const dirResponse = await fetch('https://api.github.com/repos/makeplane/plane/contents/', { headers });
      if (dirResponse.ok) {
        const dirData = await dirResponse.json();
        const files = dirData.filter(item => item.type === 'file').map(item => item.name);
        console.log(`   Files: ${files.join(', ')}`);
      }
      return;
    }
    
    const readmeData = await readmeResponse.json();
    const content = Buffer.from(readmeData.content, 'base64').toString('utf-8');
    
    console.log(`✅ README.md found!`);
    console.log(`   File size: ${readmeData.size} bytes`);
    console.log(`   Content length: ${content.length} characters`);
    console.log(`   SHA: ${readmeData.sha}`);
    
    console.log('\n📄 README Content Preview:');
    console.log('=' .repeat(50));
    console.log(content.substring(0, 500) + '...');
    console.log('=' .repeat(50));
    
    console.log('\n✅ GitHub API access is working correctly!');
    console.log('The issue might be in the extension connection or tool routing.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testPlaneReadme();