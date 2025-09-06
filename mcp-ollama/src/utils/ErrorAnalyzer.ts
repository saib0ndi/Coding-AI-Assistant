import { 
  ErrorAnalysis, 
  ErrorFixRequest, 
  ErrorType, 
  Diagnostic, 
  ErrorPattern,
  PatternAnalysisResult,
  ErrorHistoryItem
} from '../types/index.js';

type CheckType = 'all' | 'syntax' | 'semantic' | 'style' | 'security' | 'performance';
type Severity = 'error' | 'warning' | 'info' | 'hint';

export class ErrorAnalyzer {
  private errorPatterns: Map<string, ErrorPattern[]> = new Map();
  private diagnosticRules: Map<string, { pattern: RegExp; severity: Severity; message: string }[]> = new Map();
  private errorHistory: Map<string, number> = new Map();
  private fixSuccessRate: Map<string, { attempts: number; successes: number }> = new Map();
  // keep shape but avoid `any` where possible
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mlModel: { predict: (features: { errorType: string; language: string; codeComplexity: number }) => number } | null = null;

  constructor() {
    this.initializeErrorPatterns();
    this.initializeDiagnosticRules();
    this.initializeMLModel();
  }

  /* ------------------------------ Public API ------------------------------ */

  async analyzeError(request: ErrorFixRequest): Promise<ErrorAnalysis> {
    const analysis: ErrorAnalysis = {
      type: 'unknown' as ErrorType,
      category: 'unknown',
      severity: 'error',
      cause: '',
      affectedComponents: [],
      suggestedApproach: '',
      complexity: 'medium',
      confidence: 0.5,
    };

    try {
      const lang = this.normalizeLanguage(request.language);

      // 1) Pattern match
      const patternMatch = this.matchErrorPattern(request.errorMessage, lang);
      if (patternMatch) {
        analysis.type = patternMatch.type;
        analysis.category = patternMatch.category;
        analysis.cause = patternMatch.commonCauses[0] ?? 'Unknown cause';
        analysis.suggestedApproach = patternMatch.solutions[0] ?? 'No specific approach suggested';
        analysis.confidence = Math.max(analysis.confidence, patternMatch.confidence ?? 0.7);
      }

      // 2) Stack trace analysis
      if (request.stackTrace) {
        const stackAnalysis = this.analyzeStackTrace(request.stackTrace, lang);
        if (stackAnalysis.rootCause) analysis.cause = stackAnalysis.rootCause;
      }

      // 3) Code context analysis
      const codeAnalysis = this.analyzeCodeContext(request.code, lang, request.errorMessage);
      analysis.confidence = Math.max(analysis.confidence, codeAnalysis.confidence);

      // 4) Language-specific pass
      const langAnalysis = this.performLanguageSpecificAnalysis(request);
      if (langAnalysis) {
        analysis.type = (langAnalysis.type ?? analysis.type) as ErrorType;
        analysis.category = langAnalysis.category ?? analysis.category;
        if (langAnalysis.suggestions?.length) {
          analysis.suggestedApproach = langAnalysis.suggestions[0];
        }
      }

      // 5) Mark affected component
      if (request.filePath) analysis.affectedComponents = [request.filePath];

      // 6) Complexity heuristic
      analysis.complexity = this.determineComplexity(request, analysis);

    } catch (err) {
      this.safeLog('warn', 'Error during error analysis', err);
      analysis.cause = `Analysis failed: ${this.oneLine((err as Error)?.message ?? String(err))}`;
    }

    return analysis;
  }

  async performDiagnostics(code: string, language: string, checkTypes: string[]): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const lang = this.normalizeLanguage(language);
    const lines = this.toLines(code); // compute once for all checks

    try {
      const run = async (ct: CheckType) => {
        switch (ct) {
          case 'syntax':       diagnostics.push(...await this.performSyntaxCheck(lines, lang)); break;
          case 'semantic':     diagnostics.push(...await this.performSemanticCheck(code, lines, lang)); break;
          case 'style':        diagnostics.push(...await this.performStyleCheck(lines, lang)); break;
          case 'security':     diagnostics.push(...await this.performSecurityCheck(lines, lang)); break;
          case 'performance':  diagnostics.push(...await this.performPerformanceCheck(lines, lang)); break;
          case 'all':
            diagnostics.push(
              ...await this.performSyntaxCheck(lines, lang),
              ...await this.performSemanticCheck(code, lines, lang),
              ...await this.performStyleCheck(lines, lang),
              ...await this.performSecurityCheck(lines, lang),
              ...await this.performPerformanceCheck(lines, lang),
            );
            break;
        }
      };

      // de-duplicate if 'all' is present
      const hasAll = checkTypes.includes('all');
      if (hasAll) {
        await run('all');
      } else {
        const uniqueTypes = [...new Set(checkTypes)] as CheckType[];
        for (const ct of uniqueTypes) await run(ct);
      }

    } catch (err) {
      this.safeLog('error', 'Error during diagnostics', err);
    }

