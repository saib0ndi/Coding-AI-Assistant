/**
 * GitHub API Service
 * Handles all GitHub repository operations and API interactions
 */
export class GitHubService {
  private static instance: GitHubService;
  
  private fetchReady: Promise<void>;
  
  private constructor() {
    this.fetchReady = this.initializeFetch();
  }
  
  public static getInstance(): GitHubService {
    if (!GitHubService.instance) {
      GitHubService.instance = new GitHubService();
    }
    return GitHubService.instance;
  }
  
  private async initializeFetch(): Promise<void> {
    if (typeof fetch === 'undefined') {
      try {
        const { default: fetch } = await import('node-fetch');
        (global as any).fetch = fetch;
      } catch {
        console.warn('Could not import node-fetch, assuming fetch is available');
      }
    }
  }
  
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MCP-Ollama-Server'
    };
    
    try {
      if (typeof process !== 'undefined' && process.env?.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
    } catch {
      // Ignore in browser environments
    }
    
    return headers;
  }

  private async fetchGitHub(apiUrl: string): Promise<Response> {
    const headers = this.getHeaders();
    const response = await fetch(apiUrl, { headers });

    if (response.status === 401 && headers.Authorization) {
      const { Authorization, ...publicHeaders } = headers;
      console.warn('[GitHubService] Authenticated GitHub request returned 401; retrying as public request');
      return await fetch(apiUrl, { headers: publicHeaders });
    }

    return response;
  }
  
  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error('Invalid GitHub URL format');
    }
    
    const [, owner, repo] = match;
    return { owner, repo: repo.replace(/\.git$/, '') };
  }
  
  /**
   * Get basic repository information
   */
  async getRepositoryInfo(repoUrl: string): Promise<any> {
    try {
      await this.fetchReady;
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
      
      const response = await this.fetchGitHub(apiUrl);
      
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }
      
      const repoData = await response.json() as any;
      
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
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Decode base64 content (browser-compatible)
   */
  private decodeBase64(content: string): string {
    try {
      if (typeof atob !== 'undefined') {
        return atob(content);
      } else if (typeof Buffer !== 'undefined') {
        return Buffer.from(content, 'base64').toString('utf-8');
      } else {
        throw new Error('No base64 decoder available');
      }
    } catch {
      return content;
    }
  }
  
  /**
   * Get file content from repository with intelligent branch detection
   */
  async getFileContent(repoUrl: string, filePath: string, branch?: string): Promise<any> {
    try {
      await this.fetchReady;
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      
      // Try to get file with branch detection
      const result = await this.getFileWithBranchFallback(owner, repo, filePath, branch);
      return result;
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get directory contents with intelligent branch detection
   */
  async getDirectoryContents(repoUrl: string, dirPath = '', branch?: string): Promise<any> {
    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      
      // Try to get directory with branch detection
      const result = await this.getDirectoryWithBranchFallback(owner, repo, dirPath, branch);
      return result;
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Search code in repository
   */
  async searchCode(repoUrl: string, query: string, language?: string): Promise<any> {
    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      let searchQuery = `${query} repo:${owner}/${repo}`;
      if (language) searchQuery += ` language:${language}`;
      
      const apiUrl = `https://api.github.com/search/code?q=${encodeURIComponent(searchQuery)}`;
      
      const response = await this.fetchGitHub(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json() as any;
      
      return {
        success: true,
        results: data.items?.slice(0, 10).map((item: any) => ({
          name: item.name,
          path: item.path,
          score: item.score,
          url: item.html_url
        })) || []
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get repository contributors
   */
  async getContributors(repoUrl: string, limit = 10): Promise<any> {
    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=${limit}`;
      
      const response = await this.fetchGitHub(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const contributors = await response.json() as any;
      
      return {
        success: true,
        contributors: contributors.map((c: any) => ({
          login: c.login,
          contributions: c.contributions,
          avatar: c.avatar_url,
          profile: c.html_url
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get recent commits
   */
  async getRecentCommits(repoUrl: string, limit = 5): Promise<any> {
    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`;
      
      const response = await this.fetchGitHub(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const commits = await response.json() as any;
      
      return {
        success: true,
        commits: commits.map((c: any) => ({
          message: c.commit.message,
          author: c.commit.author.name,
          date: c.commit.author.date,
          sha: c.sha.substring(0, 7)
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get repository languages
   */
  async getLanguages(repoUrl: string): Promise<any> {
    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/languages`;
      
      const response = await this.fetchGitHub(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const languages = await response.json() as any;
      const totalBytes = Object.values(languages).reduce((a: number, b: unknown) => a + (b as number), 0);
      
      return {
        success: true,
        languages: Object.entries(languages).map(([lang, bytes]) => ({
          name: lang,
          bytes: bytes as number,
          percentage: Math.round(((bytes as number) / totalBytes) * 100)
        })).sort((a, b) => b.bytes - a.bytes)
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Smart query handler that understands user requests and fetches appropriate content
   */
  async handleSmartQuery(repoUrl: string, query: string, context?: string): Promise<any> {
    try {
      console.log(`[GitHubService] Smart query: ${query}`);
      
      const queryAnalysis = this.analyzeQuery(query);
      
      switch (queryAnalysis.type) {
        case 'file_content':
          return await this.getFileContent(repoUrl, queryAnalysis.filePath!, queryAnalysis.branch);
        
        case 'directory_listing':
          return await this.getDirectoryContents(repoUrl, queryAnalysis.dirPath, queryAnalysis.branch);
        
        case 'code_search':
          return await this.searchCode(repoUrl, queryAnalysis.searchTerm!, queryAnalysis.language);
        
        case 'file_search':
          return await this.findFileByName(repoUrl, queryAnalysis.fileName!);
        
        case 'readme_search':
          return await this.findReadmeFile(repoUrl);
        
        case 'smart_search':
          return await this.performIntelligentSearch(repoUrl, query, context);
        
        default:
          return await this.getCompleteAnalysis(repoUrl);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Smart query failed',
        query,
        suggestions: [
          'Try: "get src/index.ts file"',
          'Try: "show me the main component"',
          'Try: "find package.json"',
          'Try: "search for authentication code"'
        ]
      };
    }
  }

  private analyzeQuery(query: string): {
    type: 'file_content' | 'directory_listing' | 'code_search' | 'file_search' | 'readme_search' | 'smart_search';
    filePath?: string;
    dirPath?: string;
    fileName?: string;
    searchTerm?: string;
    language?: string;
    branch?: string;
  } {
    const lowerQuery = query.toLowerCase();
    
    // Extract branch if specified (supports more branch name patterns)
    const branchMatch = lowerQuery.match(/(?:branch|on|from)\s+([\w\-\/\.]+)/);
    const branch = branchMatch ? branchMatch[1] : undefined; // Let methods determine optimal branch
    
    // Check for README file requests
    if (lowerQuery.includes('readme') || lowerQuery.includes('read me')) {
      return branch ? { type: 'readme_search', branch } : { type: 'readme_search' };
    }
    
    // Check for specific file path patterns
    const filePathPatterns = [
      /(?:get|show|fetch)\s+([\w\-\/\.]+\.[a-z]+)/i,
      /file\s+([\w\-\/\.]+\.[a-z]+)/i,
      /([\w\-\/\.]+\.[a-z]+)\s+file/i
    ];
    
    for (const pattern of filePathPatterns) {
      const match = query.match(pattern);
      if (match) {
        return branch ? { type: 'file_content', filePath: match[1], branch } : { type: 'file_content', filePath: match[1] };
      }
    }
    
    // Check for directory listing
    if (lowerQuery.includes('directory') || lowerQuery.includes('folder') || lowerQuery.includes('list files')) {
      const dirMatch = query.match(/(?:in|from)\s+([\w\-\/]+)/i);
      const result: any = { type: 'directory_listing', dirPath: dirMatch ? dirMatch[1] : '' };
      if (branch) result.branch = branch;
      return result;
    }
    
    // Check for file name search
    const fileNamePatterns = [
      /find\s+([\w\-\.]+\.[a-z]+)/i,
      /search\s+for\s+([\w\-\.]+\.[a-z]+)/i,
      /locate\s+([\w\-\.]+\.[a-z]+)/i
    ];
    
    for (const pattern of fileNamePatterns) {
      const match = query.match(pattern);
      if (match) {
        return branch ? { type: 'file_search', fileName: match[1], branch } : { type: 'file_search', fileName: match[1] };
      }
    }
    
    // Check for code search
    const codeSearchPatterns = [
      /search\s+for\s+([^\n]+)/i,
      /find\s+code\s+([^\n]+)/i,
      /look\s+for\s+([^\n]+)/i
    ];
    
    for (const pattern of codeSearchPatterns) {
      const match = query.match(pattern);
      if (match) {
        const searchTerm = match[1].replace(/\s+(in|with|using)\s+\w+/i, '');
        const langMatch = query.match(/(?:in|with|using)\s+(\w+)/i);
        const result: any = { type: 'code_search', searchTerm, branch };
        if (langMatch) {
          result.language = langMatch[1];
        }
        return result;
      }
    }
    
    return branch ? { type: 'smart_search', searchTerm: query, branch } : { type: 'smart_search', searchTerm: query };
  }

  private async findFileByName(repoUrl: string, fileName: string): Promise<any> {
    const searchResult = await this.searchCode(repoUrl, `filename:${fileName}`);
    if (searchResult.success && searchResult.results.length > 0) {
      const firstMatch = searchResult.results[0];
      return await this.getFileContent(repoUrl, firstMatch.path);
    }
    return searchResult;
  }
  
  /**
   * Get all branches for a repository
   */
  private async getAllBranches(owner: string, repo: string): Promise<string[]> {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/branches`;
      const response = await this.fetchGitHub(apiUrl);
      
      if (!response.ok) {
        return ['main', 'master', 'develop', 'dev']; // Common fallbacks
      }
      
      const branches = await response.json() as any[];
      return branches.map(b => b.name);
    } catch {
      return ['main', 'master', 'develop', 'dev']; // Common fallbacks
    }
  }
  
  /**
   * Get file content with intelligent branch fallback
   */
  private async getFileWithBranchFallback(owner: string, repo: string, filePath: string, preferredBranch?: string): Promise<any> {
    // Get all available branches
    const branches = await this.getAllBranches(owner, repo);
    
    // Create priority list of branches to try
    const branchesToTry = [];
    
    if (preferredBranch) {
      branchesToTry.push(preferredBranch);
    }
    
    // Add repository's default branch first (direct API call to avoid recursion)
    try {
      const repoApiUrl = `https://api.github.com/repos/${owner}/${repo}`;
      const repoResponse = await this.fetchGitHub(repoApiUrl);
      if (repoResponse.ok) {
        const repoData = await repoResponse.json() as any;
        if (repoData.default_branch) {
          branchesToTry.push(repoData.default_branch);
        }
      }
    } catch {}
    
    // Add common branch names
    const commonBranches = ['main', 'master', 'develop', 'dev', 'preview', 'staging'];
    branchesToTry.push(...commonBranches);
    
    // Add all other branches from the repository
    branchesToTry.push(...branches);
    
    // Remove duplicates while preserving order
    const uniqueBranches = [...new Set(branchesToTry)];
    
    // Try each branch until we find the file
    for (const branch of uniqueBranches) {
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const response = await this.fetchGitHub(apiUrl);
        
        if (response.ok) {
          const data = await response.json() as any;
          return {
            success: true,
            file: {
              name: data.name,
              path: data.path,
              content: this.decodeBase64(data.content),
              size: data.size,
              sha: data.sha,
              branch: branch // Include which branch was used
            }
          };
        }
      } catch {
        continue; // Try next branch
      }
    }
    
    return {
      success: false,
      error: `File '${filePath}' not found in any branch`,
      triedBranches: uniqueBranches.slice(0, 5) // Show first 5 attempted branches
    };
  }
  
  /**
   * Get directory contents with intelligent branch fallback
   */
  private async getDirectoryWithBranchFallback(owner: string, repo: string, dirPath: string, preferredBranch?: string): Promise<any> {
    // Get all available branches
    const branches = await this.getAllBranches(owner, repo);
    
    // Create priority list of branches to try
    const branchesToTry = [];
    
    if (preferredBranch) {
      branchesToTry.push(preferredBranch);
    }
    
    // Add repository's default branch first (direct API call to avoid recursion)
    try {
      const repoApiUrl = `https://api.github.com/repos/${owner}/${repo}`;
      const repoResponse = await this.fetchGitHub(repoApiUrl);
      if (repoResponse.ok) {
        const repoData = await repoResponse.json() as any;
        if (repoData.default_branch) {
          branchesToTry.push(repoData.default_branch);
        }
      }
    } catch {}
    
    // Add common branch names
    const commonBranches = ['main', 'master', 'develop', 'dev', 'preview', 'staging'];
    branchesToTry.push(...commonBranches);
    
    // Add all other branches from the repository
    branchesToTry.push(...branches);
    
    // Remove duplicates while preserving order
    const uniqueBranches = [...new Set(branchesToTry)];
    
    // Try each branch until we find the directory
    for (const branch of uniqueBranches) {
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
        const response = await this.fetchGitHub(apiUrl);
        
        if (response.ok) {
          const data = await response.json() as any;
          return {
            success: true,
            contents: Array.isArray(data) ? data.map((item: any) => ({
              name: item.name,
              path: item.path,
              type: item.type,
              size: item.size
            })) : [],
            branch: branch // Include which branch was used
          };
        }
      } catch {
        continue; // Try next branch
      }
    }
    
    return {
      success: false,
      error: `Directory '${dirPath}' not found in any branch`,
      triedBranches: uniqueBranches.slice(0, 5) // Show first 5 attempted branches
    };
  }
  
  /**
   * Find README file with comprehensive search across branches and variations
   */
  private async findReadmeFile(repoUrl: string): Promise<any> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const readmeVariations = [
      'README.md', 'readme.md', 'README.MD', 'Readme.md',
      'README.rst', 'readme.rst', 'README.RST',
      'README.txt', 'readme.txt', 'README.TXT',
      'README', 'readme', 'Readme'
    ];
    
    // Try each README variation with branch fallback
    for (const readmeName of readmeVariations) {
      const result = await this.getFileWithBranchFallback(owner, repo, readmeName);
      if (result.success) {
        return result;
      }
    }
    
    return {
      success: false,
      error: 'README file not found in repository across all branches and variations'
    };
  }

  private async performIntelligentSearch(repoUrl: string, query: string, context?: string): Promise<any> {
    try {
      // Get repository structure for context
      const [repoInfo, rootContents] = await Promise.all([
        this.getRepositoryInfo(repoUrl),
        this.getDirectoryContents(repoUrl)
      ]);
      
      if (!repoInfo.success || !rootContents.success) {
        return { success: false, error: 'Could not analyze repository structure' };
      }
      
      // For now, return repository structure to help user make specific requests
      return {
        success: true,
        type: 'intelligent_search',
        query,
        repository: repoInfo.repository,
        rootFiles: rootContents.contents,
        message: 'Repository structure retrieved. Please specify exact file paths for best results.',
        examples: [
          `get ${rootContents.contents.find((c: any) => c.name.includes('index'))?.name || 'src/index.js'}`,
          `get ${rootContents.contents.find((c: any) => c.name === 'package.json')?.name || 'package.json'}`,
          `list files in ${rootContents.contents.find((c: any) => c.type === 'dir')?.name || 'src'} directory`
        ]
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Intelligent search failed'
      };
    }
  }

  /**
   * Get complete repository analysis
   */
  async getCompleteAnalysis(repoUrl: string): Promise<any> {
    try {
      // Get all data in parallel
      const [repoInfo, contributorsResult, commitsResult, languagesResult, readmeResult] = await Promise.all([
        this.getRepositoryInfo(repoUrl),
        this.getContributors(repoUrl, 10),
        this.getRecentCommits(repoUrl, 5),
        this.getLanguages(repoUrl),
        this.findReadmeFile(repoUrl)
      ]);
      
      if (!repoInfo.success) {
        return repoInfo;
      }
      
      return {
        success: true,
        repository: repoInfo.repository,
        contributors: contributorsResult.success ? contributorsResult.contributors : [],
        recentCommits: commitsResult.success ? commitsResult.commits : [],
        languages: languagesResult.success ? languagesResult.languages : [],
        readme: readmeResult.success ? {
          content: readmeResult.file.content.substring(0, 1000) + '...',
          branch: readmeResult.file.branch,
          fileName: readmeResult.file.name
        } : 'README not found across all branches',
        analysis: {
          totalContributors: contributorsResult.success ? contributorsResult.contributors.length : 0,
          topContributor: contributorsResult.success && contributorsResult.contributors.length > 0 
            ? contributorsResult.contributors[0].login : 'Unknown',
          primaryLanguage: languagesResult.success && languagesResult.languages.length > 0 
            ? languagesResult.languages[0].name : 'Unknown',
          lastCommitDate: commitsResult.success && commitsResult.commits.length > 0 
            ? commitsResult.commits[0].date : 'Unknown'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Pull-request review helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch the unified diff for a pull request.
   * Returns the raw patch text (may be several hundred lines).
   */
  async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    await this.fetchReady;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
    const res = await fetch(url, {
      headers: { ...this.getHeaders(), Accept: 'application/vnd.github.v3.diff' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    return await res.text();
  }

  /**
   * Post a review comment on a pull request.
   *
   * @param event  'COMMENT' (non-blocking) | 'REQUEST_CHANGES' | 'APPROVE'
   */
  async postPullRequestReview(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' = 'COMMENT'
  ): Promise<{ id: number; html_url: string }> {
    await this.fetchReady;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, event }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text}`);
    }
    return await res.json() as { id: number; html_url: string };
  }

  /**
   * Post a single inline review comment on a specific line of a PR diff.
   */
  async postPullRequestInlineComment(
    owner: string,
    repo: string,
    prNumber: number,
    commitId: string,
    path: string,
    line: number,
    body: string
  ): Promise<{ id: number }> {
    await this.fetchReady;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, commit_id: commitId, path, line, side: 'RIGHT' }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text}`);
    }
    return await res.json() as { id: number };
  }
}
