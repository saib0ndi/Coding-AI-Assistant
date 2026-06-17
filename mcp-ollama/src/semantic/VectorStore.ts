import { CodebaseIndexerRegistry } from '../indexing/CodebaseIndexerRegistry.js';
import { EmbeddingService } from '../indexing/EmbeddingService.js';
import type { CodeSearchHit } from '../indexing/types.js';

export interface CodeEmbedding {
  id: string;
  code: string;
  embedding: number[];
  metadata: {
    language: string;
    filePath: string;
    functionName?: string;
    className?: string;
  };
}

export interface SearchResult {
  code: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface IntentParseResult {
  intent: string;
  target: string;
  confidence: number;
}

export interface SearchWithIntentResult {
  results: SearchResult[];
  intent: IntentParseResult;
}

export type VectorStoreScope = 'workspace' | 'memory';

interface MemoryChunk {
  id: string;
  code: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * Facade for semantic search over a workspace index or an in-memory chunk store.
 * Workspace scope delegates to CodebaseIndexer; memory scope stores ephemeral chunks (e.g. conversations).
 */
export class VectorStore {
  private readonly scope: VectorStoreScope;
  private readonly embedder: EmbeddingService;
  private readonly memoryChunks = new Map<string, MemoryChunk>();
  /** Ordered most-specific first so broad patterns do not steal matches. */
  private intentRules: Array<{ intent: string; patterns: RegExp[]; confidence: number }> = [];

  constructor(options?: { scope?: VectorStoreScope }) {
    this.scope = options?.scope ?? 'workspace';
    this.embedder = CodebaseIndexerRegistry.getEmbedder();
    this.initializeNLPPatterns();
  }

  /** Clear in-memory conversation chunks (memory scope only). */
  clearMemoryStore(): number {
    const count = this.memoryChunks.size;
    this.memoryChunks.clear();
    return count;
  }

  private initializeNLPPatterns(): void {
    const pathTarget = '([\\w./-]+)';

    this.intentRules = [
      {
        intent: 'create_directory',
        confidence: 0.92,
        patterns: [
          new RegExp(`\\bmkdir\\s+(?:-p\\s+)?${pathTarget}`, 'i'),
          new RegExp(
            `\\b(?:create|make)\\s+(?:a\\s+)?(?:directory|folder|dir)\\s+(?:named|called)?\\s*${pathTarget}`,
            'i'
          ),
        ],
      },
      {
        intent: 'create_file',
        confidence: 0.9,
        patterns: [
          new RegExp(
            `\\b(?:create|make|add)\\s+(?:a\\s+)?(?:new\\s+)?file\\s+(?:named|called)?\\s*${pathTarget}`,
            'i'
          ),
        ],
      },
      {
        intent: 'generate_tests',
        confidence: 0.9,
        patterns: [
          /\b(?:generate|write|add|create)\s+(?:unit\s+)?tests?\s+(?:for\s+)?(.+)/i,
          /\btest\s+(?:coverage\s+for|file\s+for)\s+(.+)/i,
        ],
      },
      {
        intent: 'fix_code',
        confidence: 0.88,
        patterns: [
          /\b(?:fix|repair|resolve)\s+(?:the\s+)?(?:bug|error|issue|problem)\s+(?:in\s+)?(.+)/i,
          /\b(?:fix|repair)\s+(?:code\s+in\s+)?(.+)/i,
        ],
      },
      {
        intent: 'implement_feature',
        confidence: 0.75,
        patterns: [
          /\bimplement\s+(?:a\s+)?(?:new\s+)?(.+?)(?:\s+(?:feature|component|module|system))?\s*$/i,
          /\bcreate\s+(?:a\s+)?(.+?)\s+(?:feature|component|module|system)\b/i,
          /\bbuild\s+(?:a\s+)?(.+?)\s+(?:feature|component|module|system)\b/i,
        ],
      },
      {
        intent: 'refactor',
        confidence: 0.8,
        patterns: [/\brefactor\s+(.+)/i, /\brestructure\s+(.+)/i],
      },
    ];
  }

  private normalizeIntentTarget(raw: string): string {
    return raw.replace(/[.,;:!?]+$/, '').trim();
  }

  async embed(code: string, language = 'typescript'): Promise<number[]> {
    const text = language ? `${language}\n${code}` : code;
    return this.embedder.embed(text.slice(0, 8000));
  }

