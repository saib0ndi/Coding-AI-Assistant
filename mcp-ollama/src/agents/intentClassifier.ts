/**
 * Embedding-based intent classification.
 *
 * Compares a user request against a small set of curated exemplar phrasings for
 * each intent, using real transformer embeddings (via the injected embedder).
 * This is the "phrasing-robust" tier of the router: it understands paraphrases
 * and colloquial requests that the regex tier misses.
 *
 * The classifier deliberately returns `null` when the embedder is running on its
 * hash-based fallback backend, because hash similarity is not semantically
 * meaningful and would produce misleading matches. Callers should fall back to
 * regex/LLM routing in that case.
 */
import { EmbeddingService } from '../indexing/EmbeddingService.js';

/** Minimal embedder contract so this module is testable without Ollama. */
export interface EmbedderLike {
  embed(text: string): Promise<number[]>;
  getBackend?(): 'ollama' | 'fallback';
  getModel?(): string;
}

export interface IntentExemplarGroup {
  /** Semantic intent label, aligned with the router's downstream mapping. */
  intent: string;
  /** Natural, varied phrasings a user might use for this intent. */
  phrases: string[];
}

export interface IntentClassification {
  intent: string;
  confidence: number;
  /** Second-best intent (null when only one intent has a non-zero score). */
  runnerUp: string | null;
  /**
   * Gap between the best and second-best similarity. A small margin means the
   * top two intents are close, i.e. the embedding decision is ambiguous and a
   * good candidate for deferring to the LLM tier.
   */
  margin: number;
  /** Per-intent best similarity, for debugging/observability. */
  scores: Record<string, number>;
}

export interface ClassifyOptions {
  /** Minimum best-score required to return a classification (else null). */
  minConfidence?: number;
  exemplars?: IntentExemplarGroup[];
}

/**
 * Curated exemplars. Intent labels match the semantic intents consumed by
 * `intentRouter` (`buildRouteFromIntent`) and its downstream task/tool mapping.
 */
export const INTENT_EXEMPLARS: IntentExemplarGroup[] = [
  {
    intent: 'implement_feature',
    phrases: [
      'add a login endpoint',
      'build a caching layer for the API',
      'implement rate limiting on the server',
      'create a function to parse dates',
      'add support for dark mode',
      'write a helper that retries failed requests',
      'i need a new feature to export data as csv',
    ],
  },
  {
    intent: 'fix_code',
    phrases: [
      'this is throwing an error, fix it',
      'the tests are failing, repair them',
      'there is a bug in the auth flow',
      'resolve the null pointer issue',
      'something is broken in the parser',
      'fix the crash on startup',
      'it stopped working after my last change',
    ],
  },
  {
    intent: 'refactor',
    phrases: [
      'tidy up the auth module',
      'clean up this messy code',
      'make this function simpler and easier to read',
      'restructure the service layer',
      'this code is ugly, improve it',
      'reduce duplication in the request handlers',
      'extract this logic into smaller functions',
    ],
  },
  {
    intent: 'generate_tests',
    phrases: [
      'write unit tests for the parser',
      'add test coverage for the auth service',
      'generate tests for this module',
      'i need tests for the utils file',
      'cover this function with tests',
      'create a test suite for the api routes',
    ],
  },
  {
    intent: 'review',
    phrases: [
      'take a look at this and tell me what is wrong',
      'review the security of this module',
      'audit this code for issues',
      'what could be improved here',
      'give me feedback on this implementation',
      'analyze this file for problems',
    ],
  },
];

// One-time cache of exemplar embeddings, keyed by model + phrase. Exemplars are
// static, so we only pay the embedding cost once per process per model.
const exemplarEmbeddingCache = new Map<string, number[]>();

function cacheKey(model: string, phrase: string): string {
  return `${model}::${phrase}`;
}

async function embedExemplars(
  embedder: EmbedderLike,
  exemplars: IntentExemplarGroup[]
): Promise<Map<string, number[][]>> {
  const model = embedder.getModel?.() ?? 'default';
  const byIntent = new Map<string, number[][]>();

  for (const group of exemplars) {
    const vectors: number[][] = [];
    for (const phrase of group.phrases) {
      const key = cacheKey(model, phrase);
      let vec = exemplarEmbeddingCache.get(key);
      if (!vec) {
        vec = await embedder.embed(phrase);
        // Don't cache hash-fallback vectors; they're not stable/meaningful.
        if (embedder.getBackend?.() !== 'fallback') {
          exemplarEmbeddingCache.set(key, vec);
        }
      }
      vectors.push(vec);
    }
    byIntent.set(group.intent, vectors);
  }

  return byIntent;
}

/**
 * Classify a request by embedding similarity against exemplar phrasings.
 * Returns `null` if embeddings are on the hash fallback, or if the best score is
 * below `minConfidence`.
 */
export async function classifyIntentByEmbedding(
  description: string,
  embedder: EmbedderLike,
  options: ClassifyOptions = {}
): Promise<IntentClassification | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;

  const exemplars = options.exemplars ?? INTENT_EXEMPLARS;
  const minConfidence = options.minConfidence ?? 0;

  const queryVec = await embedder.embed(trimmed);

  // Hash-fallback similarity is meaningless; let the caller use regex/LLM.
  if (embedder.getBackend?.() === 'fallback') return null;

  const exemplarVecs = await embedExemplars(embedder, exemplars);

  const scores: Record<string, number> = {};
  for (const group of exemplars) {
    const vectors = exemplarVecs.get(group.intent) ?? [];
    let groupBest = 0;
    for (const vec of vectors) {
      const sim = EmbeddingService.cosineSimilarity(queryVec, vec);
      if (sim > groupBest) groupBest = sim;
    }
    scores[group.intent] = groupBest;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || top[1] < minConfidence) return null;

  const runnerUp = ranked[1] ?? null;
  return {
    intent: top[0],
    confidence: top[1],
    runnerUp: runnerUp ? runnerUp[0] : null,
    margin: top[1] - (runnerUp ? runnerUp[1] : 0),
    scores,
  };
}

/** Reset the exemplar embedding cache (test helper). */
export function _resetExemplarCache(): void {
  exemplarEmbeddingCache.clear();
}
