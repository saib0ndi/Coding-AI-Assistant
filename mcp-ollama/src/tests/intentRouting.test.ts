import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIntentByEmbedding,
  INTENT_EXEMPLARS,
  _resetExemplarCache,
  type EmbedderLike,
} from '../agents/intentClassifier.js';
import { routeCommandSmart, type SmartRouteDeps } from '../agents/intentRouter.js';

/**
 * Deterministic mock embedder. It maps text to a vector in "intent space":
 * one dimension per intent, set to the number of that intent's marker words
 * present in the text. Exemplars therefore embed near the one-hot vector for
 * their own intent, and paraphrases that share markers cluster with them.
 * This exercises the real classification pipeline (cosine, argmax, threshold,
 * caching) without requiring Ollama.
 */
const INTENT_MARKERS: Record<string, string[]> = {
  implement_feature: ['add', 'build', 'implement', 'create', 'write', 'new', 'feature', 'support'],
  fix_code: ['fix', 'error', 'bug', 'broken', 'crash', 'repair', 'resolve'],
  refactor: ['refactor', 'restructure', 'tidy', 'clean', 'messy', 'simpler', 'duplication', 'ugly', 'extract'],
  generate_tests: ['test', 'tests', 'coverage', 'suite', 'spec'],
  review: ['review', 'audit', 'analyze', 'feedback', 'problems', 'wrong', 'improved'],
};

const INTENT_ORDER = Object.keys(INTENT_MARKERS);

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

function makeMockEmbedder(backend: 'ollama' | 'fallback' = 'ollama'): EmbedderLike {
  return {
    getBackend: () => backend,
    getModel: () => 'mock-model',
    async embed(text: string): Promise<number[]> {
      const tokens = new Set(tokenize(text));
      const vec = INTENT_ORDER.map((intent) =>
        INTENT_MARKERS[intent].reduce((n, marker) => (tokens.has(marker) ? n + 1 : n), 0)
      );
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return mag > 0 ? vec.map((v) => v / mag) : vec;
    },
  };
}

describe('classifyIntentByEmbedding', () => {
  beforeEach(() => _resetExemplarCache());

  const paraphrases: Array<{ text: string; intent: string }> = [
    { text: 'please add a new feature for csv export', intent: 'implement_feature' },
    { text: 'there is a bug that makes it crash', intent: 'fix_code' },
    { text: 'this code is messy, please tidy and clean it', intent: 'refactor' },
    { text: 'generate tests for the helpers', intent: 'generate_tests' },
    { text: 'audit this and tell me the problems', intent: 'review' },
  ];

  for (const { text, intent } of paraphrases) {
    it(`routes paraphrase to ${intent}: "${text}"`, async () => {
      const result = await classifyIntentByEmbedding(text, makeMockEmbedder(), {
        minConfidence: 0.6,
      });
      assert.ok(result, 'expected a classification');
      assert.equal(result!.intent, intent);
      assert.ok(result!.confidence >= 0.6);
    });
  }

  it('returns null when no markers match (below threshold)', async () => {
    const result = await classifyIntentByEmbedding('do something with the thing', makeMockEmbedder(), {
      minConfidence: 0.6,
    });
    assert.equal(result, null);
  });

  it('returns null when the embedder is on the hash fallback', async () => {
    const result = await classifyIntentByEmbedding('there is a bug that makes it crash', makeMockEmbedder('fallback'), {
      minConfidence: 0.6,
    });
    assert.equal(result, null);
  });

  it('covers every documented intent with at least one exemplar', () => {
    const intents = new Set(INTENT_EXEMPLARS.map((g) => g.intent));
    for (const intent of ['implement_feature', 'fix_code', 'refactor', 'generate_tests', 'review']) {
      assert.ok(intents.has(intent), `missing exemplars for ${intent}`);
    }
  });
});

