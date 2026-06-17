import * as path from 'path';
import { CodebaseIndexer } from './CodebaseIndexer.js';
import { EmbeddingService } from './EmbeddingService.js';
import type { EnhancedContextManager } from '../context/EnhancedContextManager.js';

export class CodebaseIndexerRegistry {
  private static indexers = new Map<string, CodebaseIndexer>();
  private static sharedEmbedder: EmbeddingService | null = null;
  private static enhancedContext: EnhancedContextManager | null = null;

  static setEnhancedContext(manager: EnhancedContextManager): void {
    this.enhancedContext = manager;
  }

  static getEnhancedContext(): EnhancedContextManager | null {
    return this.enhancedContext;
  }

  static getEmbedder(): EmbeddingService {
    if (!this.sharedEmbedder) {
      this.sharedEmbedder = new EmbeddingService();
    }
    return this.sharedEmbedder;
  }

  static get(workspacePath?: string): CodebaseIndexer {
    const root = path.resolve(workspacePath || process.cwd());
    if (!this.indexers.has(root)) {
      this.indexers.set(root, new CodebaseIndexer(root, CodebaseIndexerRegistry.getEmbedder()));
    }
    return this.indexers.get(root)!;
  }

  static clear(workspacePath?: string): void {
    if (workspacePath) {
      this.indexers.delete(path.resolve(workspacePath));
      return;
    }
    this.indexers.clear();
  }
}

