/**
 * Unified command understanding: maps natural language to task type, agent tool, and strategy.
 * Single entry point for client hints and server-side routing.
 */
import { VectorStore } from '../semantic/VectorStore.js';
import { parseSimpleFsTask, type SimpleFsTask } from './simpleFsTasks.js';
import { inferAgentTool } from './workflowRouting.js';
import { classifyIntentByEmbedding, type EmbedderLike } from './intentClassifier.js';

export type AgentTaskType = 'implement' | 'fix' | 'test' | 'refactor' | 'analyze';

export type CommandStrategy =
  | 'fast_fs'
  | 'semantic_agent'
  | 'autonomous';

export interface CommandRoute {
  taskType: AgentTaskType;
  semanticIntent: string;
  tool: string;
  strategy: CommandStrategy;
  confidence: number;
  target: string;
  simpleFsTask: SimpleFsTask | null;
}

const vectorStore = new VectorStore({ scope: 'memory' });

function hasWord(text: string, word: string): boolean {
  const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return pattern.test(text);
}

/** Infer task type from description using word boundaries (priority-ordered). */
export function inferTaskType(
  description: string,
  explicitType?: string
): AgentTaskType {
  const valid: AgentTaskType[] = ['implement', 'fix', 'test', 'refactor', 'analyze'];
  const fromDescription = inferTaskTypeFromDescription(description);

  // Respect explicit non-default types (e.g. slash /test, /review)
  if (
    explicitType &&
    explicitType !== 'implement' &&
    valid.includes(explicitType as AgentTaskType)
  ) {
    return explicitType as AgentTaskType;
  }

  return fromDescription;
}

function inferTaskTypeFromDescription(description: string): AgentTaskType {
  const lower = description.toLowerCase();

  if (hasWord(lower, 'review') || hasWord(lower, 'audit') || hasWord(lower, 'analyze')) {
    return 'analyze';
  }
  if (
    /\b(?:generate|write|add|create|make)\b.*\b(?:tests?|specs?)\b/i.test(lower) ||
    /\bunit tests?\b/i.test(lower) ||
    (hasWord(lower, 'test') && (hasWord(lower, 'generate') || hasWord(lower, 'write') || hasWord(lower, 'add')))
  ) {
    return 'test';
  }
  if (hasWord(lower, 'refactor') || hasWord(lower, 'restructure')) {
    return 'refactor';
  }
  if (
    hasWord(lower, 'fix') ||
    hasWord(lower, 'bug') ||
    hasWord(lower, 'error') ||
    hasWord(lower, 'repair') ||
    hasWord(lower, 'resolve')
  ) {
    return 'fix';
  }
  if (
    hasWord(lower, 'implement') ||
    hasWord(lower, 'create') ||
    hasWord(lower, 'add') ||
    hasWord(lower, 'build') ||
    hasWord(lower, 'develop') ||
    hasWord(lower, 'write')
  ) {
    return 'implement';
  }

  return 'implement';
}

function mapSemanticIntentToTaskType(intent: string): AgentTaskType {
  switch (intent) {
    case 'create_directory':
    case 'create_file':
      return 'implement';
    case 'generate_tests':
      return 'test';
    case 'fix_code':
      return 'fix';
    case 'refactor':
      return 'refactor';
    case 'implement_feature':
      return 'implement';
    default:
      return 'implement';
  }
}

function mapSemanticIntentToTool(intent: string): string {
  switch (intent) {
    case 'create_directory':
    case 'create_file':
      return 'file';
    case 'generate_tests':
      return 'test';
    case 'fix_code':
    case 'implement_feature':
    case 'refactor':
      return 'code';
    default:
      return 'code';
  }
}

