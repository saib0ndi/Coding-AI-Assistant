import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { Logger } from '../utils/Logger.js';
import { CodeChunker } from './CodeChunker.js';
import { EmbeddingService } from './EmbeddingService.js';
import type { CodeSearchHit, CodeChunk, IndexStatus, IndexedChunk, PersistedCodeIndex } from './types.js';

const INDEX_DIR = '.coding-ai';
const INDEX_FILE = 'index.json';
const MAX_FILE_BYTES = 120_000;
const MAX_FILES = 2500;
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.coding-ai',
  'coverage',
  '.next',
  'vendor',
  '__pycache__',
]);

export class CodebaseIndexer {
  private logger = new Logger();
  private chunker = new CodeChunker();
  private embedder: EmbeddingService;
  private workspacePath: string;
  private chunks = new Map<string, IndexedChunk>();
  private fileHashes = new Map<string, string>();
  private lastUpdated: string | null = null;
  private indexFilePath: string;

  constructor(workspacePath: string, embedder?: EmbeddingService) {
    this.workspacePath = path.resolve(workspacePath);
    this.embedder = embedder ?? new EmbeddingService();
    this.indexFilePath = path.join(this.workspacePath, INDEX_DIR, INDEX_FILE);
  }

  getIndexPath(): string {
    return this.indexFilePath;
  }

