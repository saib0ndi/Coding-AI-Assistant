#!/usr/bin/env node

const REPO_URL = 'https://github.com/dmis-lab/BERN2';

async function fetchGitHubAPI(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MCP-Ollama-Test'
    }
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

async function getFileContent(repoUrl, filePath, branch = 'main') {
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');
    
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${filePath}?ref=${branch}`;
    
    const data = await fetchGitHubAPI(apiUrl);
    
    return {
      success: true,
      file: {
        name: data.name,
        path: data.path,
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        size: data.size,
        sha: data.sha
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getDirectoryListing(repoUrl, dirPath = '', branch = 'main') {
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');
    
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${dirPath}?ref=${branch}`;
    
    const data = await fetchGitHubAPI(apiUrl);
    
    return {
      success: true,
      contents: Array.isArray(data) ? data.map(item => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size
      })) : []
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testSpecificRepoInfo() {
  console.log('🔍 Testing Specific GitHub Repository Information Access');
  console.log('Repository:', REPO_URL);
  console.log('=' .repeat(60));
  
  // Test 1: Get README file
  console.log('\n📄 Test 1: Getting README.md file...');
  const readmeResult = await getFileContent(REPO_URL, 'README.md');
  if (readmeResult.success) {
    console.log('✅ SUCCESS: README.md retrieved');
    console.log(`- File size: ${readmeResult.file.size} bytes`);
    console.log(`- First 200 characters:`);
    console.log(readmeResult.file.content.substring(0, 200) + '...');
  } else {
    console.log('❌ FAILED:', readmeResult.error);
  }
  
  // Test 2: Get root directory listing
  console.log('\n📁 Test 2: Getting root directory listing...');
  const rootResult = await getDirectoryListing(REPO_URL);
  if (rootResult.success) {
    console.log('✅ SUCCESS: Root directory listing retrieved');
    console.log(`- Found ${rootResult.contents.length} items:`);
    rootResult.contents.slice(0, 10).forEach(item => {
      console.log(`  ${item.type === 'dir' ? '📁' : '📄'} ${item.name} (${item.size || 0} bytes)`);
    });
  } else {
    console.log('❌ FAILED:', rootResult.error);
  }
  
  // Test 3: Get specific Python file
  console.log('\n🐍 Test 3: Getting a Python file...');
  const pythonResult = await getFileContent(REPO_URL, 'setup.py');
  if (pythonResult.success) {
    console.log('✅ SUCCESS: setup.py retrieved');
    console.log(`- File size: ${pythonResult.file.size} bytes`);
    console.log('- Content preview:');
    console.log(pythonResult.file.content.substring(0, 300) + '...');
  } else {
    console.log('❌ FAILED:', pythonResult.error);
  }
  
  // Test 4: Get subdirectory listing
  console.log('\n📂 Test 4: Getting subdirectory listing...');
  const subDirResult = await getDirectoryListing(REPO_URL, 'bern2');
  if (subDirResult.success) {
    console.log('✅ SUCCESS: bern2/ directory listing retrieved');
    console.log(`- Found ${subDirResult.contents.length} items:`);
    subDirResult.contents.slice(0, 5).forEach(item => {
      console.log(`  ${item.type === 'dir' ? '📁' : '📄'} ${item.name}`);
    });
  } else {
    console.log('❌ FAILED:', subDirResult.error);
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('🎉 Specific repository information access test completed!');
}

testSpecificRepoInfo().catch(console.error);