/** Route a user command to the best execution strategy and agent tool. */
export function routeCommand(description: string, explicitType?: string): CommandRoute {
  const trimmed = description.trim();
  const fsTask = parseSimpleFsTask(trimmed);
  if (fsTask) {
    return {
      taskType: 'implement',
      semanticIntent: fsTask.type === 'mkdir' ? 'create_directory' : 'create_file',
      tool: 'file',
      strategy: 'fast_fs',
      confidence: 0.98,
      target: fsTask.relativePath,
      simpleFsTask: fsTask,
    };
  }

  const parsed = vectorStore.parseIntent(trimmed);
  const regexTaskType = inferTaskType(trimmed, explicitType);

  if (parsed.confidence >= 0.7 && parsed.intent !== 'unknown') {
    const semanticTaskType = mapSemanticIntentToTaskType(parsed.intent);
    const descTaskType = inferTaskTypeFromDescription(trimmed);
    return {
      taskType:
        explicitType && explicitType !== 'implement'
          ? inferTaskType(trimmed, explicitType)
          : semanticTaskType !== 'implement'
            ? semanticTaskType
            : descTaskType,
      semanticIntent: parsed.intent,
      tool: mapSemanticIntentToTool(parsed.intent),
      strategy: 'semantic_agent',
      confidence: parsed.confidence,
      target: parsed.target,
      simpleFsTask: null,
    };
  }

  return {
    taskType: regexTaskType,
    semanticIntent: parsed.intent !== 'unknown' ? parsed.intent : 'general',
    tool: inferAgentTool(trimmed),
    strategy: 'autonomous',
    confidence: Math.max(parsed.confidence, 0.4),
    target: parsed.target,
    simpleFsTask: null,
  };
}

/** Result of an LLM-based intent classification fallback. */
export interface LlmIntentResult {
  intent: string;
  confidence: number;
}

export interface SmartRouteDeps {
  /** Embedder for the semantic similarity tier (skipped if absent). */
  embedder?: EmbedderLike;
  /** LLM classifier for the final fallback tier (skipped if absent). */
  classifyByLlm?: (description: string) => Promise<LlmIntentResult | null>;
  /** Confidence at/above which the regex tier is trusted outright (default 0.7). */
  highConfidence?: number;
  /**
   * Minimum embedding similarity to accept the semantic tier (default 0.45).
   * Tuned against `nomic-embed-text`, whose cosine scores for related phrasings
   * sit in the ~0.45–0.7 range; on a labeled set 0.45 maximized accuracy
   * (87.5%) with no fallthroughs while 0.6 left many real matches unrouted.
   */
  embeddingThreshold?: number;
  /**
   * Minimum gap between the top-2 embedding intents to accept the embedding
   * pick outright (default 0.08). When the margin is smaller the decision is
   * "ambiguous" and we defer to the LLM tier (if available) rather than commit
   * to a low-confidence guess. This targets the LLM at exactly the cases
   * embeddings get wrong, instead of every fallthrough.
   *
   * Measured on a labeled set (nomic-embed-text + qwen2.5:7b LLM tier), accuracy
   * vs. share of requests sent to the LLM:
   *   margin 0.04 -> 91.1% (~26% to LLM)
   *   margin 0.06 -> 92.9% (~30% to LLM)
   *   margin 0.08 -> 94.6% (~43% to LLM)   <- default: best accuracy/cost balance
   *   margin 0.10 -> 98.2% (~59% to LLM)   <- max accuracy, LLM-heavy
   * (Embedding-only, no LLM tier, is 87.5%.)
   */
  marginThreshold?: number;
  /** Minimum LLM confidence to accept the LLM tier (default 0.5). */
  llmThreshold?: number;
}

/** Build a route from a resolved semantic intent (embedding/LLM tiers). */
function buildRouteFromIntent(
  description: string,
  explicitType: string | undefined,
  intent: string,
  confidence: number
): CommandRoute {
  let taskType: AgentTaskType;
  let tool: string;

  switch (intent) {
    case 'generate_tests':
      taskType = 'test';
      tool = 'test';
      break;
    case 'fix_code':
      taskType = 'fix';
      tool = 'code';
      break;
    case 'refactor':
      taskType = 'refactor';
      tool = 'code';
      break;
    case 'review':
    case 'analyze':
      taskType = 'analyze';
      tool = 'code';
      break;
    case 'implement_feature':
    default:
      taskType = 'implement';
      tool = 'code';
      break;
  }

  // Honor an explicit non-default task type (e.g. slash /test, /review).
  if (explicitType && explicitType !== 'implement') {
    taskType = inferTaskType(description, explicitType);
  }

  return {
    taskType,
    semanticIntent: intent,
    tool,
    strategy: 'semantic_agent',
    confidence,
    target: description.trim(),
    simpleFsTask: null,
  };
}