    // Sort by severity
    return diagnostics.sort((a, b) => this.getSeverityWeight(b.severity) - this.getSeverityWeight(a.severity));
  }

  async analyzeErrorPatterns(
    errorHistory: ErrorHistoryItem[],
    analysisDepth: string
  ): Promise<PatternAnalysisResult> {
    const patterns = this.extractPatterns(errorHistory);
    const statistics = this.calculateStatistics(errorHistory);
    const trends = this.analyzeTrends(errorHistory);
    const recommendations = this.generateRecommendations(patterns, statistics, analysisDepth);

    return {
      commonPatterns: patterns,
      statistics,
      trends,
      preventiveRecommendations: recommendations,
    };
  }

  recordFixAttempt(errorType: string, success: boolean): void {
    const key = errorType || 'unknown';
    const current = this.fixSuccessRate.get(key) || { attempts: 0, successes: 0 };
    current.attempts += 1;
    if (success) current.successes += 1;
    this.fixSuccessRate.set(key, current);
  }

  getFixSuccessRate(errorType: string): number {
    const stats = this.fixSuccessRate.get(errorType || 'unknown');
    return stats ? stats.successes / Math.max(1, stats.attempts) : 0;
  }

  /* ------------------------------ Private ------------------------------ */

  private oneLine(s: unknown): string {
    return String(s ?? '').replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  private safeLog(level: 'info'|'warn'|'error', msg: string, err?: unknown) {
    const line = `[ErrorAnalyzer] ${msg}${err ? `: ${this.oneLine((err as Error)?.message ?? String(err))}` : ''}`;
    if (level === 'info')  console.log(line);
    if (level === 'warn')  console.warn(line);
    if (level === 'error') console.error(line);
  }

  private normalizeLanguage(language: string): string {
    const lang = (language || '').toLowerCase();
    if (lang === 'typescript' || lang === 'ts') return 'javascript';
    if (lang === 'py') return 'python';
    return lang;
  }

  private toLines(code: string): string[] {
    // normalize line endings, avoid trailing empty sentinel
    return (code ?? '').replace(/\r\n/g, '\n').split('\n');
  }

  /* ---------------------- Initialization data ---------------------- */

  private initializeErrorPatterns(): void {
    // JavaScript/TypeScript patterns
    this.errorPatterns.set('javascript', [
      {
        pattern: /Cannot find module ['"`]([^'"`]+)['"`]/,
        type: 'import_error' as ErrorType,
        category: 'module_resolution',
        confidence: 0.9,
        commonCauses: ['Missing dependency', 'Wrong import path', 'Module not installed'],
        solutions: [
          'Install the missing package using npm or yarn',
          'Check the import path spelling and case sensitivity',
          'Verify the module exists in node_modules',
          'Update package.json dependencies',
        ],
      },
      {
        pattern: /TypeError: Cannot read propert(?:y|ies) ['"`]([^'"`]+)['"`] of (undefined|null)/,
        type: 'null_reference' as ErrorType,
        category: 'runtime_error',
        confidence: 0.95,
        commonCauses: ['Undefined object', 'Null reference', 'Async timing issue'],
        solutions: [
          'Add null/undefined checks before property access',
          'Use optional chaining (?.) operator',
          'Initialize the object with default values',
          'Check async/await timing',
        ],
      },
      {
        pattern: /ReferenceError: (\w+) is not defined/,
        type: 'undefined_variable' as ErrorType,
        category: 'scope_error',
        confidence: 0.9,
        commonCauses: ['Variable not declared', 'Scope issue', 'Typo in variable name'],
        solutions: [
          'Declare the variable before use',
          'Check variable name spelling',
          'Import the required function/variable',
          'Check variable scope and hoisting',
        ],
      },
    ]);

    // Python patterns
    this.errorPatterns.set('python', [
      {
        pattern: /NameError: name ['"`]([^'"`]+)['"`] is not defined/,
        type: 'undefined_variable' as ErrorType,
        category: 'scope_error',
        confidence: 0.9,
        commonCauses: ['Variable not defined', 'Import missing', 'Typo in name'],
        solutions: [
          'Define the variable before using it',
          'Import the required module or function',
          'Check for typos in the variable name',
          'Ensure proper indentation and scope',
        ],
      },
      {
        pattern: /IndentationError: expected an indented block/,
        type: 'syntax_error' as ErrorType,
        category: 'indentation',
        confidence: 0.95,
        commonCauses: ['Missing indentation', 'Inconsistent indentation', 'Empty code block'],
        solutions: [
          'Add proper indentation (4 spaces recommended)',
          'Use consistent indentation throughout',
          'Add pass statement for empty blocks',
          'Check for missing colons in control statements',
        ],
      },
      {
        pattern: /ModuleNotFoundError: No module named ['"`]([^'"`]+)['"`]/,
        type: 'import_error' as ErrorType,
        category: 'module_resolution',
        confidence: 0.95,
        commonCauses: ['Module not installed', 'Wrong module name', 'Virtual environment issue'],
        solutions: [
          'Install the module using pip',
          'Check the module name spelling',
          'Activate the correct virtual environment',
          'Check PYTHONPATH environment variable',
        ],
      },
    ]);

    // Java patterns
    this.errorPatterns.set('java', [
      {
        pattern: /cannot find symbol/,
        type: 'undefined_variable' as ErrorType,
        category: 'compilation_error',
        confidence: 0.8,
        commonCauses: ['Variable not declared', 'Wrong variable name', 'Missing import'],
        solutions: [
          'Declare the variable with proper type',
          'Check variable name spelling',
          'Add required import statement',
          'Check class and package structure',
        ],
      },
      {
        pattern: /NullPointerException/,
        type: 'null_reference' as ErrorType,
        category: 'runtime_error',
        confidence: 0.9,
        commonCauses: ['Null object access', 'Uninitialized variable', 'Failed object creation'],
        solutions: [
          'Add null checks before object access',
          'Initialize objects properly',
          'Use Optional<T> for nullable values',
          'Handle object creation failures',
        ],
      },
    ]);
  }

  private initializeDiagnosticRules(): void {
    this.diagnosticRules.set('javascript', [
      {
        pattern: /console\.log\(/g,
        severity: 'warning',
        message: 'Console.log statement found - consider removing for production',
      },
    ]);
  }

  /* ------------------------ Analysis primitives ------------------------ */

  private matchErrorPattern(errorMessage: string, language: string): ErrorPattern | null {
    const patterns = this.errorPatterns.get(language) || [];
    for (const p of patterns) {
      p.pattern.lastIndex = 0; // safety if any pattern is global
      if (p.pattern.test(errorMessage)) return p;
    }
    return null;
  }

  private analyzeStackTrace(stackTrace: string, _language: string): { rootCause?: string } {
    const lines = this.toLines(stackTrace);
    const firstLine = lines[0]?.trim();
    return { rootCause: firstLine || 'Unknown stack trace error' };
  }

  private analyzeCodeContext(_code: string, _language: string, _errorMessage: string): { confidence: number } {
    // placeholder for richer heuristics; keep same signature
    return { confidence: 0.7 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private performLanguageSpecificAnalysis(_request: ErrorFixRequest): { type?: ErrorType; category?: string; suggestions: string[] } | null {
    return { suggestions: ['General language-specific suggestion'] };
  }

  private determineComplexity(_request: ErrorFixRequest, _analysis: ErrorAnalysis): 'low' | 'medium' | 'high' {
    return 'medium';
  }

  /* ----------------------------- Checks ----------------------------- */

  private async performSyntaxCheck(lines: string[], language: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];

    if (language === 'javascript') {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('var ') && !line.includes('//')) {
          out.push({
            severity: 'warning',
            message: 'Use let or const instead of var',
            line: i + 1,
            column: Math.max(0, line.indexOf('var')),
            type: 'syntax',
            source: 'mcp-ollama',
          });
        }

        // fix: correct column for == null or != null (loose equality only)
        const nullLooseEq = line.match(/([=!]=)(?!=)\s*null/);
        if (nullLooseEq) {
          const op = nullLooseEq[1];
          out.push({
            severity: 'info',
            message: 'Consider using === or !== for strict equality',
            line: i + 1,
            column: Math.max(0, line.indexOf(op)),
            type: 'syntax',
            source: 'mcp-ollama',
          });
        }
      }
    }

    return out;
  }

  private async performSemanticCheck(code: string, lines: string[], language: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];
    if (language === 'javascript') {
      const unused = this.findUnusedVariables(code, lines);
      for (const v of unused) {
        out.push({
          severity: 'warning',
          message: `Unused variable: ${v.name}`,
          line: v.line,
          column: v.column,
          type: 'semantic',
          source: 'mcp-ollama',
        });
      }
    }
    return out;
  }

  private async performStyleCheck(lines: string[], _language: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.length > 120) {
        out.push({
          severity: 'info',
          message: 'Line too long (>120 characters)',
          line: i + 1,
          column: 121,
          type: 'style',
          source: 'mcp-ollama',
        });
      }

      if (line.includes('console.log') && !line.includes('//')) {
        out.push({
          severity: 'warning',
          message: 'Remove console.log for production',
          line: i + 1,
          column: Math.max(0, line.indexOf('console.log')),
          type: 'style',
          source: 'mcp-ollama',
        });
      }
    }

    return out;
  }

  private async performSecurityCheck(lines: string[], _language: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('eval(') || line.includes('Function(')) {
        out.push({
          severity: 'error',
          message: 'Avoid eval()/Function() - security risk',
          line: i + 1,
          column: Math.max(0, Math.min(
            ...[line.indexOf('eval('), line.indexOf('Function(')].filter(n => n >= 0)
          )),
          type: 'security',
          source: 'mcp-ollama',
        });
      }

      if (/\binnerHTML\b/.test(line) && /\+|`/.test(line)) {
        out.push({
          severity: 'warning',
          message: 'Potential XSS risk with innerHTML string concatenation; prefer textContent or sanitize',
          line: i + 1,
          column: Math.max(0, line.indexOf('innerHTML')),
          type: 'security',
          source: 'mcp-ollama',
        });
      }
    }

    return out;
  }

  private async performPerformanceCheck(lines: string[], _language: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // More specific regex to target array length in loop conditions only
      if (/for\s*\([^;]*;\s*[^;]*\.length\s*[;<]/.test(line)) {
        out.push({
          severity: 'info',
          message: 'Cache array length in loop for better performance',
          line: i + 1,
          column: Math.max(0, line.indexOf('for')),
          type: 'performance',
          source: 'mcp-ollama',
        });
      }
    }

    return out;
  }

  /* --------------------------- Helpers --------------------------- */

  private getSeverityWeight(severity: string): number {
    const weights: Record<Severity, number> = { error: 4, warning: 3, info: 2, hint: 1 };
    return (weights as Record<string, number>)[severity] ?? 0;
  }

  private extractPatterns(errorHistory: ErrorHistoryItem[]): Array<{ type: string; count: number }> {
    const map = new Map<string, number>();
    for (const e of errorHistory ?? []) {
      const t = (e?.type ?? 'unknown') as string;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return [...map.entries()].map(([type, count]) => ({ type, count }));
  }

  private calculateStatistics(errorHistory: ErrorHistoryItem[]): { total: number; byType: Array<{ type: string; count: number }>; averagePerDay: number } {
    const total = (errorHistory ?? []).length;
    const timeSpanDays = this.calculateTimeSpanDays(errorHistory);
    return {
      total,
      byType: this.extractPatterns(errorHistory),
      averagePerDay: timeSpanDays > 0 ? total / timeSpanDays : 0,
    };
  }

  private calculateTimeSpanDays(errorHistory: ErrorHistoryItem[]): number {
    if (!errorHistory?.length) return 30; // default fallback
    const timestamps = errorHistory.map(e => e.timestamp).filter(Boolean).sort();
    if (timestamps.length < 2) return 1;
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
    return Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));
  }

  private analyzeTrends(_errorHistory: ErrorHistoryItem[]): Array<{ trend: string; description: string }> {
    return [{ trend: 'stable', description: 'Error rate remains consistent' }];
  }

  private generateRecommendations(patterns: Array<{ type: string; count: number }>, _statistics: any, _analysisDepth: string): string[] {
    const rec: string[] = ['Implement proper error handling'];
    if (patterns?.length > 0) {
      const top = patterns.reduce((max, p) => (p.count > max.count ? p : max));
      rec.push(`Focus on resolving ${top.type} errors`);
    }
    return rec;
  }

  private initializeMLModel(): void {
    this.mlModel = {
      predict: (errorFeatures: { errorType: string; language: string; codeComplexity: number }) => {
        const { errorType, language, codeComplexity } = errorFeatures;
        const key = `${errorType}_${language}`;
        const baseScore = this.errorHistory.get(key) || 0;
        // simple bounded heuristic
        return Math.min(0.95, baseScore * 0.1 + codeComplexity * 0.3);
      },
    };
  }

  private findUnusedVariables(
    code: string,
    lines: string[]
  ): Array<{ name: string; line: number; column: number }> {
    const results: Array<{ name: string; line: number; column: number }> = [];
    const declRe = /\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      declRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = declRe.exec(line))) {
        const varName = m[1];
        // search usage with word boundaries outside of the declaration position
        const usageRe = new RegExp(`\\b${varName}\\b`, 'g');
        let used = false;

        // scan all code once; if we want faster, we can scan only lines after declaration.
        let um: RegExpExecArray | null;
        while ((um = usageRe.exec(code))) {
          const pos = um.index;
          // ignore the exact declaration token occurrence (best effort)
          const declPos = code.indexOf(varName, code.indexOf(line));
          if (pos !== declPos) { used = true; break; }
        }

        if (!used) {
          results.push({
            name: varName,
            line: i + 1,
            column: Math.max(0, line.indexOf(varName)),
          });
        }
      }
    }
    return results;
  }
}
