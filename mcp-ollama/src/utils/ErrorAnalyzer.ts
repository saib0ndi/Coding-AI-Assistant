import { 
  ErrorAnalysis, 
  ErrorFixRequest, 
  ErrorType, 
  Diagnostic, 
  ErrorPattern,
  PatternAnalysisResult
} from '../types/index.js';

export class ErrorAnalyzer {
  private errorPatterns: Map<string, ErrorPattern[]> = new Map();
  private diagnosticRules: Map<string, any[]> = new Map();

  constructor() {
    this.initializeErrorPatterns();
    this.initializeDiagnosticRules();
  }

  async analyzeError(request: ErrorFixRequest): Promise<ErrorAnalysis> {
    const analysis: ErrorAnalysis = {
      type: 'unknown' as ErrorType,
      category: 'unknown',
      severity: 'error',
      cause: '',
      affectedComponents: [],
      suggestedApproach: '',
      complexity: 'medium',
      confidence: 0.5
    };

    try {
      // 1. Pattern matching against known error types
      const patternMatch = this.matchErrorPattern(request.errorMessage, request.language);
      if (patternMatch) {
        analysis.type = patternMatch.type;
        analysis.category = patternMatch.category;
        analysis.cause = patternMatch.commonCauses[0] || 'Unknown cause';
        analysis.suggestedApproach = patternMatch.solutions[0] || 'No specific approach suggested';
        analysis.confidence = patternMatch.confidence;
      }

      // 2. Analyze stack trace if available
      if (request.stackTrace) {
        const stackAnalysis = this.analyzeStackTrace(request.stackTrace, request.language);
        analysis.cause = stackAnalysis.rootCause || analysis.cause;
      }

      // 3. Code context analysis
      const codeAnalysis = this.analyzeCodeContext(request.code, request.language, request.errorMessage);
      analysis.confidence = Math.max(analysis.confidence, codeAnalysis.confidence);

      // 4. Language-specific analysis
      const langAnalysis = this.performLanguageSpecificAnalysis(request);
      if (langAnalysis) {
        analysis.type = langAnalysis.type || analysis.type;
        analysis.category = langAnalysis.category || analysis.category;
        analysis.suggestedApproach = langAnalysis.suggestions[0] || analysis.suggestedApproach;
      }

      // 5. Set affected components
      if (request.filePath) {
        analysis.affectedComponents = [request.filePath];
      }

      // 6. Determine complexity
      analysis.complexity = this.determineComplexity(request, analysis);

    } catch (error) {
      console.warn('Error during error analysis:', error);
      analysis.cause = `Analysis failed: ${error}`;
    }

    return analysis;
  }

