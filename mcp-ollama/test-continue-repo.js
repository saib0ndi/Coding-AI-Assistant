#!/usr/bin/env node

const REPO_URL = 'https://github.com/continuedev/continue';

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

async function getRepoInfo(repoUrl) {
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');
    
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}`;
    
    const repoData = await fetchGitHubAPI(apiUrl);
    
    return {
      success: true,
      repository: {
        name: repoData.name,
        fullName: repoData.full_name,
        description: repoData.description,
        language: repoData.language,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        openIssues: repoData.open_issues_count,
        size: repoData.size,
        createdAt: repoData.created_at,
        updatedAt: repoData.updated_at,
        defaultBranch: repoData.default_branch,
        topics: repoData.topics || [],
        license: repoData.license?.name || 'No license',
        owner: {
          login: repoData.owner.login,
          type: repoData.owner.type
        }
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getDirectoryListing(repoUrl, dirPath = '') {
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');
    
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${dirPath}`;
    
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

async function testContinueRepo() {
  console.log('🔍 Getting Continue Repository Information');
  console.log('Repository:', REPO_URL);
  console.log('=' .repeat(60));
  
  // Get basic repo info
  console.log('\n📊 Repository Information:');
  const repoResult = await getRepoInfo(REPO_URL);
  if (repoResult.success) {
    const repo = repoResult.repository;
    console.log(`✅ Name: ${repo.name}`);
    console.log(`✅ Description: ${repo.description}`);
    console.log(`✅ Language: ${repo.language}`);
    console.log(`✅ Stars: ${repo.stars}`);
    console.log(`✅ Forks: ${repo.forks}`);
    console.log(`✅ Open Issues: ${repo.openIssues}`);
    console.log(`✅ License: ${repo.license}`);
    console.log(`✅ Owner: ${repo.owner.login} (${repo.owner.type})`);
    console.log(`✅ Topics: ${repo.topics.join(', ')}`);
    console.log(`✅ Created: ${new Date(repo.createdAt).toLocaleDateString()}`);
    console.log(`✅ Last Updated: ${new Date(repo.updatedAt).toLocaleDateString()}`);
  } else {
    console.log('❌ Failed to get repo info:', repoResult.error);
  }
  
  // Get root directory
  console.log('\n📁 Root Directory Contents:');
  const rootResult = await getDirectoryListing(REPO_URL);
  if (rootResult.success) {
    console.log(`✅ Found ${rootResult.contents.length} items:`);
    rootResult.contents.slice(0, 15).forEach(item => {
      const icon = item.type === 'dir' ? '📁' : '📄';
      const size = item.size ? `(${item.size} bytes)` : '';
      console.log(`  ${icon} ${item.name} ${size}`);
    });
  } else {
    console.log('❌ Failed to get directory listing:', rootResult.error);
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('🎉 Continue repository analysis completed!');
}

testContinueRepo().catch(console.error);