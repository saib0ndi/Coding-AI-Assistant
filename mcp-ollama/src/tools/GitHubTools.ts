/**
 * GitHub tools: github_pr_suggestion, github_commit_message, github_repo_info, github_file_content,
 * github_directory_listing, github_search_code, github_complete_analysis, github_smart_query, github_analyze_repository
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool } from './toolHelper.js';

export function createGitHubIntegrationTools(deps: ToolDependencies): MCPTool[] {
  return [
    createTool('github_pr_suggestion', 'Generate pull request suggestions', {
      diff: { type: 'string' }, branch: { type: 'string' }
    }, ['diff', 'branch'], async (params: any) => {
      console.log('[MCPServer] Generating PR suggestion via Ollama');
      const prompt = `Generate a pull request title and description for this diff on branch ${params.branch}:\n\n${params.diff}`;
      const response = await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
      return {
        title: response.split('\n')[0] || 'Update code',
        description: response,
        timestamp: new Date().toISOString()
      };
    }),
    createTool('github_commit_message', 'Generate commit messages', {
      diff: { type: 'string' }
    }, ['diff'], async (params: any) => {
      console.log('[MCPServer] Generating commit message via Ollama');
      const prompt = `Generate a concise commit message for this diff:\n\n${params.diff}`;
      const response = await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
      return {
        message: response || 'chore: update code',
        timestamp: new Date().toISOString()
      };
    }),
    createTool('github_repo_info', 'Get GitHub repository information', {
      repoUrl: { type: 'string', description: 'GitHub repository URL' }
    }, ['repoUrl'], async (params: any) => {
      console.log('[MCPServer] Fetching GitHub repo info:', params.repoUrl);
      return await deps.gitHubService.getRepositoryInfo(params.repoUrl);
    }),
    createTool('github_file_content', 'Get specific file content from repository', {
      repoUrl: { type: 'string' }, filePath: { type: 'string' }, branch: { type: 'string' }
    }, ['repoUrl', 'filePath'], async (params: any) => {
      return await deps.gitHubService.getFileContent(params.repoUrl, params.filePath, params.branch);
    }),
    createTool('github_directory_listing', 'Get directory contents from repository', {
      repoUrl: { type: 'string' }, dirPath: { type: 'string' }, branch: { type: 'string' }
    }, ['repoUrl'], async (params: any) => {
      return await deps.gitHubService.getDirectoryContents(params.repoUrl, params.dirPath, params.branch);
    }),
    createTool('github_search_code', 'Search for code in repository', {
      repoUrl: { type: 'string' }, query: { type: 'string' }, language: { type: 'string' }
    }, ['repoUrl', 'query'], async (params: any) => {
      return await deps.gitHubService.searchCode(params.repoUrl, params.query, params.language);
    }),
    createTool('github_complete_analysis', 'Get complete repository analysis including contributors', {
      repoUrl: { type: 'string' }
    }, ['repoUrl'], async (params: any) => {
      console.log('[MCPServer] Getting complete GitHub analysis for:', params.repoUrl);
      return await deps.gitHubService.getCompleteAnalysis(params.repoUrl);
    }),
    createTool('github_smart_query', 'Intelligent GitHub query that understands user requests for specific files or content', {
      repoUrl: { type: 'string' },
      query: { type: 'string', description: 'User query like "get index.ts file" or "show me the main component"' },
      context: { type: 'string', description: 'Additional context about what the user is looking for' }
    }, ['repoUrl', 'query'], async (params: any) => {
      console.log('[MCPServer] Processing smart GitHub query via GitHubService');
      return await handleGitHubSmartQuery(deps, params.repoUrl, params.query, params.context);
    }),
    createTool('github_analyze_repository', 'Complete repository analysis with contextual question understanding', {
      repoUrl: { type: 'string', description: 'GitHub repository URL' },
      question: { type: 'string', description: 'User question about the repository (optional)' }
    }, ['repoUrl'], async (params: any) => {
      console.log('[MCPServer] Analyzing repository with context:', params.repoUrl);
      return await deps.repoAnalyzer.analyzeRepositoryWithContext(params.repoUrl, params.question);
    })
  ];
}

async function handleGitHubSmartQuery(deps: ToolDependencies, repoUrl: string, query: string, context?: string): Promise<any> {
  try {
    return await deps.gitHubService.handleSmartQuery(repoUrl, query, context);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Smart query failed',
      repoUrl,
      query
    };
  }
}
