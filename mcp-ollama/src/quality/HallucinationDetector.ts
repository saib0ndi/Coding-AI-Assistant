import * as fs from 'fs';
import * as path from 'path';
import { HallucinationMetrics } from './HallucinationMetrics.js';

export type HallucinationSeverity = 'low' | 'medium' | 'high';

export interface HallucinationFlag {
  type: string;
  severity: HallucinationSeverity;
  message: string;
}

export interface HallucinationReport {
  /** 0–1 likelihood the output is hallucinated (higher = worse). */
  hallucinationRate: number;
  /** 0–1 likelihood the output is grounded in workspace/task context. */
  groundedScore: number;
  flags: HallucinationFlag[];
  samplesAnalyzed: number;
  measuredAt: string;
}

export interface HallucinationAnalyzeContext {
  workspacePath?: string;
  taskDescription?: string;
  files?: string[];
  /** Paths of generated/output files (e.g. test files) for resolving relative imports. */
  outputFilePaths?: string[];
  taskId?: string;
  taskType?: string;
}

/** Context for measureAgentPayload (includes task metadata for metrics). */
export type HallucinationMeasureContext = HallucinationAnalyzeContext;

export interface HallucinationSummary {
  hallucinationRate: number;
  groundedScore: number;
  flagCount: number;
  flags: Array<{ type: string; severity: string; message: string }>;
  samplesAnalyzed: number;
  measuredAt: string;
}

export function collectAgentOutputTexts(payload: {
  proposedChanges?: Array<{ modified?: string; original?: string }>;
  steps?: Array<{ result?: any }>;
}): string[] {
  const texts: string[] = [];

  for (const change of payload.proposedChanges || []) {
    if (change.modified) texts.push(change.modified);
    if (change.original) texts.push(change.original);
  }

  for (const step of payload.steps || []) {
    const r = step.result;
    if (!r) continue;
    if (typeof r.code === 'string') texts.push(r.code);
    if (typeof r.description === 'string') texts.push(r.description);
    if (typeof r.testOutput === 'string') texts.push(r.testOutput);
    for (const pc of r.proposedChanges || []) {
      if (pc?.modified) texts.push(pc.modified);
    }
  }

  return texts;
}

export function measureAgentPayload(
  payload: {
    proposedChanges?: Array<{ modified?: string; original?: string }>;
    steps?: Array<{ result?: any }>;
  },
  context: HallucinationMeasureContext,
  record = true
): HallucinationSummary {
  const detector = new HallucinationDetector();
  const report = detector.analyzeOutputs(collectAgentOutputTexts(payload), context);

  if (record) {
    const meta: { taskType: string; taskId?: string } = { taskType: context.taskType || 'unknown' };
    if (context.taskId) meta.taskId = context.taskId;
    HallucinationMetrics.getInstance().record(report, meta);
  }

  return reportToSummary(report);
}

export function reportToSummary(report: HallucinationReport): HallucinationSummary {
  return {
    hallucinationRate: report.hallucinationRate,
    groundedScore: report.groundedScore,
    flagCount: report.flags.length,
    flags: report.flags.slice(0, 10).map((f) => ({
      type: f.type,
      severity: f.severity,
      message: f.message,
    })),
    samplesAnalyzed: report.samplesAnalyzed,
    measuredAt: report.measuredAt,
  };
}

