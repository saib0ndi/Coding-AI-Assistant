/**
 * LLM-based multi-step planning for complex agent tasks.
 * Produces validated AutonomousStep[] plans grounded in a real project summary.
 * Falls back to null on any failure so callers can use rule-based planning.
 */
import * as fs from 'fs';
import * as path from 'path';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { Logger } from '../utils/Logger.js';
import { scanProject, renderProjectSummary } from './projectScanner.js';
import type { AutonomousStep, AutonomousPlan } from './AutonomousAgent.js';

const MAX_PLAN_STEPS = 8;
const VALID_KINDS = new Set([
  'mkdir', 'create_file', 'edit_file', 'generate_tests', 'run_tests', 'review',
]);

interface RawPlanStep {
  kind: string;
  path?: string;
  action: string;
}

interface RawPlan {
  risk?: string;
  steps: RawPlanStep[];
}

/** Heuristic: does this task need multi-step decomposition? */
export function isComplexTask(description: string): boolean {
  const text = description.trim();
  const lower = text.toLowerCase();

  // Multi-component indicators
  const componentWords =
    /\b(system|module|api|crud|app|application|service|architecture|full|complete|entire|endpoints?|pipeline|workflow|feature set)\b/;
  const conjunctions = (lower.match(/\b(and|with|then|plus|also|including)\b/g) || []).length;
  const sentences = text.split(/[.;\n]+/).filter((s) => s.trim().length > 8).length;

  let score = 0;
  if (componentWords.test(lower)) score += 2;
  if (conjunctions >= 2) score += 2;
  else if (conjunctions === 1) score += 1;
  if (sentences >= 2) score += 1;
  if (text.length > 120) score += 1;

  return score >= 2;
}

function safeRelativePath(workspace: string, candidate: string): string | null {
  if (!candidate || typeof candidate !== 'string') return null;
  const cleaned = candidate.replace(/^\.\/+/, '').trim();
  if (!cleaned || cleaned.includes('..') || path.isAbsolute(cleaned)) return null;
  const resolved = path.resolve(workspace, cleaned);
  if (!resolved.startsWith(path.resolve(workspace) + path.sep)) return null;
  return cleaned;
}

function extractJson(text: string): RawPlan | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed.steps)) return null;
    return parsed as RawPlan;
  } catch {
    return null;
  }
}

function mapRawStep(
  raw: RawPlanStep,
  index: number,
  workspace: string,
  language: string,
  previewChanges: boolean
): AutonomousStep | null {
  const kind = (raw.kind || '').toLowerCase().trim();
  if (!VALID_KINDS.has(kind)) return null;
  const actionText = (raw.action || '').trim();
  if (!actionText && kind !== 'run_tests') return null;

  const relPath = raw.path ? safeRelativePath(workspace, raw.path) : null;
  const base: Pick<AutonomousStep, 'id' | 'status' | 'attempts'> = {
    id: `step_${index + 1}`,
    status: 'pending',
    attempts: 0,
  };

  switch (kind) {
    case 'mkdir': {
      if (!relPath) return null;
      return {
        ...base,
        action: `mkdir ${relPath}`,
        tool: 'code',
        params: { description: actionText, language },
        validation: 'Directory created',
        critical: false,
        maxAttempts: 1,
      };
    }
    case 'create_file':
    case 'edit_file': {
      if (!relPath) return null;
      const fullPath = path.resolve(workspace, relPath);
      const exists = fs.existsSync(fullPath);
      const verb = kind === 'edit_file' || exists ? 'Update' : 'Implement';
      return {
        ...base,
        action: `${verb} ${relPath}: ${actionText}`,
        tool: 'code',
        params: { description: actionText, language, targetFiles: [fullPath] },
        validation: 'File content generated successfully',
        critical: true,
        maxAttempts: 2,
      };
    }
    case 'generate_tests': {
      return {
        ...base,
        action: `Generate unit tests: ${actionText}`,
        tool: 'test',
        params: {
          description: actionText,
          language,
          ...(relPath ? { targetFiles: [path.resolve(workspace, relPath)] } : {}),
        },
        validation: 'Test files generated successfully',
        critical: false,
        maxAttempts: 2,
      };
    }
    case 'run_tests': {
      if (previewChanges) return null; // nothing on disk to test yet
      return {
        ...base,
        action: 'run_tests',
        tool: 'test',
        params: { description: actionText || 'run test suite', language },
        validation: 'Tests executed without failures',
        critical: false,
        maxAttempts: 1,
      };
    }
    case 'review': {
      return {
        ...base,
        action: `Review code: ${actionText}`,
        tool: 'code',
        params: { description: actionText, language },
        validation: 'Review completed with findings',
        critical: false,
        maxAttempts: 1,
      };
    }
    default:
      return null;
  }
}

