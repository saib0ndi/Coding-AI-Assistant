import * as path from 'path';
import { Logger } from '../utils/Logger.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { SyntaxGate } from '../verify/SyntaxGate.js';

/**
 * Structured outcome of validating a single autonomous step.
 *
 * Unlike a bare boolean, this carries *why* a step passed or failed and how
 * confident we are. The self-correction loop feeds `reasons` back into the
 * param-level correction (Tier 1) and the strategy-level re-plan (Tier 2) so
 * fixes are targeted instead of blind retries.
 */
export interface StepValidation {
    valid: boolean;
    /** 0..1 — how much to trust this verdict. Deterministic checks score highest. */
    confidence: number;
    /** Which signal produced the verdict. */
    method: 'deterministic' | 'heuristic' | 'llm';
    /** Human-readable explanations (failures and notable passes). */
    reasons: string[];
}

/** Minimal shape of a step we can validate (decoupled from AutonomousStep). */
export interface ValidatableStep {
    action: string;
    validation: string;
    tool: string;
    params?: any;
}

/** Code/text artifact produced by a step that we can deep-check. */
interface Artifact {
    path: string;
    content: string;
    /** True when the artifact already exists on disk (enables CLI checkers). */
    onDisk: boolean;
}

// Stub / placeholder markers that mean "the model didn't actually do the work".
// Kept tight on "not implemented" style phrasing to avoid flagging legitimate TODOs.
const STUB_PATTERNS: RegExp[] = [
    /implementation needed/i,
    /\byour code here\b/i,
    /\bnot implemented\b/i,
    /throw new Error\(\s*['"`]\s*not implemented/i,
    /\bTODO\b[^\n]*\bimplement/i,
    /#\s*implement (this|me)\b/i,
    /\bplaceholder (implementation|code|function)\b/i,
    /raise NotImplementedError/i,
    /\bpanic\(\s*['"`]not implemented/i,
];

// An empty body whose only content is an ellipsis, e.g. `function f() { ... }`.
const ELLIPSIS_BODY = /\{\s*\.\.\.\s*\}/;

const CHECKABLE_EXTS = new Set([
    '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py', '.go',
]);
const CLI_EXTS = new Set(['.py', '.go']);

const MAX_ARTIFACT_BYTES = 200_000;

export class StepValidator {
    constructor(
        private fileSystem: FileSystemTool,
        private ollama: OllamaProvider,
        private logger: Logger
    ) {}

    async validate(step: ValidatableStep, result: any, context?: any): Promise<StepValidation> {
        // --- Hard failures: explicit error or success=false ---
        if (!result) {
            return det(false, ['Step returned no result']);
        }
        if (result.error) {
            return det(false, [`Step reported an error: ${String(result.error).slice(0, 200)}`]);
        }
        if (result.success === false) {
            return det(false, ['Step reported success=false']);
        }

        const reasons: string[] = [];
        const previewMode = context?.previewChanges === true;

        // --- "generated.*" sentinel: scaffolding, not real work ---
        const filesModified: string[] = Array.isArray(result.filesModified) ? result.filesModified : [];
        if (filesModified.some((f) => typeof f === 'string' && /[/\\]generated\.\w+$/.test(f))) {
            return det(false, ['Wrote a placeholder "generated.*" file instead of the target file']);
        }

        // --- Preview mode must yield concrete, non-empty diffs ---
        if (previewMode) {
            const diffs = Array.isArray(result.proposedChanges) ? result.proposedChanges : [];
            const hasRealDiff = diffs.some(
                (c: any) => typeof c?.modified === 'string' && c.modified.trim() && c.modified !== c.original
            );
            if (!hasRealDiff) {
                return det(false, ['Preview requested but no concrete diff was produced']);
            }
        }

        // --- Collect artifacts we can deep-check (syntax + stubs) ---
        const artifacts = await this.collectArtifacts(result, previewMode);

        // --- Stub / placeholder detection ---
        for (const a of artifacts) {
            const stub = detectStub(a.content);
            if (stub) {
                return det(false, [`Placeholder/stub detected in ${shortPath(a.path)}: ${stub}`]);
            }
        }

        // --- Deterministic syntax validation of produced code ---
        for (const a of artifacts) {
            const ext = path.extname(a.path).toLowerCase();
            if (!CHECKABLE_EXTS.has(ext)) continue;
            // CLI checkers (py/go) read the file from disk; only trust them when the
            // artifact is actually on disk (written), not for in-memory preview diffs.
            if (CLI_EXTS.has(ext) && !a.onDisk) continue;
            try {
                const res = await SyntaxGate.validate(a.path, a.content, this.fileSystem);
                if (!res.ok) {
                    return det(false, [
                        `Syntax check failed for ${shortPath(a.path)} (${res.checker}): ${(res.output || 'invalid syntax').slice(0, 300)}`,
                    ]);
                }
                reasons.push(`${shortPath(a.path)} passed ${res.checker} syntax check`);
            } catch {
                // Checker unavailable — don't penalize.
            }
        }

        // --- Test steps: trust real test output, not just a success flag ---
        if (typeof result.testOutput === 'string' && result.testOutput.trim()) {
            const failure = detectTestFailure(result.testOutput);
            if (failure) {
                return det(false, [`Test output indicates failure: ${failure}`]);
            }
            reasons.push('Test output shows no failures');
            return { valid: true, confidence: 0.9, method: 'deterministic', reasons };
        }

        // --- Concrete code artifacts that passed the checks above are valid ---
        if (artifacts.length > 0) {
            reasons.unshift(`Produced ${artifacts.length} concrete artifact(s)`);
            return { valid: true, confidence: 0.9, method: 'deterministic', reasons };
        }

        // --- No artifacts: analysis/review-style steps may legitimately write nothing ---
        if (previewMode) {
            // Already handled the diff requirement above; reaching here means diffs existed.
            return { valid: true, confidence: 0.85, method: 'deterministic', reasons };
        }
        if (result.success === true && typeof result.description === 'string' && result.description.trim() && !result.code) {
            return {
                valid: true,
                confidence: 0.6,
                method: 'heuristic',
                reasons: ['Non-writing step completed with a description (analysis/review)'],
            };
        }
        if (result.success === true && !result.code && filesModified.length === 0) {
            return det(false, ['Claimed success but produced no code, files, or findings']);
        }

        // --- Inconclusive: fall back to a grounded LLM judgment ---
        return this.llmValidate(step, result);
    }

    /**
     * Gather code artifacts from a step result: preview diffs (in-memory) and
     * written files (re-read from disk for an independent check).
     */
    private async collectArtifacts(result: any, previewMode: boolean): Promise<Artifact[]> {
        const artifacts: Artifact[] = [];
        const seen = new Set<string>();

        if (Array.isArray(result.proposedChanges)) {
            for (const c of result.proposedChanges) {
                if (typeof c?.filePath === 'string' && typeof c?.modified === 'string' && c.modified.trim()) {
                    if (c.modified.length > MAX_ARTIFACT_BYTES) continue;
                    artifacts.push({ path: c.filePath, content: c.modified, onDisk: false });
                    seen.add(c.filePath);
                }
            }
        }

        // Re-read written files for an independent (defense-in-depth) check.
        if (!previewMode && Array.isArray(result.filesModified)) {
            for (const f of result.filesModified) {
                if (typeof f !== 'string' || seen.has(f)) continue;
                try {
                    const content = await this.fileSystem.readFile(f);
                    if (content.length <= MAX_ARTIFACT_BYTES) {
                        artifacts.push({ path: f, content, onDisk: true });
                        seen.add(f);
                    }
                } catch {
                    // Unreadable (path gating, deleted, binary) — skip rather than fail.
                }
            }
        }

        // A bare code blob with no file association: validate with a best-effort extension.
        if (artifacts.length === 0 && typeof result.code === 'string' && result.code.trim()) {
            artifacts.push({ path: 'snippet.ts', content: result.code, onDisk: false });
        }

        return artifacts;
    }

    private async llmValidate(step: ValidatableStep, result: any): Promise<StepValidation> {
        const prompt = `You are a strict validator for an autonomous coding step.

Step:
${step.action}

Expected validation:
${step.validation}

Result:
${JSON.stringify(result).substring(0, 1000)}

Rules:
- Return INVALID for errors, empty/stub code, failed tests, missing files, or vague success claims.
- Return VALID only when concrete result data satisfies the expected validation.

Output contract:
Return exactly one word: VALID or INVALID.`;

        try {
            const response = await this.ollama.generateText({
                prompt,
                model: this.ollama.getModel(undefined, 'fast'),
            });
            const lower = response.toLowerCase();
            const valid = lower.includes('valid') && !lower.includes('invalid');
            return {
                valid,
                confidence: 0.5,
                method: 'llm',
                reasons: [valid ? 'LLM judged the result VALID' : 'LLM judged the result INVALID'],
            };
        } catch {
            // On LLM failure, trust the step's own success flag as a last resort.
            return {
                valid: result.success !== false,
                confidence: 0.3,
                method: 'heuristic',
                reasons: ['Validation inconclusive; fell back to the step success flag'],
            };
        }
    }
}

function det(valid: boolean, reasons: string[]): StepValidation {
    return { valid, confidence: 0.95, method: 'deterministic', reasons };
}

function detectStub(content: string): string | null {
    for (const re of STUB_PATTERNS) {
        const m = content.match(re);
        if (m) return m[0].slice(0, 80);
    }
    if (ELLIPSIS_BODY.test(content)) return 'empty "{ ... }" body';
    return null;
}

function detectTestFailure(output: string): string | null {
    const lower = output.toLowerCase();
    // "0 failing" / "0 failed" / "0 errors" are passing signals — don't flag them.
    const failNum = lower.match(/(\d+)\s+(failing|failed|failures|errors?)/);
    if (failNum && Number(failNum[1]) > 0) return failNum[0];
    if (/\bFAILED\b/.test(output) || /\bFAIL\b/.test(output)) return 'FAIL marker present';
    if (/assertionerror|assertion failed/i.test(output)) return 'assertion failure';
    if (/\btraceback \(most recent call last\)/i.test(output)) return 'python traceback';
    return null;
}

function shortPath(p: string): string {
    const parts = p.split(/[/\\]/);
    return parts.length <= 2 ? p : `.../${parts.slice(-2).join('/')}`;
}