const STUB_PATTERNS: Array<{ type: string; severity: HallucinationSeverity; pattern: RegExp }> = [
  { type: 'stub_implementation', severity: 'high', pattern: /implementation\s+needed/i },
  { type: 'stub_template', severity: 'high', pattern: /generated\s+test\s+template/i },
  { type: 'placeholder_todo', severity: 'medium', pattern: /\/\/\s*TODO:\s*Implement/i },
  { type: 'placeholder_ellipsis', severity: 'medium', pattern: /\/\/\s*\.\.\./ },
  { type: 'fake_success_claim', severity: 'high', pattern: /\/generated\.\w+/i },
  { type: 'markdown_fence', severity: 'low', pattern: /^```[a-z]*\s*$/m },
  { type: 'lorem_ipsum', severity: 'high', pattern: /lorem\s+ipsum/i },
];

/**
 * Heuristic hallucination detector for generated code and agent summaries.
 * Flags ungrounded file references, unknown symbols (when index exists), and stub output.
 */
export class HallucinationDetector {
  analyzeOutputs(texts: string[], context: HallucinationAnalyzeContext = {}): HallucinationReport {
    const nonEmpty = texts.map((t) => t?.trim()).filter((t): t is string => Boolean(t && t.length > 0));

    if (nonEmpty.length === 0) {
      return {
        hallucinationRate: 0,
        groundedScore: 1,
        flags: [],
        samplesAnalyzed: 0,
        measuredAt: new Date().toISOString(),
      };
    }

    const flags: HallucinationFlag[] = [];
    const workspace = path.resolve(context.workspacePath || process.cwd());

    const importBases = this.resolveImportBases(
      workspace,
      context.outputFilePaths,
      context.files
    );

    for (const text of nonEmpty) {
      flags.push(...this.checkStubPatterns(text));
      flags.push(...this.checkRelativeImports(text, importBases));
      flags.push(...this.checkMentionedPaths(text, workspace));
    }

    if (context.files?.length) {
      flags.push(...this.checkTaskFileGrounding(nonEmpty.join('\n'), context.files, workspace));
    }

    const deduped = this.deduplicateFlags(flags);
    const hallucinationRate = this.flagsToRate(deduped);

    return {
      hallucinationRate,
      groundedScore: Math.max(0, 1 - hallucinationRate),
      flags: deduped,
      samplesAnalyzed: nonEmpty.length,
      measuredAt: new Date().toISOString(),
    };
  }

  private checkStubPatterns(text: string): HallucinationFlag[] {
    const flags: HallucinationFlag[] = [];
    for (const { type, severity, pattern } of STUB_PATTERNS) {
      if (pattern.test(text)) {
        flags.push({ type, severity, message: `Matched stub/placeholder pattern: ${type}` });
      }
    }
    return flags;
  }

  private resolveImportBases(
    workspace: string,
    outputFilePaths?: string[],
    taskFiles?: string[]
  ): string[] {
    const bases = new Set<string>([workspace]);
    const addFile = (filePath: string) => {
      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(workspace, filePath);
      bases.add(path.dirname(resolved));
    };
    for (const fp of outputFilePaths || []) addFile(fp);
    for (const fp of taskFiles || []) addFile(fp);
    return [...bases];
  }

  private importTargetExists(rel: string, baseDir: string): boolean {
    const candidates = [
      path.resolve(baseDir, rel),
      path.resolve(baseDir, `${rel}.ts`),
      path.resolve(baseDir, `${rel}.js`),
      path.resolve(baseDir, `${rel}.tsx`),
      path.resolve(baseDir, `${rel}.jsx`),
    ];
    return candidates.some((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
  }

  private checkRelativeImports(text: string, baseDirs: string[]): HallucinationFlag[] {
    const flags: HallucinationFlag[] = [];
    const importPattern = /from\s+['"](\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importPattern.exec(text)) !== null) {
      const rel = match[1];
      const exists = baseDirs.some((base) => this.importTargetExists(rel, base));
      if (!exists) {
        flags.push({
          type: 'missing_import_target',
          severity: 'high',
          message: `Import target not found: ${rel}`,
        });
      }
    }

    return flags;
  }

  private checkMentionedPaths(text: string, workspace: string): HallucinationFlag[] {
    const flags: HallucinationFlag[] = [];
    const pathPattern = /(?:^|\s|['"`])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java))(?:['"`\s]|$)/g;
    let match: RegExpExecArray | null;
    const checked = new Set<string>();

    while ((match = pathPattern.exec(text)) !== null) {
      const rel = match[1].replace(/^\.\/+/, '');
      if (checked.has(rel)) continue;
      checked.add(rel);

      const resolved = path.resolve(workspace, rel);
      if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
        continue;
      }
      if (!fs.existsSync(resolved)) {
        flags.push({
          type: 'missing_file_reference',
          severity: 'medium',
          message: `Referenced file does not exist: ${rel}`,
        });
      }
    }

    return flags;
  }

  private checkTaskFileGrounding(
    text: string,
    taskFiles: string[],
    workspace: string
  ): HallucinationFlag[] {
    const flags: HallucinationFlag[] = [];
    const basenames = taskFiles.map((f) => path.basename(f).toLowerCase());
    const mentionsAny = basenames.some((base) => text.toLowerCase().includes(base.replace(/\.[^.]+$/, '')));

    if (!mentionsAny && taskFiles.length === 1) {
      flags.push({
        type: 'task_file_not_reflected',
        severity: 'low',
        message: `Output may not reference target file: ${path.basename(taskFiles[0])}`,
      });
    }

    return flags;
  }

  private deduplicateFlags(flags: HallucinationFlag[]): HallucinationFlag[] {
    const seen = new Set<string>();
    return flags.filter((f) => {
      const key = `${f.type}:${f.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private flagsToRate(flags: HallucinationFlag[]): number {
    if (flags.length === 0) return 0;

    const weights: Record<HallucinationSeverity, number> = {
      high: 0.35,
      medium: 0.2,
      low: 0.08,
    };

    const sum = flags.reduce((acc, f) => acc + weights[f.severity], 0);
    return Math.min(1, Math.round(sum * 100) / 100);
  }
}