  async load(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.indexFilePath, 'utf-8');
      const data = JSON.parse(raw) as PersistedCodeIndex;
      if (data.version !== 1 || data.workspacePath !== this.workspacePath) {
        return false;
      }
      // Reject indexes built with a different embedding model: their vectors live
      // in a different space/dimension, so cosine similarity against current
      // queries would be meaningless (and silently wrong).
      if (data.embedModel !== this.embedder.getModel()) {
        this.logger.warn(
          `Discarding stale index: built with '${data.embedModel}', current model is '${this.embedder.getModel()}'. Will re-index.`
        );
        return false;
      }
      // Reject indexes that were persisted while embeddings were degraded to the
      // hash-based fallback, or that contain mixed vector dimensions.
      const dims = new Set(data.chunks.map((c) => c.embedding.length).filter((n) => n > 0));
      if (data.degraded === true || dims.size > 1) {
        this.logger.warn(
          `Discarding unreliable index (degraded=${data.degraded === true}, dimensions=${[...dims].join('/')}). Will re-index.`
        );
        return false;
      }
      this.fileHashes = new Map(Object.entries(data.fileHashes));
      this.chunks.clear();
      for (const chunk of data.chunks) {
        this.chunks.set(chunk.id, chunk);
      }
      this.lastUpdated = data.updatedAt;
      await this.syncToEnhancedContext();
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.indexFilePath);
    await fs.mkdir(dir, { recursive: true });
    const chunks = Array.from(this.chunks.values());
    const dims = new Set(chunks.map((c) => c.embedding.length).filter((n) => n > 0));
    const payload: PersistedCodeIndex = {
      version: 1,
      workspacePath: this.workspacePath,
      embedModel: this.embedder.getModel(),
      embedDim: dims.size === 1 ? [...dims][0] : 0,
      degraded: this.embedder.getBackend() === 'fallback' || dims.size > 1,
      updatedAt: new Date().toISOString(),
      fileHashes: Object.fromEntries(this.fileHashes),
      chunks,
    };
    await fs.writeFile(this.indexFilePath, JSON.stringify(payload), 'utf-8');
    this.lastUpdated = payload.updatedAt;
  }

  getStatus(): IndexStatus {
    const files = new Set(Array.from(this.chunks.values()).map((c) => c.filePath));
    return {
      workspacePath: this.workspacePath,
      chunkCount: this.chunks.size,
      fileCount: files.size,
      embedModel: this.embedder.getModel(),
      indexPath: this.indexFilePath,
      lastUpdated: this.lastUpdated,
      embeddingBackend: this.embedder.getBackend(),
    };
  }

  async indexWorkspace(options?: { force?: boolean; maxFiles?: number }): Promise<IndexStatus> {
    const force = options?.force === true;
    const maxFiles = options?.maxFiles ?? MAX_FILES;

    if (!force) {
      await this.load();
    } else {
      this.chunks.clear();
      this.fileHashes.clear();
    }

    const files = await this.collectSourceFiles(maxFiles);
    let indexedFiles = 0;
    let reindexed = 0;

    for (const filePath of files) {
      const rel = path.relative(this.workspacePath, filePath);
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > MAX_FILE_BYTES) continue;

        const content = await fs.readFile(filePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

        if (!force && this.fileHashes.get(rel) === hash) {
          indexedFiles++;
          continue;
        }

        await this.indexFile(rel, content);
        this.fileHashes.set(rel, hash);
        indexedFiles++;
        reindexed++;
      } catch (error) {
        this.logger.warn(`Skip index ${rel}: ${error instanceof Error ? error.message : error}`);
      }
    }

    this.pruneStaleChunks(files);
    await this.save();

    this.logger.info(
      `Indexed workspace ${this.workspacePath}: ${this.chunks.size} chunks, ${reindexed} files updated`
    );

    await this.syncToEnhancedContext();
    return this.getStatus();
  }

  /** Index explicit in-memory file contents (used by VectorStore / symbol table). */
  async indexFiles(
    files: Array<{ path: string; content: string; language: string }>
  ): Promise<IndexStatus> {
    if (files.length === 0) {
      return this.getStatus();
    }

    await this.load();

    for (const file of files) {
      const rel = path.isAbsolute(file.path)
        ? path.relative(this.workspacePath, file.path)
        : file.path;
      if (rel.startsWith('..')) {
        continue;
      }

      const hash = createHash('sha256').update(file.content).digest('hex').slice(0, 16);
      await this.indexFile(rel, file.content);
      this.fileHashes.set(rel, hash);
    }

    await this.save();
    await this.syncToEnhancedContext();
    return this.getStatus();
  }

  getChunks(): IndexedChunk[] {
    return Array.from(this.chunks.values());
  }

  private async syncToEnhancedContext(): Promise<void> {
    try {
      const { CodebaseIndexerRegistry } = await import('./CodebaseIndexerRegistry.js');
      const enhancedContext = CodebaseIndexerRegistry.getEnhancedContext();
      if (enhancedContext && typeof (enhancedContext as any).populateFromIndexer === 'function') {
        (enhancedContext as any).populateFromIndexer(this.getChunks());
      }
    } catch (err) {
      this.logger.warn(`Failed to sync to EnhancedContextManager: ${err}`);
    }
  }

  async search(query: string, limit = 8): Promise<CodeSearchHit[]> {
    if (this.chunks.size === 0) {
      await this.load();
    }
    if (this.chunks.size === 0) {
      return [];
    }

    const queryEmbedding = await this.embedder.embed(query);
    const hits: CodeSearchHit[] = [];

    for (const chunk of this.chunks.values()) {
      const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (similarity < 0.05) continue;
      hits.push({
        id: chunk.id,
        filePath: chunk.filePath,
        symbolName: chunk.symbolName,
        symbolType: chunk.symbolType,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        code: chunk.content,
        similarity,
        score: similarity,
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async findSimilar(code: string, language: string, limit = 5): Promise<CodeSearchHit[]> {
    const queryEmbedding = await this.embedder.embed(`${language}\n${code.slice(0, 4000)}`);
    const hits: CodeSearchHit[] = [];

    for (const chunk of this.chunks.values()) {
      if (chunk.language !== language && language !== 'text') continue;
      const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      hits.push({
        id: chunk.id,
        filePath: chunk.filePath,
        symbolName: chunk.symbolName,
        symbolType: chunk.symbolType,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        code: chunk.content,
        similarity,
        score: similarity,
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async indexFile(relPath: string, content: string): Promise<void> {
    const language = CodeChunker.languageFromPath(relPath);
    const fileChunks = this.chunker.chunkFile(relPath, content, language);

    for (const key of this.chunks.keys()) {
      if (key.startsWith(`${relPath}:`)) {
        this.chunks.delete(key);
      }
    }

    const batch = fileChunks.slice(0, 40);
    // Create embeddings for each chunk to enable semantic search
    // Create embeddings for each chunk to enable semantic search
const embeddings = await this.embedder.embedBatch(batch.map((c) => this.chunkEmbedInput(c)));

    batch.forEach((chunk, i) => {
      this.chunks.set(chunk.id, {
        ...chunk,
        embedding: embeddings[i] ?? [],
      });
    });
  }

  private chunkEmbedInput(chunk: CodeChunk): string {
    return [
      `language: ${chunk.language}`,
      `file: ${chunk.filePath}`,
      `symbol: ${chunk.symbolType} ${chunk.symbolName}`,
      chunk.content,
    ].join('\n');
  }

  private pruneStaleChunks(currentFiles: string[]): void {
    const relSet = new Set(currentFiles.map((f) => path.relative(this.workspacePath, f)));
    for (const chunk of this.chunks.values()) {
      if (!relSet.has(chunk.filePath)) {
        this.chunks.delete(chunk.id);
        this.fileHashes.delete(chunk.filePath);
      }
    }
  }

  private async collectSourceFiles(maxFiles: number): Promise<string[]> {
    const results: string[] = [];
    const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java']);

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= maxFiles) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          await walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (exts.has(ext)) results.push(full);
        }
      }
    };

    await walk(this.workspacePath);
    return results;
  }
}
