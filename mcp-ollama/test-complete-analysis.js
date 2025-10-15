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

async function getCompleteAnalysis(repoUrl) {
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');
    
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    
    // Get basic repo info
    const repoData = await fetchGitHubAPI(`https://api.github.com/repos/${owner}/${cleanRepo}`);
    
    // Get contributors
    const contributors = await fetchGitHubAPI(`https://api.github.com/repos/${owner}/${cleanRepo}/contributors?per_page=10`);
    
    // Get recent commits
    const commits = await fetchGitHubAPI(`https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=5`);
    
    // Get languages
    const languages = await fetchGitHubAPI(`https://api.github.com/repos/${owner}/${cleanRepo}/languages`);
    
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
      },
      contributors: contributors.slice(0, 10).map(c => ({
        login: c.login,
        contributions: c.contributions,
        avatar: c.avatar_url,
        profile: c.html_url
      })),
      recentCommits: commits.slice(0, 5).map(c => ({
        message: c.commit.message,
        author: c.commit.author.name,
        date: c.commit.author.date,
        sha: c.sha.substring(0, 7)
      })),
      languages: Object.entries(languages).map(([lang, bytes]) => ({
        name: lang,
        bytes: bytes,
        percentage: Math.round((bytes / Object.values(languages).reduce((a, b) => a + b, 0)) * 100)
      })).sort((a, b) => b.bytes - a.bytes),
      analysis: {
        totalContributors: contributors.length,
        topContributor: contributors[0]?.login || 'Unknown',
        primaryLanguage: Object.keys(languages)[0] || 'Unknown',
        lastCommitDate: commits[0]?.commit?.author?.date || 'Unknown'
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testCompleteAnalysis() {
  console.log('🔍 Complete Continue Repository Analysis');
  console.log('Repository:', REPO_URL);
  console.log('=' .repeat(80));
  
  const result = await getCompleteAnalysis(REPO_URL);
  
  if (!result.success) {
    console.log('❌ Failed:', result.error);
    return;
  }
  
  const { repository, contributors, recentCommits, languages, analysis } = result;
  
  console.log('\n📊 Repository Information:');
  console.log(`✅ Name: ${repository.name}`);
  console.log(`✅ Description: ${repository.description}`);
  console.log(`✅ Language: ${repository.language}`);
  console.log(`✅ Stars: ${repository.stars.toLocaleString()}`);
  console.log(`✅ Forks: ${repository.forks.toLocaleString()}`);
  console.log(`✅ Open Issues: ${repository.openIssues}`);
  console.log(`✅ Size: ${(repository.size / 1024).toFixed(1)} MB`);
  console.log(`✅ License: ${repository.license}`);
  console.log(`✅ Owner: ${repository.owner.login} (${repository.owner.type})`);
  console.log(`✅ Created: ${new Date(repository.createdAt).toLocaleDateString()}`);
  console.log(`✅ Last Updated: ${new Date(repository.updatedAt).toLocaleDateString()}`);
  console.log(`✅ Topics: ${repository.topics.join(', ')}`);
  
  console.log('\n👥 Top Contributors:');
  contributors.forEach((contributor, i) => {
    console.log(`${i + 1}. ${contributor.login} - ${contributor.contributions} contributions`);
  });
  
  console.log('\n📝 Recent Commits:');
  recentCommits.forEach((commit, i) => {
    const date = new Date(commit.date).toLocaleDateString();
    console.log(`${i + 1}. [${commit.sha}] ${commit.message.split('\n')[0]} - ${commit.author} (${date})`);
  });
  
  console.log('\n💻 Languages:');
  languages.forEach((lang, i) => {
    console.log(`${i + 1}. ${lang.name}: ${lang.percentage}% (${(lang.bytes / 1024).toFixed(1)} KB)`);
  });
  
  console.log('\n📈 Analysis Summary:');
  console.log(`✅ Total Contributors: ${analysis.totalContributors}`);
  console.log(`✅ Top Contributor: ${analysis.topContributor}`);
  console.log(`✅ Primary Language: ${analysis.primaryLanguage}`);
  console.log(`✅ Last Commit: ${new Date(analysis.lastCommitDate).toLocaleDateString()}`);
  
  console.log('\n' + '=' .repeat(80));
  console.log('🎉 Complete repository analysis finished!');
}

testCompleteAnalysis().catch(console.error);