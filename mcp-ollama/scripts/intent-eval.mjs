#!/usr/bin/env node
/**
 * Measure real intent-routing accuracy against a labeled dataset.
 *
 * Runs every labeled request through:
 *   - the regex-only router (`routeCommand`) as a baseline, and
 *   - the three-tier smart router (`routeCommandSmart`) with the LIVE embedder
 *     (and optionally an LLM fallback tier).
 *
 * Prints overall accuracy for each, the embedding backend actually used, a
 * per-intent breakdown, a confusion matrix, and every misclassification.
 *
 * Usage:
 *   npm run build            # produce dist/
 *   node scripts/intent-eval.mjs
 *
 * Env:
 *   OLLAMA_HOST        default http://localhost:11434
 *   EVAL_LLM_MODEL     model for the tier-3 LLM fallback (default: a small one)
 *   EVAL_NO_LLM=1      disable the LLM tier (measure regex + embedding only)
 *   EVAL_EMB_THRESHOLD embedding acceptance threshold (default 0.6)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');

const { routeCommand, routeCommandSmart } = await import(`${DIST}/agents/intentRouter.js`);
const { EmbeddingService } = await import(`${DIST}/indexing/EmbeddingService.js`);

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const AUTH_TOKEN = process.env.OLLAMA_AUTH_TOKEN;
const LLM_MODEL = process.env.EVAL_LLM_MODEL || 'hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M';
const USE_LLM = process.env.EVAL_NO_LLM !== '1';
const EMB_THRESHOLD = Number(process.env.EVAL_EMB_THRESHOLD || '0.45');
const MARGIN_THRESHOLD = Number(process.env.EVAL_MARGIN || '0.08');

/**
 * Labeled dataset. `intent` uses the router's semanticIntent space.
 * Phrasings are deliberately varied and often indirect/colloquial so the test
 * reflects how real users talk, not just the keywords the regex tier knows.
 */
const DATASET = [
  // implement_feature
  { text: 'add a logout button to the navbar', intent: 'implement_feature' },
  { text: 'i want users to be able to reset their password', intent: 'implement_feature' },
  { text: 'we need pagination on the results page', intent: 'implement_feature' },
  { text: 'build a webhook that notifies slack on deploy', intent: 'implement_feature' },
  { text: 'support uploading profile pictures', intent: 'implement_feature' },
  { text: 'can you make the search box autocomplete', intent: 'implement_feature' },
  { text: 'implement caching for the product list', intent: 'implement_feature' },
  { text: 'wire up dark mode across the app', intent: 'implement_feature' },
  { text: 'i need an endpoint that returns the current user', intent: 'implement_feature' },
  { text: 'let people export their data to csv', intent: 'implement_feature' },
  { text: 'create a rate limiter for the public api', intent: 'implement_feature' },
  { text: 'hook up google sign in', intent: 'implement_feature' },

  // fix_code
  { text: 'the login page crashes when the email is empty', intent: 'fix_code' },
  { text: 'something is wrong, the totals are off by one', intent: 'fix_code' },
  { text: 'this throws a null pointer when the list is empty', intent: 'fix_code' },
  { text: 'the build broke after my last commit', intent: 'fix_code' },
  { text: 'users are getting a 500 on checkout', intent: 'fix_code' },
  { text: 'the date parsing is returning garbage', intent: 'fix_code' },
  { text: 'why does the app freeze on startup, please fix it', intent: 'fix_code' },
  { text: 'there is a memory leak in the worker', intent: 'fix_code' },
  { text: 'the tests started failing out of nowhere', intent: 'fix_code' },
  { text: 'resolve the race condition in the queue', intent: 'fix_code' },
  { text: 'it keeps logging the user out randomly', intent: 'fix_code' },
  { text: 'the dropdown does not close when i click away', intent: 'fix_code' },

  // refactor
  { text: 'this function is way too long, break it up', intent: 'refactor' },
  { text: 'clean up the duplication in the controllers', intent: 'refactor' },
  { text: 'the auth module is a mess, reorganize it', intent: 'refactor' },
  { text: 'make this code easier to read', intent: 'refactor' },
  { text: 'extract the validation logic into its own helper', intent: 'refactor' },
  { text: 'simplify this nested if statement', intent: 'refactor' },
  { text: 'tidy up the imports across the project', intent: 'refactor' },
  { text: 'restructure the service layer to be more modular', intent: 'refactor' },
  { text: 'this is really hard to follow, rewrite it more cleanly', intent: 'refactor' },
  { text: 'reduce the coupling between these two classes', intent: 'refactor' },

  // generate_tests
  { text: 'write unit tests for the auth service', intent: 'generate_tests' },
  { text: 'we need better coverage on the parser', intent: 'generate_tests' },
  { text: 'add some tests for the date utils', intent: 'generate_tests' },
  { text: 'can you cover the checkout flow with tests', intent: 'generate_tests' },
  { text: 'generate a test suite for the api routes', intent: 'generate_tests' },
  { text: 'i want tests around the error handling path', intent: 'generate_tests' },
  { text: 'spec out the behavior of the cache layer', intent: 'generate_tests' },
  { text: 'make sure the validators have test coverage', intent: 'generate_tests' },

  // review
  { text: 'take a look at this PR and tell me whats wrong', intent: 'review' },
  { text: 'review the security of the auth flow', intent: 'review' },
  { text: 'audit this file for potential issues', intent: 'review' },
  { text: 'what could be improved in this implementation', intent: 'review' },
  { text: 'give me feedback on the database schema', intent: 'review' },
  { text: 'analyze the performance of the search query', intent: 'review' },
  { text: 'is there anything risky in this code', intent: 'review' },
  { text: 'check this module over for bad practices', intent: 'review' },

  // create_directory (regex fast path)
  { text: 'mkdir src/components', intent: 'create_directory' },
  { text: 'create a folder named utils', intent: 'create_directory' },
  { text: 'make a directory called assets', intent: 'create_directory' },

  // create_file (regex fast path)
  { text: 'touch src/index.ts', intent: 'create_file' },
  { text: 'create a file named config.json', intent: 'create_file' },
  { text: 'make a file called README inside docs', intent: 'create_file' },
];

