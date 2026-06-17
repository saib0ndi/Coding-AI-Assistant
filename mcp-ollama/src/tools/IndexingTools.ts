/**
 * Indexing tools: index_codebase, search_codebase, index_status, clear_caches, hallucination_metrics
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling } from './toolHelper.js';
import { CodebaseIndexerRegistry } from '../indexing/CodebaseIndexerRegistry.js';

export function createIndexingTools(deps: ToolDependencies): MCPTool[] {
  return [
    createIndexCodebaseTool(deps),
    createSearchCodebaseTool(deps),
    createIndexStatusTool(deps),
    createClearCachesTool(deps),
    createHallucinationMetricsTool(deps),
  ];
}

// ---------------------------------------------------------------------------
// index_codebase
// ---------------------------------------------------------------------------
function createIndexCodebaseTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'index_codebase',
    'Index workspace source files with Ollama embeddings for semantic search',
    {
      workspacePath: { type: 'string', description: 'Project root' },
      force: { type: 'boolean', description: 'Rebuild entire index', default: false },
      filePath: { type: 'string', description: 'Optional path of a specific file to index' },
    },
    [],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { workspacePath, force, filePath } = (params || {}) as {
            workspacePath?: string;
            force?: boolean;
            filePath?: string;
          };
          const indexer = CodebaseIndexerRegistry.get(workspacePath || process.cwd());

          if (filePath) {
            const fs = await import('fs/promises');
            const pathMod = await import('path');
            const { CodeChunker } = await import('../indexing/CodeChunker.js');
            const absolutePath = pathMod.isAbsolute(filePath)
              ? filePath
              : pathMod.join(workspacePath || process.cwd(), filePath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            const language = CodeChunker.languageFromPath(absolutePath);
            const status = await indexer.indexFiles([{ path: absolutePath, content, language }]);
            return { success: true, ...status };
          } else {
            const status = await indexer.indexWorkspace({ force: force === true });
            return { success: true, ...status };
          }
        },
        () => ({
          success: false,
          error: 'index_codebase failed',
          workspacePath: process.cwd(),
          chunkCount: 0,
          fileCount: 0,
          embedModel: '',
          indexPath: '',
          lastUpdated: null,
          embeddingBackend: 'fallback' as const,
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// search_codebase
// ---------------------------------------------------------------------------
function createSearchCodebaseTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'search_codebase',
    'Semantic search over indexed workspace code',
    {
      query: { type: 'string', description: 'Natural language or symbol query' },
      workspacePath: { type: 'string', description: 'Project root' },
      limit: { type: 'number', description: 'Max results', default: 8 },
    },
    ['query'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { query, workspacePath, limit } = (params || {}) as {
            query?: string;
            workspacePath?: string;
            limit?: number;
          };
          if (!query) throw new Error('Missing required parameter: query');

          const indexer = CodebaseIndexerRegistry.get(workspacePath || process.cwd());
          await indexer.load();
          if (indexer.getStatus().chunkCount === 0) {
            await indexer.indexWorkspace();
          }

          const matches = await indexer.search(query, limit ?? 8);
          return {
            query,
            count: matches.length,
            matches,
          };
        },
        () => ({ query: '', count: 0, matches: [], error: 'search_codebase failed' }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// index_status
// ---------------------------------------------------------------------------
function createIndexStatusTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'index_status',
    'Get codebase index statistics',
    {
      workspacePath: { type: 'string', description: 'Project root' },
    },
    [],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { workspacePath } = (params || {}) as { workspacePath?: string };
          const indexer = CodebaseIndexerRegistry.get(workspacePath || process.cwd());
          await indexer.load();
          return indexer.getStatus();
        },
        () => ({
          workspacePath: process.cwd(),
          chunkCount: 0,
          fileCount: 0,
          embedModel: '',
          indexPath: '',
          lastUpdated: null,
          embeddingBackend: 'fallback' as const,
          error: 'index_status failed',
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// clear_caches
// ---------------------------------------------------------------------------
function createClearCachesTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'clear_caches',
    'Clear all in-memory caches, conversation memory, semantic indexes, and on-disk .coding-ai indexes',
    {
      workspacePath: {
        type: 'string',
        description: 'Optional workspace root whose .coding-ai folder should be removed',
      },
    },
    [],
    async (params: { workspacePath?: string }) => {
      const cleared: string[] = [];

      deps.cacheManager.clear();
      cleared.push('cacheManager');

      await deps.persistentCache.clear();
      cleared.push('persistentCache');

      const { HallucinationMetrics } = await import('../quality/HallucinationMetrics.js');
      HallucinationMetrics.getInstance().reset();
      cleared.push('hallucinationMetrics');

      const conversationsAny = deps.conversations as any;
      if (typeof conversationsAny.clear === 'function') {
        conversationsAny.clear();
        cleared.push('conversations');
      }

      const memoryChunks = deps.conversationMemory.clearMemoryStore();
      cleared.push(`conversationMemory(${memoryChunks} chunks)`);

      deps.enhancedContext.resetState();
      cleared.push('enhancedContext');

      deps.repoAnalyzer.clearAnalysisCache();
      cleared.push('githubAnalysisCache');

      CodebaseIndexerRegistry.clear();
      cleared.push('codebaseIndexerRegistry');

      await deps.lspClient.clearCache();
      cleared.push('lspClient');

      const diskPathsRemoved = await removeDiskIndexCaches(deps, params?.workspacePath);
      if (diskPathsRemoved.length > 0) {
        cleared.push('diskIndexes');
      }

      deps.logger.info(`All caches cleared: ${cleared.join(', ')}`);
      return { success: true, cleared, diskPathsRemoved };
    }
  );
}

// ---------------------------------------------------------------------------
// hallucination_metrics
// ---------------------------------------------------------------------------
function createHallucinationMetricsTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'hallucination_metrics',
    'Get or reset aggregated hallucination rates from agent runs',
    {
      action: {
        type: 'string',
        enum: ['get', 'reset'],
        description: 'get = summary since server start; reset = clear samples',
      },
    },
    ['action'],
    async (params: { action?: string }) => {
      const { HallucinationMetrics } = await import('../quality/HallucinationMetrics.js');
      const store = HallucinationMetrics.getInstance();
      if (params.action === 'reset') {
        store.reset();
        return { success: true, message: 'Hallucination metrics cleared' };
      }
      return store.getSummary();
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function removeDiskIndexCaches(deps: ToolDependencies, workspacePath?: string): Promise<string[]> {
  const fs = await import('fs/promises');
  const pathMod = await import('path');
  const removed: string[] = [];
  const roots = new Set<string>([
    pathMod.resolve(workspacePath || process.cwd()),
    pathMod.resolve(process.cwd()),
  ]);

  for (const root of roots) {
    const indexDir = pathMod.join(root, '.coding-ai');
    try {
      await fs.rm(indexDir, { recursive: true, force: true });
      removed.push(indexDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        deps.logger.warn(`Failed to remove ${indexDir}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  return removed;
}
