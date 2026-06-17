export interface CodeChunk {
  id: string;
  filePath: string;
  language: string;
  symbolName: string;
  symbolType: 'function' | 'class' | 'method' | 'file';
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
}

export interface IndexedChunk extends CodeChunk {
  embedding: number[];
}

export interface PersistedCodeIndex {
  version: 1;
  workspacePath: string;
  embedModel: string;
  /** Embedding vector dimension; used to reject indexes built with a different model. */
  embedDim?: number;
  /** True if the index was built while embeddings were degraded to hash fallback. */
  degraded?: boolean;
  updatedAt: string;
  fileHashes: Record<string, string>;
  chunks: IndexedChunk[];
}

export interface CodeSearchHit {
  id: string;
  filePath: string;
  symbolName: string;
  symbolType: string;
  startLine: number;
  endLine: number;
  code: string;
  similarity: number;
  score: number;
}

export interface IndexStatus {
  workspacePath: string;
  chunkCount: number;
  fileCount: number;
  embedModel: string;
  indexPath: string;
  lastUpdated: string | null;
  embeddingBackend: 'ollama' | 'fallback';
}
