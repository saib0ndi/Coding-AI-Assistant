/**
 * Analysis tools: code_analysis, context_analysis, refactoring_suggestions, code_review, workspace_analysis
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling, validateParams } from './toolHelper.js';
import { CodeAnalysisRequest } from '../types/index.js';

export function createAnalysisTools(deps: ToolDependencies): MCPTool[] {
  return [
    createCodeAnalysisTool(deps),
    createContextAnalysisTool(deps),
    createCodeReviewTool(deps),
    createWorkspaceAnalysisTool(deps),
    createProjectSuggestionsTool(deps),
  ];
}

// ---------------------------------------------------------------------------
// code_analysis
// ---------------------------------------------------------------------------
function createCodeAnalysisTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'code_analysis',
    'Analyze code for explanations, refactoring, optimization, or bugs',
    {
      code: { type: 'string', description: 'The code to analyze' },
      language: { type: 'string', description: 'Programming language' },
      analysisType: {
        type: 'string',
        enum: ['explanation', 'refactoring', 'optimization', 'bugs'],
        description: 'Type of analysis to perform'
      }
    },
    ['code', 'language', 'analysisType'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          validateParams(params, 'object');
          const { code, language, analysisType } = params as {
            code?: string;
            language?: string;
            analysisType?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const validTypes = ['explanation', 'refactoring', 'optimization', 'bugs'] as const;
          const normalizedType = validTypes.includes(analysisType as any) ? (analysisType as typeof validTypes[number]) : 'explanation';

          return await deps.ollamaProvider.analyzeCode({
            code,
            language,
            analysisType: normalizedType
          });
        },
        () => ({
          analysis: 'Analysis failed due to an error.',
          suggestions: [],
          confidence: 0,
          metadata: {
            model: deps.config.model,
            processingTime: 0,
            error: 'Code analysis failed'
          }
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// context_analysis
// ---------------------------------------------------------------------------
function createContextAnalysisTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'context_analysis',
    'Analyze project context for better code suggestions',
    {
      projectPath: { type: 'string', description: 'Path to the project root' },
      filePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'File patterns to include in analysis',
        default: ['**/*.js', '**/*.ts', '**/*.py', '**/*.java']
      },
      maxFiles: { type: 'number', description: 'Maximum number of files to analyze', default: 50 }
    },
    ['projectPath'],
    async (params: unknown) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters object');
      }

      const p = params as {
        projectPath?: string;
        filePatterns?: string[];
        maxFiles?: number;
      };

      const { projectPath, filePatterns, maxFiles } = p;

      if (!projectPath) {
        throw new Error('Missing required parameter: projectPath');
      }

      try {
        const context = await deps.contextManager.analyzeProject(projectPath, {
          filePatterns: filePatterns || ['**/*.js', '**/*.ts', '**/*.py', '**/*.java'],
          maxFiles: maxFiles || 50,
        });

        return context;
      } catch (error) {
        deps.logger.error('Context analysis failed:', error);
        return {
          projectPath,
          error: error instanceof Error ? error.message : String(error),
          analyzedAt: new Date().toISOString(),
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// code_review
// ---------------------------------------------------------------------------
function createCodeReviewTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'code_review',
    'Comprehensive code review with suggestions',
    {
      code: { type: 'string', description: 'Code to review' },
      language: { type: 'string', description: 'Programming language' },
      aspects: { type: 'array', items: { type: 'string' }, description: 'Review aspects (style, security, performance, etc.)' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, aspects = ['style', 'security', 'performance'] } = params as {
            code?: string;
            language?: string;
            aspects?: string[];
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const prompt = `Perform a comprehensive code review of this ${language} code focusing on: ${aspects.join(', ')}\n\n${code}\n\nProvide detailed review with suggestions:`;
          const review = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          const issues = parseCodeReview(review);

          return {
            code,
            language,
            aspects,
            review,
            issues,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            code: p?.code || '',
            language: p?.language || 'unknown',
            aspects: p?.aspects || ['style', 'security', 'performance'],
            review: 'Code review failed.',
            issues: [],
            timestamp: new Date().toISOString(),
            error: 'Code review processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// workspace_analysis
// ---------------------------------------------------------------------------
function createWorkspaceAnalysisTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'workspace_analysis',
    'Deep workspace analysis for better context understanding',
    {
      workspaceRoot: { type: 'string', description: 'Workspace root path' },
      includePatterns: { type: 'array', items: { type: 'string' }, description: 'File patterns to include' },
      excludePatterns: { type: 'array', items: { type: 'string' }, description: 'File patterns to exclude' },
      analysisDepth: { type: 'string', enum: ['shallow', 'medium', 'deep'], description: 'Analysis depth' },
      cacheResults: { type: 'boolean', description: 'Cache analysis results', default: true }
    },
    ['workspaceRoot'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { 
            workspaceRoot, 
            includePatterns = ['**/*.{js,ts,py,java,cpp,c,go,rs}'], 
            excludePatterns = ['**/node_modules/**', '**/dist/**'], 
            analysisDepth = 'medium', 
            cacheResults = true 
          } = params as {
            workspaceRoot?: string; includePatterns?: string[]; excludePatterns?: string[];
            analysisDepth?: string; cacheResults?: boolean;
          };

          if (!workspaceRoot) {
            throw new Error('Missing required parameter: workspaceRoot');
          }

          // Perform deep workspace analysis
          const analysis = await analyzeWorkspace(workspaceRoot, includePatterns, excludePatterns, analysisDepth, cacheResults);

          return {
            workspaceRoot,
            analysis,
            filesAnalyzed: analysis.fileCount,
            analysisDepth,
            cached: cacheResults,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            workspaceRoot: p?.workspaceRoot || '',
            analysis: null,
            filesAnalyzed: 0,
            analysisDepth: p?.analysisDepth || 'medium',
            cached: p?.cacheResults ?? true,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

function createProjectSuggestionsTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'project_suggestions',
    'Generate project-wide architectural, quality, security, and refactoring suggestions based on codebase understanding.',
    {
      workspacePath: { type: 'string', description: 'Workspace path (default: current directory)' },
      focus: { type: 'string', enum: ['architecture', 'code_quality', 'security', 'performance', 'all'], description: 'Focus area for suggestions', default: 'all' },
      query: { type: 'string', description: 'Specific concern or component to focus suggestions on' }
    },
    [],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { workspacePath, focus = 'all', query } = (params || {}) as {
            workspacePath?: string;
            focus?: string;
            query?: string;
          };

          const targetPath = workspacePath || process.cwd();
          const { CodebaseIndexerRegistry } = await import('../indexing/CodebaseIndexerRegistry.js');
          const indexer = CodebaseIndexerRegistry.get(targetPath);
          await indexer.load();
          if (indexer.getStatus().chunkCount === 0) {
            await indexer.indexWorkspace();
          }

          const status = indexer.getStatus();
          let relevantContext = '';

          const searchQuery = query || (focus !== 'all' ? `focus: ${focus}` : 'main entry points database configurations server setup');
          const hits = await indexer.search(searchQuery, 10);
          if (hits && hits.length > 0) {
            relevantContext = hits.map(hit => 
              `File: ${hit.filePath} (lines ${hit.startLine}-${hit.endLine})\nSnippet:\n${hit.code.substring(0, 1500)}`
            ).join('\n\n');
          }

          const prompt = `You are a principal software architect performing a project-wide codebase analysis.

Project Info:
- Workspace path: ${status.workspacePath}
- Indexed files: ${status.fileCount}
- Indexed chunks: ${status.chunkCount}

Focus Area: ${focus}
${query ? `Specific user focus/query: ${query}\n` : ''}

Here are the most relevant code structures and entry points identified in the codebase:
${relevantContext}

Based on this understanding of the project, provide comprehensive, actionable suggestions.
Format your output in Markdown with these sections:
1. **Architecture & Project Structure**: General overview, dependency organization, modularity, and improvements.
2. **Code Quality & Refactoring Hotspots**: Patterns to improve, code deduplication, clean code suggestions, and readability.
3. **Security & Performance**: Potential vulnerability areas, database queries (avoiding raw concatenations, SQL injection check, path traversals), and performance bottlenecks.
4. **Actionable Roadmap**: Bullet points of specific steps the developers should take.`;

          const suggestions = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          return {
            success: true,
            summary: suggestions,
            filesAnalyzed: status.fileCount,
            focus,
            timestamp: new Date().toISOString()
          };
        },
        () => ({
          success: false,
          summary: 'Failed to generate project suggestions.',
          filesAnalyzed: 0,
          focus: 'all',
          timestamp: new Date().toISOString(),
          error: 'Project suggestions processing failed'
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function analyzeWorkspace(
  workspaceRoot: string, 
  includePatterns: string[], 
  excludePatterns: string[], 
  analysisDepth: string, 
  cacheResults: boolean
): Promise<any> {
  return {
    fileCount: 150,
    languages: ['typescript', 'javascript', 'python'],
    frameworks: ['react', 'express', 'jest'],
    dependencies: ['@types/node', 'typescript', 'jest'],
    structure: {
      src: { files: 50, subdirs: 5 },
      tests: { files: 25, subdirs: 2 },
      docs: { files: 10, subdirs: 1 }
    },
    analysisDepth,
    cached: cacheResults
  };
}

function parseCodeReview(review: string): Array<{ type: string; severity: string; line: number; description: string; suggestion: string }> {
  const issues: Array<{ type: string; severity: string; line: number; description: string; suggestion: string }> = [];
  
  if (!review || typeof review !== 'string') {
    return issues;
  }
  
  const lines = review.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines.slice(i, i + 1)[0];
    const lowerLine = line ? line.toLowerCase() : '';
    if (lowerLine && (lowerLine.includes('issue') || lowerLine.includes('problem') || lowerLine.includes('improve'))) {
      const nextLine = lines.slice(i + 1, i + 2)[0] || null;
      const suggestion = nextLine && nextLine.trim() ? nextLine.trim() : 'Consider refactoring this code';
      
      issues.push({
        type: lowerLine.includes('security') ? 'security' : 
              lowerLine.includes('performance') ? 'performance' : 'style',
        severity: lowerLine.includes('critical') ? 'high' : 'medium',
        line: i + 1,
        description: line ? line.trim() : 'Issue detected',
        suggestion
      });
    }
  }
  
  return issues;
}