  async performDiagnostics(code: string, language: string, checkTypes: string[]): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];

    try {
      for (const checkType of checkTypes) {
        if (checkType === 'all') {
          diagnostics.push(
            ...await this.performSyntaxCheck(code, language),
            ...await this.performSemanticCheck(code, language),
            ...await this.performStyleCheck(code, language),
            ...await this.performSecurityCheck(code, language),
            ...await this.performPerformanceCheck(code, language)
          );
        } else {
          switch (checkType) {
            case 'syntax':
              diagnostics.push(...await this.performSyntaxCheck(code, language));
              break;
            case 'semantic':
              diagnostics.push(...await this.performSemanticCheck(code, language));
              break;
            case 'style':
              diagnostics.push(...await this.performStyleCheck(code, language));
              break;
            case 'security':
              diagnostics.push(...await this.performSecurityCheck(code, language));
              break;
            case 'performance':
              diagnostics.push(...await this.performPerformanceCheck(code, language));
              break;
          }
        }
      }
    } catch (error) {
      console.error('Error during diagnostics:', error);
    }

    return diagnostics.sort((a, b) => this.getSeverityWeight(b.severity) - this.getSeverityWeight(a.severity));
  }

  async analyzeErrorPatterns(errorHistory: any[], analysisDepth: string): Promise<PatternAnalysisResult> {
    const patterns = this.extractPatterns(errorHistory);
    const statistics = this.calculateStatistics(errorHistory);
    const trends = this.analyzeTrends(errorHistory);
    const recommendations = this.generateRecommendations(patterns, statistics, analysisDepth);

    return {
      commonPatterns: patterns,
      statistics,
      trends,
      preventiveRecommendations: recommendations
    };
  }

  // PRIVATE METHODS

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
          'Update package.json dependencies'
        ]
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
          'Check async/await timing'
        ]
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
          'Check variable scope and hoisting'
        ]
      }
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
          'Ensure proper indentation and scope'
        ]
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
          'Check for missing colons in control statements'
        ]
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
          'Check PYTHONPATH environment variable'
        ]
      }
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
          'Check class and package structure'
        ]
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
          'Handle object creation failures'
        ]
      }
    ]);
  }

  private initializeDiagnosticRules(): void {
    // Syntax rules for different languages
    this.diagnosticRules.set('javascript', [
      {
        pattern: /console\.log\(/g,
        severity: 'warning',
        message: 'Console.log statement found - consider removing for production'
      }
    ]);
  }

  private matchErrorPattern(errorMessage: string, language: string): ErrorPattern | null {
    const patterns = this.errorPatterns.get(language) || [];
    return patterns.find(p => p.pattern.test(errorMessage)) || null;
  }

  private analyzeStackTrace(stackTrace: string, language: string): { rootCause?: string } {
    const lines = stackTrace.split('\n');
    const firstLine = lines[0]?.trim();
    return { rootCause: firstLine || 'Unknown stack trace error' };
  }

  private analyzeCodeContext(code: string, language: string, errorMessage: string): { confidence: number } {
    return { confidence: 0.7 };
  }

  private performLanguageSpecificAnalysis(request: ErrorFixRequest): { type?: ErrorType; category?: string; suggestions: string[] } | null {
    return { suggestions: ['General language-specific suggestion'] };
  }

  private determineComplexity(request: ErrorFixRequest, analysis: ErrorAnalysis): 'low' | 'medium' | 'high' {
    return 'medium';
  }

  private async performSyntaxCheck(code: string, language: string): Promise<Diagnostic[]> {
    return [];
  }

  private async performSemanticCheck(code: string, language: string): Promise<Diagnostic[]> {
    return [];
  }

  private async performStyleCheck(code: string, language: string): Promise<Diagnostic[]> {
    return [];
  }

  private async performSecurityCheck(code: string, language: string): Promise<Diagnostic[]> {
    return [];
  }

  private async performPerformanceCheck(code: string, language: string): Promise<Diagnostic[]> {
    return [];
  }

  private getSeverityWeight(severity: string): number {
    const weights = { error: 4, warning: 3, info: 2, hint: 1 };
    return weights[severity as keyof typeof weights] || 0;
  }

  private extractPatterns(errorHistory: any[]): any[] {
    return errorHistory.reduce((patterns, error) => {
      const pattern = error.type || 'unknown';
      const existing = patterns.find((p: any) => p.type === pattern);
      if (existing) {
        existing.count++;
      } else {
        patterns.push({ type: pattern, count: 1 });
      }
      return patterns;
    }, []);
  }

  private calculateStatistics(errorHistory: any[]): any {
    return {
      total: errorHistory.length,
      byType: this.extractPatterns(errorHistory),
      averagePerDay: errorHistory.length / 30
    };
  }

  private analyzeTrends(errorHistory: any[]): any[] {
    return [{ trend: 'stable', description: 'Error rate remains consistent' }];
  }

  private generateRecommendations(patterns: any[], statistics: any, analysisDepth: string): string[] {
    const recommendations = ['Implement proper error handling'];
    
    if (patterns.length > 0) {
      const topPattern = patterns.reduce((max, p) => p.count > max.count ? p : max);
      recommendations.push(`Focus on resolving ${topPattern.type} errors`);
    }

    return recommendations;
  }
}