  async addCode(id: string, code: string, metadata: Record<string, unknown>): Promise<void> {
    const trimmed = code.trim().slice(0, 8000);
    if (!trimmed) return;

    const embedding = await this.embedder.embed(trimmed);

    if (this.scope === 'memory') {
      this.memoryChunks.set(id, {
        id,
        code: trimmed,
        embedding,
        metadata: { ...metadata, id },
      });
      return;
    }

    const workspacePath =
      typeof metadata.workspacePath === 'string' ? metadata.workspacePath : process.cwd();
    const filePath =
      typeof metadata.filePath === 'string' ? metadata.filePath : `__memory__/${id}.txt`;
    const language =
      typeof metadata.language === 'string' ? metadata.language : 'text';

    const indexer = CodebaseIndexerRegistry.get(workspacePath);
    await indexer.load();
    await indexer.indexFiles([
      {
        path: filePath,
        content: trimmed,
        language,
      },
    ]);
  }

  async search(
    query: string,
    limit = 5,
    workspacePath?: string,
    metadataFilter?: (metadata: Record<string, unknown>) => boolean
  ): Promise<SearchResult[]> {
    if (this.scope === 'memory') {
      return this.searchMemory(query, limit, metadataFilter);
    }

    const indexer = CodebaseIndexerRegistry.get(workspacePath);
    await indexer.load();
    if (indexer.getStatus().chunkCount === 0) {
      await indexer.indexWorkspace();
    }
    const hits = await indexer.search(query, limit);
    return hits.map((h) => this.hitToResult(h));
  }

  parseIntent(input: string): IntentParseResult {
    const text = input.trim();
    if (!text) {
      return { intent: 'unknown', target: 'unknown', confidence: 0 };
    }

    for (const rule of this.intentRules) {
      for (const pattern of rule.patterns) {
        const match = text.match(pattern);
        if (!match?.[1]) continue;

        const target = this.normalizeIntentTarget(match[1]);
        if (!target || target.length > 500) continue;

        return { intent: rule.intent, target, confidence: rule.confidence };
      }
    }

    return { intent: 'unknown', target: 'unknown', confidence: 0.2 };
  }

  async searchWithIntent(
    query: string,
    limit = 5,
    workspacePath?: string
  ): Promise<SearchWithIntentResult> {
    const intent = this.parseIntent(query);
    const results = await this.search(query, limit, workspacePath);
    return { results, intent };
  }

  async findSimilar(
    code: string,
    language: string,
    limit = 3,
    workspacePath?: string
  ): Promise<SearchResult[]> {
    if (this.scope === 'memory') {
      return this.searchMemory(`${language}\n${code}`, limit);
    }

    const indexer = CodebaseIndexerRegistry.get(workspacePath);
    await indexer.load();
    if (indexer.getStatus().chunkCount === 0) {
      await indexer.indexWorkspace();
    }
    const hits = await indexer.findSimilar(code, language, limit);
    return hits.map((h) => this.hitToResult(h));
  }

  async indexCodebase(
    files: Array<{ path: string; content: string; language: string }>,
    workspacePath?: string
  ): Promise<void> {
    const root = workspacePath || process.cwd();
    const indexer = CodebaseIndexerRegistry.get(root);

    if (files.length === 0) {
      await indexer.indexWorkspace({ force: false });
      return;
    }

    await indexer.indexFiles(files);
  }

  private async searchMemory(
    query: string,
    limit: number,
    metadataFilter?: (metadata: Record<string, unknown>) => boolean
  ): Promise<SearchResult[]> {
    if (this.memoryChunks.size === 0) {
      return [];
    }

    const queryEmbedding = await this.embedder.embed(query);
    const hits: SearchResult[] = [];

    for (const chunk of this.memoryChunks.values()) {
      if (metadataFilter && !metadataFilter(chunk.metadata)) {
        continue;
      }
      const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (similarity < 0.05) continue;
      hits.push({
        code: chunk.code,
        similarity,
        metadata: { ...chunk.metadata },
      });
    }

    return hits.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  private hitToResult(hit: CodeSearchHit): SearchResult {
    const symbolType = hit.symbolType;
    return {
      code: hit.code,
      similarity: hit.similarity,
      metadata: {
        id: hit.id,
        filePath: hit.filePath,
        functionName:
          symbolType === 'function' || symbolType === 'method' ? hit.symbolName : undefined,
        className: symbolType === 'class' ? hit.symbolName : undefined,
        symbolName: hit.symbolName,
        symbolType: hit.symbolType,
        startLine: hit.startLine,
        endLine: hit.endLine,
      },
    };
  }
}