async function classifyByLlm(description) {
  const prompt =
    'Classify the developer request into exactly one intent.\n' +
    'Allowed intents: implement_feature, fix_code, refactor, generate_tests, review, create_directory, create_file.\n' +
    'Respond with ONLY a JSON object of the form {"intent": "<one>", "confidence": <0..1>}.\n\n' +
    `Request: """${description.slice(0, 500)}"""`;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const match = (data.response || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.intent !== 'string') return null;
    return { intent: parsed.intent, confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.6 };
  } catch {
    return null;
  }
}

function pct(n, d) {
  return d === 0 ? '0.0' : ((n / d) * 100).toFixed(1);
}

async function main() {
  const embedder = new EmbeddingService();

  // Warm up so the backend ('ollama' vs 'fallback') reflects reality.
  await embedder.embed('warm up the embedding model');
  const backend = embedder.getBackend();
  console.log(`Ollama host:        ${OLLAMA_HOST}`);
  console.log(`Embedding model:    ${embedder.getModel()} (backend: ${backend})`);
  console.log(`LLM tier:           ${USE_LLM ? LLM_MODEL : 'disabled'}`);
  console.log(`Embed threshold:    ${EMB_THRESHOLD}`);
  console.log(`Margin threshold:   ${MARGIN_THRESHOLD}`);
  console.log(`Dataset size:       ${DATASET.length}\n`);

  if (backend === 'fallback') {
    console.log('WARNING: embeddings are on the hash fallback — Tier 2 is dormant.');
    console.log('Pull a real model, e.g.:  ollama pull nomic-embed-text\n');
  }

  const intents = [...new Set(DATASET.map((d) => d.intent))].sort();
  const confusion = {};
  for (const a of intents) {
    confusion[a] = {};
    for (const b of intents) confusion[a][b] = 0;
  }

  let regexCorrect = 0;
  let smartCorrect = 0;
  const tierCounts = { regex: 0, embedding: 0, llm: 0, base: 0 };
  const misses = [];

  for (const ex of DATASET) {
    // Baseline: regex-only.
    const base = routeCommand(ex.text);
    if (base.semanticIntent === ex.intent) regexCorrect++;

    // Tier attribution instrumentation.
    let llmCalled = false;
    const deps = {
      embedder,
      embeddingThreshold: EMB_THRESHOLD,
      marginThreshold: MARGIN_THRESHOLD,
      ...(USE_LLM
        ? {
            classifyByLlm: async (d) => {
              llmCalled = true;
              return classifyByLlm(d);
            },
          }
        : {}),
    };

    const smart = await routeCommandSmart(ex.text, undefined, deps);
    const predicted = smart.semanticIntent;
    const correct = predicted === ex.intent;
    if (correct) smartCorrect++;

    // Attribute which tier decided.
    const isRegexTier = base.strategy === 'fast_fs' || base.confidence >= 0.7;
    let tier;
    if (isRegexTier) tier = 'regex';
    else if (!llmCalled && smart.strategy === 'semantic_agent') tier = 'embedding';
    else if (llmCalled && smart.strategy === 'semantic_agent' && smart !== base) tier = 'llm';
    else tier = 'base';
    tierCounts[tier]++;

    if (confusion[ex.intent] && intents.includes(predicted)) {
      confusion[ex.intent][predicted]++;
    }

    if (!correct) {
      misses.push({ text: ex.text, expected: ex.intent, predicted, tier });
    }
  }

  const n = DATASET.length;
  console.log('--- Accuracy ---');
  console.log(`Regex-only baseline:  ${regexCorrect}/${n}  (${pct(regexCorrect, n)}%)`);
  console.log(`Smart router:         ${smartCorrect}/${n}  (${pct(smartCorrect, n)}%)`);
  console.log(`Lift from new tiers:  +${pct(smartCorrect - regexCorrect, n)} points\n`);

  console.log('--- Decisions by tier (smart router) ---');
  for (const [tier, count] of Object.entries(tierCounts)) {
    console.log(`  ${tier.padEnd(10)} ${count}`);
  }
  console.log('');

  console.log('--- Per-intent accuracy (smart router) ---');
  for (const intent of intents) {
    const total = DATASET.filter((d) => d.intent === intent).length;
    const right = confusion[intent][intent];
    console.log(`  ${intent.padEnd(18)} ${right}/${total}  (${pct(right, total)}%)`);
  }
  console.log('');

  console.log('--- Confusion matrix (rows=expected, cols=predicted) ---');
  const header = ['expected\\pred', ...intents.map((i) => i.slice(0, 8))];
  console.log('  ' + header.map((h) => h.padEnd(16)).join(''));
  for (const a of intents) {
    const row = [a.slice(0, 14), ...intents.map((b) => String(confusion[a][b]))];
    console.log('  ' + row.map((c) => c.padEnd(16)).join(''));
  }
  console.log('');

  if (misses.length) {
    console.log(`--- Misclassifications (${misses.length}) ---`);
    for (const m of misses) {
      console.log(`  [${m.tier}] expected=${m.expected} got=${m.predicted}  "${m.text}"`);
    }
  } else {
    console.log('No misclassifications.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
