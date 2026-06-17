import fetch from 'node-fetch';
import { Logger } from '../utils/Logger.js';
import { loadAppConfig, normalizeUrl } from '../config/AppConfig.js';

export type EmbeddingBackend = 'ollama' | 'fallback';

export class EmbeddingService {
  private logger = new Logger();
  private host: string;
  private model: string;
  private timeoutMs: number;
  private authToken: string | undefined;
  private backend: EmbeddingBackend = 'ollama';
  private warnedFallback = false;
  private attemptedAutoDetect = false;

  constructor(host?: string, model?: string) {
    const appConfig = loadAppConfig();
    // Prefer the dedicated embedding host (OLLAMA_EMBED_HOST) so embeddings are
    // isolated from the main inference host, which may be busy or OOM.
    this.host = normalizeUrl(host, appConfig.ollama.embedHost);
    this.model = model || appConfig.ollama.embedModel;
    this.timeoutMs = appConfig.ollama.embedTimeoutMs;
    this.authToken = appConfig.ollama.authToken;
  }

  getBackend(): EmbeddingBackend {
    return this.backend;
  }

  getModel(): string {
    return this.model;
  }

  // Embeds a single text string using Ollama or falls back to simple hash-based vectors
  // Embeds a single text string using Ollama or falls back to simple hash-based vectors
  // Note for embed
  // Note for embed
  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim().slice(0, 8000);
    if (!trimmed) return this.fallbackEmbed('');

    try {
      // embedBatch sets this.backend correctly (ollama on success, fallback on
      // failure); don't override it here or the fallback signal is lost.
      const vectors = await this.embedBatch([trimmed]);
      return vectors[0] ?? this.fallbackEmbed(trimmed);
    } catch (error) {
      if (!this.warnedFallback) {
        this.logger.warn(
          `Ollama embeddings unavailable (${error instanceof Error ? error.message : error}); using fallback vectors`
        );
        this.warnedFallback = true;
      }
      this.backend = 'fallback';
      return this.fallbackEmbed(trimmed);
    }
  }

  private async autoDetectEmbedModel(): Promise<boolean> {
    try {
      this.logger.info(`Attempting to auto-detect available embedding models from ${this.host}...`);
      const response = await fetch(`${this.host}/api/tags`, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
      });
      if (!response.ok) return false;

      const data = await response.json() as { models?: { name: string }[] };
      const models = data.models || [];
      
      const priorityOrder = [
        'nomic-embed-text:latest',
        'nomic-embed-text',
        'qllama/bge-small-en-v1.5:f16',
        'qllama/bge-small-en-v1.5:latest',
        'bge-small-en-v1.5:latest',
        'all-minilm:latest'
      ];

      for (const preferred of priorityOrder) {
        if (models.some(m => m.name === preferred)) {
          this.model = preferred;
          this.logger.info(`Auto-detected and switched embedding model to: ${preferred}`);
          return true;
        }
      }

      // Fallback to searching for any model containing 'embed' or 'bge'
      const found = models.find(m => m.name.includes('embed') || m.name.includes('bge'));
      if (found) {
        this.model = found.name;
        this.logger.info(`Auto-detected and switched embedding model to: ${found.name}`);
        return true;
      }
      return false;
    } catch (e) {
      this.logger.warn(`Failed to auto-detect embedding model: ${e}`);
      return false;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const inputs = texts.map((t) => t.trim().slice(0, 8000)).filter(Boolean);
    if (inputs.length === 0) return [];
    return this.embedPrepared(inputs);
  }

  /**
   * Embed already-prepared inputs, distinguishing two failure modes:
   *  - Content errors (HTTP 4xx such as 400/413/422): the batch is too large or
   *    a specific item is unacceptable. Split the batch and retry so the rest
   *    still gets real embeddings; a single offending item is skipped (empty
   *    vector) rather than stored as a wrong-dimension hash vector that would
   *    poison the index.
   *  - Backend errors (network/timeout/5xx): Ollama is unavailable, so degrade
   *    to hash-based fallback vectors and flag the backend as degraded.
   */
  private async embedPrepared(inputs: string[]): Promise<number[][]> {
    let attempts = 0;
    while (attempts < 2) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.host}/api/embed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          },
          // keep_alive keeps the embed model resident between batches; without it
          // Ollama unloads it after each call and a full re-index reloads the
          // model repeatedly, making indexing extremely slow.
          body: JSON.stringify({
            model: this.model,
            input: inputs.length === 1 ? inputs[0] : inputs,
            keep_alive: '10m',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          if (response.status === 404 && !this.attemptedAutoDetect) {
            this.attemptedAutoDetect = true;
            const detected = await this.autoDetectEmbedModel();
            if (detected) {
              attempts++;
              continue;
            }
          }
          const err = new Error(`embed HTTP ${response.status}`) as Error & { status?: number };
          err.status = response.status;
          throw err;
        }

        const data = (await response.json()) as { embeddings?: number[][]; embedding?: number[] };

        if (Array.isArray(data.embeddings)) {
          this.backend = 'ollama';
          return data.embeddings;
        }
        if (Array.isArray(data.embedding)) {
          this.backend = 'ollama';
          return [data.embedding];
        }
        throw new Error('embed response missing embeddings');
      } catch (error) {
        clearTimeout(timeout);

        if (attempts === 0 && !this.attemptedAutoDetect) {
          const is404 = error instanceof Error && error.message.includes('404');
          if (is404) {
            this.attemptedAutoDetect = true;
            const detected = await this.autoDetectEmbedModel();
            if (detected) {
              attempts++;
              continue;
            }
          }
        }

        const status = (error as { status?: number })?.status;
        const isContentError = typeof status === 'number' && status >= 400 && status < 500 && status !== 404;

        // Too-large batch (or one bad item): split and retry so the rest of the
        // batch still gets real embeddings instead of all falling back.
        if (isContentError && inputs.length > 1) {
          const mid = Math.ceil(inputs.length / 2);
          const left = await this.embedPrepared(inputs.slice(0, mid));
          const right = await this.embedPrepared(inputs.slice(mid));
          return [...left, ...right];
        }

        // A single item the model rejects: skip it (empty vector) so it can't
        // poison the index with a mismatched-dimension fallback vector.
        if (isContentError && inputs.length === 1) {
          this.logger.warn(`Skipping un-embeddable chunk (HTTP ${status})`);
          return [[]];
        }

        // Backend genuinely unavailable: degrade to hash-based fallback vectors.
        if (!this.warnedFallback) {
          this.logger.warn(
            `Ollama embeddings unavailable (${error instanceof Error ? error.message : error}); using fallback vectors`
          );
          this.warnedFallback = true;
        }
        this.backend = 'fallback';
        return inputs.map((t) => this.fallbackEmbed(t));
      }
    }

    this.backend = 'fallback';
    return inputs.map((t) => this.fallbackEmbed(t));
  }

  /** Lightweight fallback when Ollama embed model is unavailable */
  private fallbackEmbed(text: string): number[] {
    const dims = 384;
    const vector = new Array(dims).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);

    for (const token of tokens) {
      let h = 0;
      for (let i = 0; i < token.length; i++) {
        h = (h * 31 + token.charCodeAt(i)) >>> 0;
      }
      vector[h % dims] += 1;
      vector[(h >> 8) % dims] += 0.5;
    }

    const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return magnitude > 0 ? vector.map((v) => v / magnitude) : vector;
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }
}
