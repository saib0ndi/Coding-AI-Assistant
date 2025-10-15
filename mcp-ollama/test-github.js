#!/usr/bin/env node

// Simple test script to verify GitHub repository access
async function testGitHubAccess() {
  const repoUrl = 'https://github.com/dmis-lab/BERN2';
  
  try {
    console.log('Testing GitHub repository access...');
    console.log('Repository URL:', repoUrl);
    
    // Extract owner and repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error('Invalid GitHub URL format');
    }
    
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}`;
    
    console.log('API URL:', apiUrl);
    
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'MCP-Ollama-Test'
      }
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const repoData = await response.json();
    
    const result = {
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
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('\n✅ SUCCESS: GitHub repository information retrieved');
    console.log('Repository Details:');
    console.log(`- Name: ${result.repository.name}`);
    console.log(`- Full Name: ${result.repository.fullName}`);
    console.log(`- Description: ${result.repository.description}`);
    console.log(`- Language: ${result.repository.language}`);
    console.log(`- Stars: ${result.repository.stars}`);
    console.log(`- Forks: ${result.repository.forks}`);
    console.log(`- Open Issues: ${result.repository.openIssues}`);
    console.log(`- License: ${result.repository.license}`);
    console.log(`- Owner: ${result.repository.owner.login} (${result.repository.owner.type})`);
    console.log(`- Topics: ${result.repository.topics.join(', ')}`);
    
    return result;
    
  } catch (error) {
    console.error('\n❌ ERROR: Failed to access GitHub repository');
    console.error('Error:', error.message);
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Run the test
testGitHubAccess().then(result => {
  console.log('\nTest completed.');
  process.exit(result.success ? 0 : 1);
});