/**
 * Three-tier command router that is robust to phrasing variation.
 *
 *   1. Regex/keyword fast path (synchronous `routeCommand`) — trusted for
 *      filesystem tasks and high-confidence matches.
 *   2. Embedding similarity against curated exemplars — handles paraphrases the
 *      regex tier misses (skipped when embeddings are on the hash fallback).
 *   3. LLM classification — last-resort fallback for genuinely ambiguous input.
 *
 * Tiers 2 and 3 only run for low-confidence results, so the common case stays
 * fast and free of extra model calls.
 */
export async function routeCommandSmart(
  description: string,
  explicitType?: string,
  deps: SmartRouteDeps = {}
): Promise<CommandRoute> {
  const base = routeCommand(description, explicitType);

  const high = deps.highConfidence ?? 0.7;
  if (base.strategy === 'fast_fs' || base.confidence >= high) {
    return base;
  }

  const embThreshold = deps.embeddingThreshold ?? 0.45;
  const marginThreshold = deps.marginThreshold ?? 0.08;

  // Tier 2: embedding similarity. Compute the top pick plus its margin.
  let emb = null;
  if (deps.embedder) {
    try {
      emb = await classifyIntentByEmbedding(description, deps.embedder, { minConfidence: 0 });
    } catch {
      emb = null;
    }
  }

  // Accept the embedding pick outright only when it's both above the score
  // threshold AND unambiguous (clear gap to the runner-up).
  const embAboveThreshold = emb !== null && emb.confidence >= embThreshold;
  if (emb && embAboveThreshold && emb.margin >= marginThreshold) {
    return buildRouteFromIntent(description, explicitType, emb.intent, emb.confidence);
  }

  // Tier 3: LLM classification for ambiguous or below-threshold cases.
  if (deps.classifyByLlm) {
    try {
      const llmThreshold = deps.llmThreshold ?? 0.5;
      const llm = await deps.classifyByLlm(description);
      if (llm && llm.intent && llm.intent !== 'unknown' && llm.confidence >= llmThreshold) {
        return buildRouteFromIntent(description, explicitType, llm.intent, llm.confidence);
      }
    } catch {
      // Fall through below.
    }
  }

  // LLM unavailable/inconclusive: fall back to the embedding pick if it at
  // least cleared the score threshold (better than the generic base route).
  if (emb && embAboveThreshold) {
    return buildRouteFromIntent(description, explicitType, emb.intent, emb.confidence);
  }

  return base;
}

const ACTION_VERBS = [
  'create', 'make', 'build', 'implement', 'add', 'fix', 'debug', 'refactor',
  'generate', 'write', 'delete', 'remove', 'rename', 'move', 'run', 'test',
  'update', 'modify', 'change', 'setup', 'install', 'convert', 'migrate', 'optimize',
];

const CODE_TARGET_NOUNS = [
  'file', 'folder', 'directory', 'component', 'function', 'class', 'method',
  'api', 'endpoint', 'test', 'bug', 'error', 'project', 'code', 'module',
  'service', 'page', 'route', 'script', 'variable', 'interface', 'config',
];

const FILE_PATH_RE = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|css|html|yml|yaml|sql)\b/i;

/**
 * Whether a message is a chat/Q&A request rather than an actionable agent task.
 *
 * A message is conversational when:
 *  - it is trivial or a greeting;
 *  - it leads with a question word and contains no code action; or
 *  - it carries no actionable code signal at all — no action verb, no file
 *    path, and no code-target noun (e.g. "suggest me the best AI agent papers",
 *    "recommend a vector database"). These must be answered, not planned as a
 *    workflow that has nothing to build.
 */
export function isChatOnlyQuestion(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (lower.length < 4) return true;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/.test(lower)) return true;

  const questionLead =
    /^(what|why|how|when|who|where|explain|describe|tell me about|can you explain)\b/.test(lower);
  const hasAction = ACTION_VERBS.some((verb) => hasWord(lower, verb));

  if (questionLead && !hasAction) return true;

  const hasFilePath = FILE_PATH_RE.test(lower);
  const hasCodeTarget = CODE_TARGET_NOUNS.some((noun) => hasWord(lower, noun));
  if (!hasAction && !hasFilePath && !hasCodeTarget) return true;

  return false;
}