describe('routeCommandSmart', () => {
  beforeEach(() => _resetExemplarCache());

  it('passes through high-confidence filesystem commands without consulting tiers', async () => {
    let embedCalls = 0;
    let llmCalls = 0;
    const deps: SmartRouteDeps = {
      embedder: {
        getBackend: () => 'ollama',
        async embed() {
          embedCalls++;
          return [];
        },
      },
      classifyByLlm: async () => {
        llmCalls++;
        return null;
      },
    };

    const route = await routeCommandSmart('mkdir src', undefined, deps);
    assert.equal(route.strategy, 'fast_fs');
    assert.equal(embedCalls, 0);
    assert.equal(llmCalls, 0);
  });

  it('uses the embedding tier for low-confidence phrasing', async () => {
    const route = await routeCommandSmart('this code is messy, please tidy it up', undefined, {
      embedder: makeMockEmbedder(),
      embeddingThreshold: 0.6,
    });
    assert.equal(route.strategy, 'semantic_agent');
    assert.equal(route.semanticIntent, 'refactor');
    assert.equal(route.taskType, 'refactor');
  });

  it('maps a review intent to the analyze task type', async () => {
    const route = await routeCommandSmart('audit this module and tell me the problems', undefined, {
      embedder: makeMockEmbedder(),
      embeddingThreshold: 0.6,
    });
    assert.equal(route.semanticIntent, 'review');
    assert.equal(route.taskType, 'analyze');
  });

  it('falls back to the LLM tier when embeddings are on the hash fallback', async () => {
    let llmCalled = false;
    const route = await routeCommandSmart('the thingy is acting up again', undefined, {
      embedder: makeMockEmbedder('fallback'),
      classifyByLlm: async () => {
        llmCalled = true;
        return { intent: 'fix_code', confidence: 0.9 };
      },
    });
    assert.ok(llmCalled, 'LLM classifier should be consulted');
    assert.equal(route.semanticIntent, 'fix_code');
    assert.equal(route.taskType, 'fix');
  });

  it('does NOT consult the LLM when the embedding pick is confident and unambiguous', async () => {
    let llmCalled = false;
    const route = await routeCommandSmart('this code is messy, please tidy it up', undefined, {
      embedder: makeMockEmbedder(),
      embeddingThreshold: 0.6,
      classifyByLlm: async () => {
        llmCalled = true;
        return { intent: 'fix_code', confidence: 0.9 };
      },
    });
    assert.equal(llmCalled, false, 'LLM should be skipped for an unambiguous embedding match');
    assert.equal(route.semanticIntent, 'refactor');
  });

  // This query hits refactor markers (clean, messy) and generate_tests markers
  // (coverage, spec) equally -> margin ~0 -> ambiguous. It deliberately avoids
  // regex high-confidence trigger words so it reaches the embedding/LLM tiers.
  const ambiguousQuery = 'improve coverage and clean up the messy spec';

  it('defers to the LLM when the top-2 embedding intents are close (ambiguous)', async () => {
    let llmCalled = false;
    const route = await routeCommandSmart(ambiguousQuery, undefined, {
      embedder: makeMockEmbedder(),
      embeddingThreshold: 0.4,
      marginThreshold: 0.04,
      classifyByLlm: async () => {
        llmCalled = true;
        return { intent: 'generate_tests', confidence: 0.9 };
      },
    });
    assert.ok(llmCalled, 'LLM should be consulted on an ambiguous embedding decision');
    assert.equal(route.semanticIntent, 'generate_tests');
  });

  it('falls back to the embedding pick when ambiguous and the LLM is inconclusive', async () => {
    const route = await routeCommandSmart(ambiguousQuery, undefined, {
      embedder: makeMockEmbedder(),
      embeddingThreshold: 0.4,
      marginThreshold: 0.04,
      classifyByLlm: async () => null,
    });
    // LLM declined, so the embedding's best pick still stands (better than base).
    assert.equal(route.strategy, 'semantic_agent');
    assert.ok(['refactor', 'generate_tests'].includes(route.semanticIntent));
  });

  it('returns the base route when all tiers are inconclusive', async () => {
    const base = await routeCommandSmart('the thingy is acting up again', undefined, {
      embedder: makeMockEmbedder('fallback'),
      classifyByLlm: async () => null,
    });
    // No deps could improve it, so the regex/autonomous route stands.
    assert.equal(base.strategy, 'autonomous');
  });
});