/**
 * Ask the LLM for a structured multi-step plan grounded in the project layout.
 * Returns null when planning fails or produces nothing usable.
 */
export async function generateLlmPlan(
  description: string,
  context: { workspacePath?: string; language?: string; previewChanges?: boolean; priorLessons?: string },
  ollamaProvider: OllamaProvider,
  logger?: Logger
): Promise<AutonomousPlan | null> {
  const workspace = path.resolve(context.workspacePath || process.cwd());
  const language = context.language || 'typescript';
  const previewChanges = context.previewChanges === true;
  const lessonsSection = context.priorLessons ? `\n\n${context.priorLessons}\n` : '';

  let projectText = '';
  try {
    projectText = renderProjectSummary(scanProject(workspace), 3500);
  } catch {
    projectText = '(project scan unavailable)';
  }

  // Inject project rules (AGENTS.md / .coding-ai/rules / .cursor/rules)
  const { RulesLoader } = await import('../config/RulesLoader.js');
  const rulesBlock = RulesLoader.load(workspace);
  const rulesSection = rulesBlock ? `\n\n${rulesBlock}\n` : '';

  const prompt = `You are a senior software engineer planning an autonomous coding task.${rulesSection}${lessonsSection}

Task:
${description}

Project context:
${projectText}

Break the task into concrete steps. Each step is one of:
- "mkdir": create a directory ("path" required)
- "create_file": create a new source file ("path" required, "action" describes its content)
- "edit_file": modify an existing file ("path" required, "action" describes the change)
- "generate_tests": create unit tests ("path" optional for the test file)
- "run_tests": run the test suite (at most once, last)
- "review": review code (rarely needed)

Output contract:
- Return ONLY valid JSON, no markdown fences, no prose.
- Schema: {"risk":"low|medium|high","steps":[{"kind":"create_file","path":"relative/path.ts","action":"what to do"}]}
- Use 1 to ${MAX_PLAN_STEPS} steps. Use a SINGLE step for a genuinely atomic task
  (one file, one change); add more steps only when the work truly spans multiple
  files or phases. Prefer fewer, larger steps over many tiny ones.
- All paths must be relative to the project root and consistent with the existing layout.
- Each "action" must be specific and self-contained (the executor sees only that step).
- Language: ${language}.`;

  let response: string;
  try {
    response = await ollamaProvider.generateText({
      prompt,
      model: ollamaProvider.getModel(undefined, 'code'),
    });
  } catch (error) {
    logger?.warn(`LLM planning failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }

  const raw = extractJson(response);
  if (!raw) {
    logger?.warn('LLM planning produced unparseable output; using rule-based plan');
    return null;
  }

  const steps: AutonomousStep[] = [];
  for (const [index, rawStep] of raw.steps.slice(0, MAX_PLAN_STEPS).entries()) {
    const step = mapRawStep(rawStep, index, workspace, language, previewChanges);
    if (step) steps.push(step);
  }

  // A plan that cannot produce at least one concrete file change is useless.
  // Single-step plans are accepted (atomic tasks) as long as they do real work;
  // review-only / run_tests-only plans have no concrete work and are rejected so
  // the caller can fall back to a rule-based plan.
  const hasConcreteWork = steps.some((s) => s.params?.targetFiles || s.action.startsWith('mkdir '));
  if (steps.length < 1 || !hasConcreteWork) {
    logger?.warn(`LLM plan rejected (${steps.length} usable steps); using rule-based plan`);
    return null;
  }

  const risk = raw.risk === 'high' || raw.risk === 'medium' ? raw.risk : 'low';
  return {
    steps,
    riskLevel: risk,
    estimatedTime: steps.length * 8,
    dependencies: [],
  };
}
