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
        message: 'Console.log statements should be removed in production',
        type: 'style',
        quickFix: 'Remove console.log statement'
      },
      {
        pattern: /var\s+/g,
        severity: 'warning',
        message: 'Use const or let instead of var',
        type: 'style',
        quickFix: 'Replace var with const or let'
      },
      {
        pattern: /==\s*(?!null|undefined)/g,
        severity: 'warning',
        message: 'Use === for strict equality comparison',
        type: 'style',
        quickFix: 'Replace == with ==='
      }
    ]);

    this.diagnosticRules.set('python', [
      {
        pattern: /print\(/g,
        severity: 'info',
        message: 'Consider using logging instead of print for production code',
        type: 'style',
        quickFix: 'Replace print with logging'
      },
      {
        pattern: /except:\s*$/gm,
        severity: 'warning',
        message: 'Avoid bare except clauses',
        type: 'style',
        quickFix: 'Specify exception type'
      }
    ]);
  }

  private matchErrorPattern(errorMessage: string, language: string): ErrorPattern | null {
    const patterns = this.errorPatterns.get(language.toLowerCase()) || [];
    
    for (const pattern of patterns) {
      if (pattern.pattern.test(errorMessage)) {
        return pattern;
      }
    }

    // Try generic patterns if language-specific not found
    return this.matchGenericPattern(errorMessage);
  }

  private matchGenericPattern(errorMessage: string): ErrorPattern | null {
    const genericPatterns: ErrorPattern[] = [
      {
        pattern: /syntax\s*error/i,
        type: 'syntax_error' as ErrorType,
        category: 'compilation_error',
        confidence: 0.8,
        commonCauses: ['Invalid syntax', 'Missing punctuation', 'Incorrect structure'],
        solutions: [
          'Check for missing semicolons, braces, or parentheses',
          'Verify proper syntax for the language',
          'Check for typos in keywords'
        ]
      },
      {
        pattern: /type\s*error/i,
        type: 'type_error' as ErrorType,
        category: 'type_system',
        confidence: 0.8,
        commonCauses: ['Type mismatch', 'Wrong data type', 'Invalid operation'],
        solutions: [
          'Check variable types',
          'Add proper type conversion',
          'Verify operation compatibility'
        ]
      }
    ];

    for (const pattern of genericPatterns) {
      if (pattern.pattern.test(errorMessage)) {
        return pattern;
      }
    }

    return null;
  }

  private analyzeStackTrace(stackTrace: string, _language: string): any {
    const lines = stackTrace.split('\n');
    const result = {
      rootCause: '',
      errorLocation: null as any,
      callStack: [] as string[]
    };

    // Extract relevant information from stack trace
    for (const line of lines) {
      if (this.isRelevantStackLine(line, _language)) {
        result.callStack.push(line.trim());
        
        // Try to extract file and line number
        const locationMatch = this.extractLocationFromStackLine(line, _language);
        if (locationMatch && !result.errorLocation) {
          result.errorLocation = locationMatch;
        }
      }
    }

    return result;
  }

  private analyzeCodeContext(code: string, _language: string, errorMessage: string): any {
    code.split('\n');
    let confidence = 0.5;

    const suggestions = [];
    
    // Check for common issues based on error message
    if (errorMessage.includes('undefined') || errorMessage.includes('not defined')) {
      suggestions.push('Check variable declarations and scope');
      confidence = 0.7;
    }

    if (errorMessage.includes('import') || errorMessage.includes('module')) {
      suggestions.push('Verify import statements and module paths');
      confidence = 0.8;
    }

    if (errorMessage.includes('syntax')) {
      suggestions.push('Review syntax for missing punctuation or keywords');
      confidence = 0.6;
    }

    return { suggestions, confidence };
  }

  private performLanguageSpecificAnalysis(request: ErrorFixRequest): any {
    const language = request.language.toLowerCase();
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.analyzeJavaScriptError(request);
      case 'python':
        return this.analyzePythonError(request);
      case 'java':
        return this.analyzeJavaError(request);
      default:
        return null;
    }
  }

  private analyzeJavaScriptError(request: ErrorFixRequest): any {
    const errorMsg = request.errorMessage.toLowerCase();

    if (errorMsg.includes('cannot read property')) {
      return {
        type: 'null_reference' as ErrorType,
        category: 'runtime_error',
        suggestions: [
          'Use optional chaining (?.)',
          'Add null/undefined checks',
          'Initialize objects with default values'
        ]
      };
    }

    if (errorMsg.includes('is not a function')) {
      return {
        type: 'type_error' as ErrorType,
        category: 'runtime_error',
        suggestions: [
          'Check if the variable is actually a function',
          'Verify the function is imported correctly',
          'Check for typos in function name'
        ]
      };
    }

    return null;
  }

  private analyzePythonError(request: ErrorFixRequest): any {
    const errorMsg = request.errorMessage.toLowerCase();

    if (errorMsg.includes('indentationerror')) {
      return {
        type: 'syntax_error' as ErrorType,
        category: 'indentation',
        suggestions: [
          'Use consistent indentation (4 spaces recommended)',
          'Check for mixing tabs and spaces',
          'Add proper indentation after colons'
        ]
      };
    }

    return null;
  }

  private analyzeJavaError(request: ErrorFixRequest): any {
    const errorMsg = request.errorMessage.toLowerCase();

    if (errorMsg.includes('nullpointerexception')) {
      return {
        type: 'null_reference' as ErrorType,
        category: 'runtime_error',
        suggestions: [
          'Add null checks before object access',
          'Initialize objects properly',
          'Use Optional<T> for nullable values'
        ]
      };
    }

    return null;
  }

  // DIAGNOSTIC METHODS

  private async performSyntaxCheck(code: string, language: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const rules = this.diagnosticRules.get(language) || [];

    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const rule of rules) {
        if (rule.type === 'style') continue; // Skip style rules in syntax check
        
        const matches = Array.from(line.matchAll(rule.pattern));
        for (const match of matches) {
          diagnostics.push({
            severity: rule.severity,
            message: rule.message,
            line: i + 1,
            column: match.index || 0,
            type: rule.type,
            code: `${language}_${rule.type}`,
            source: 'error_analyzer',
            quickFix: rule.quickFix
          });
        }
      }
    }

    return diagnostics;
  }

  private async performSemanticCheck(_code: string, _language: string): Promise<Diagnostic[]> {
    // Placeholder for semantic analysis
    // In a real implementation, this would integrate with language servers
    return [];
  }

  private async performStyleCheck(code: string, language: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const rules = this.diagnosticRules.get(language) || [];

    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const rule of rules) {
        if (rule.type !== 'style') continue;
        
        const matches = Array.from(line.matchAll(rule.pattern));
        for (const match of matches) {
          diagnostics.push({
            severity: rule.severity,
            message: rule.message,
            line: i + 1,
            column: match.index || 0,
            type: 'style',
            code: `${language}_style`,
            source: 'style_checker',
            quickFix: rule.quickFix
          });
        }
      }
    }

    return diagnostics;
  }

  private async performSecurityCheck(code: string, _language: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    
    // Basic security patterns
    const securityPatterns = [
      {
        pattern: /eval\(/g,
        message: 'Use of eval() is dangerous and should be avoided',
        severity: 'error' as const
      },
      {
        pattern: /innerHTML\s*=/g,
        message: 'innerHTML assignment can lead to XSS vulnerabilities',
        severity: 'warning' as const
      }
    ];

    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of securityPatterns) {
        const matches = Array.from(line.matchAll(pattern.pattern));
        for (const match of matches) {
          diagnostics.push({
            severity: pattern.severity,
            message: pattern.message,
            line: i + 1,
            column: match.index || 0,
            type: 'security',
            code: `security_${_language}`,
            source: 'security_analyzer',
            quickFix: 'Review and use safer alternatives'
          });
        }
      }
    }

    return diagnostics;
  }

  private async performPerformanceCheck(code: string, _language: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    
    // Basic performance patterns
    const performancePatterns = [
      {
        pattern: /for\s*\([^)]*\)\s*{\s*for\s*\(/g,
        message: 'Nested loops may cause performance issues',
        severity: 'info' as const
      }
    ];

    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of performancePatterns) {
        const matches = Array.from(line.matchAll(pattern.pattern));
        for (const match of matches) {
          diagnostics.push({
            severity: pattern.severity,
            message: pattern.message,
            line: i + 1,
            column: match.index || 0,
            type: 'performance',
            code: `perf_${_language}`,
            source: 'performance_analyzer',
            quickFix: 'Consider algorithm optimization'
          });
        }
      }
    }

    return diagnostics;
  }

  // UTILITY METHODS

  private getSeverityWeight(severity: string): number {
    const weights: Record<string, number> = { 'error': 3, 'warning': 2, 'info': 1, 'hint': 0 };
    return weights[severity] || 0;
  }

  private determineComplexity(request: ErrorFixRequest, analysis: ErrorAnalysis): 'low' | 'medium' | 'high' {
    let complexityScore = 0;

    // Factor 1: Error type complexity
    const complexErrorTypes = ['type_error', 'compilation_error', 'runtime_error'];
    if (complexErrorTypes.includes(analysis.type)) {
      complexityScore += 2;
    }

    // Factor 2: Stack trace presence (indicates runtime complexity)
    if (request.stackTrace && request.stackTrace.split('\n').length > 5) {
      complexityScore += 1;
    }

    // Factor 3: Code length (longer code might be more complex to fix)
    if (request.code.split('\n').length > 50) {
      complexityScore += 1;
    }

    // Factor 4: Multiple potential causes
    if (analysis.confidence < 0.7) {
      complexityScore += 1;
    }

    // Determine complexity level
    if (complexityScore >= 4) return 'high';
    if (complexityScore >= 2) return 'medium';
    return 'low';
  }

  private isRelevantStackLine(line: string, _language: string): boolean {
    // Filter out framework/library lines and focus on user code
    const irrelevantPatterns = [
      /node_modules/,
      /internal\/modules/,
      /\(<anonymous>\)/,
      /at async/
    ];

    return !irrelevantPatterns.some(pattern => pattern.test(line)) && line.trim().length > 0;
  }

  private extractLocationFromStackLine(line: string, _language: string): any {
    // Extract file and line number from stack trace line
    const patterns = [
      /at .+\((.+):(\d+):(\d+)\)/, // Node.js style
      /\s+File "(.+)", line (\d+)/, // Python style
      /\s+at (.+)\((.+):(\d+)\)/ // Java style
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]) || 0
        };
      }
    }

    return null;
  }

  private extractPatterns(errorHistory: any[]): any[] {
    // Group errors by similarity and extract common patterns
    const patternGroups = new Map();
    
    for (const error of errorHistory) {
      const key = this.generatePatternKey(error.errorMessage, error.language);
      if (!patternGroups.has(key)) {
        patternGroups.set(key, []);
      }
      patternGroups.get(key).push(error);
    }

    return Array.from(patternGroups.entries())
      .map(([pattern, errors]) => ({
        pattern,
        frequency: errors.length,
        examples: errors.slice(0, 3),
        languages: [...new Set(errors.map((e: any) => e.language))],
        timespan: this.calculateTimespan(errors)
      }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  private calculateStatistics(errorHistory: any[]): any {
    const total = errorHistory.length;
    const byLanguage = this.groupBy(errorHistory, 'language');
    const byType = this.groupBy(errorHistory, 'errorType');
    const resolved = errorHistory.filter(e => e.fixed).length;

    return {
      totalErrors: total,
      resolvedErrors: resolved,
      resolutionRate: total > 0 ? (resolved / total) * 100 : 0,
      byLanguage: Object.entries(byLanguage).map(([lang, errors]) => ({
        language: lang,
        count: (errors as any[]).length,
        percentage: ((errors as any[]).length / total) * 100
      })),
      byType: Object.entries(byType).map(([type, errors]) => ({
        type,
        count: (errors as any[]).length,
        percentage: ((errors as any[]).length / total) * 100
      }))
    };
  }

  private analyzeTrends(errorHistory: any[]): any {
    // Analyze trends over time
    const sortedErrors = errorHistory
      .filter(e => e.timestamp)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const timeGroups = this.groupByTimeInterval(sortedErrors, 'day');
    
    return {
      errorFrequencyTrend: this.calculateTrend(timeGroups),
      mostCommonRecentErrors: this.getRecentErrors(sortedErrors, 7).slice(0, 5),
      improvementAreas: this.identifyImprovementAreas(errorHistory)
    };
  }

  private generateRecommendations(patterns: any[], statistics: any, analysisDepth: string): string[] {
    const recommendations = [];

    // Based on common patterns
    const topPatterns = patterns.slice(0, 3);
    for (const pattern of topPatterns) {
      if (pattern.frequency > 1) {
        recommendations.push(
          `Consider creating a code template or utility function for the recurring "${pattern.pattern}" pattern (${pattern.frequency} occurrences)`
        );
      }
    }

    // Based on language statistics
    const topLanguage = statistics.byLanguage[0];
    if (topLanguage && topLanguage.percentage > 50) {
      recommendations.push(
        `Focus on ${topLanguage.language} best practices and tooling - it accounts for ${topLanguage.percentage.toFixed(1)}% of errors`
      );
    }

    // Based on resolution rate
    if (statistics.resolutionRate < 80) {
      recommendations.push(
        'Improve error documentation and resolution processes - current resolution rate is below 80%'
      );
    }

    // Analysis depth specific recommendations
    if (analysisDepth === 'comprehensive') {
      recommendations.push(
        'Consider implementing automated error detection and prevention tools',
        'Set up continuous monitoring for error patterns',
        'Create team knowledge base for common error solutions'
      );
    }

    return recommendations;
  }

  private generatePatternKey(errorMessage: string, _language: string): string {
    // Normalize error message for pattern matching
    return errorMessage
      .replace(/['"`][^'"`]*['"`]/g, 'STRING') // Replace string literals
      .replace(/\d+/g, 'NUMBER') // Replace numbers
      .replace(/\w+Error:/g, 'ERROR:') // Normalize error types
      .toLowerCase()
      .trim();
  }

  private calculateTimespan(errors: any[]): any {
    if (errors.length === 0) return null;
    
    const timestamps = errors
      .map(e => e.timestamp)
      .filter(t => t)
      .map(t => new Date(t).getTime())
      .sort();

    if (timestamps.length === 0) return null;

    return {
      firstOccurrence: new Date(timestamps[0]).toISOString(),
      lastOccurrence: new Date(timestamps[timestamps.length - 1]).toISOString(),
      duration: timestamps[timestamps.length - 1] - timestamps[0]
    };
  }

  private groupBy(array: any[], key: string): Record<string, any[]> {
    return array.reduce((groups, item) => {
      const value = item[key] || 'unknown';
      if (!groups[value]) {
        groups[value] = [];
      }
      groups[value].push(item);
      return groups;
    }, {});
  }

  private groupByTimeInterval(errors: any[], interval: string): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    
    for (const error of errors) {
      if (!error.timestamp) continue;
      
      const date = new Date(error.timestamp);
      let key: string;
      
      switch (interval) {
        case 'hour':
          key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        default:
          key = date.toISOString().split('T')[0];
      }
      
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(error);
    }
    
    return groups;
  }

  private calculateTrend(timeGroups: Record<string, any[]>): any {
    const sortedKeys = Object.keys(timeGroups).sort();
    const counts = sortedKeys.map(key => timeGroups[key].length);
    
    if (counts.length < 2) return { trend: 'insufficient_data', change: 0 };
    
    const recent = counts.slice(-7); // Last 7 data points
    const earlier = counts.slice(-14, -7); // Previous 7 data points
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    
    const change = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : 0;
    
    let trend = 'stable';
    if (change > 10) trend = 'increasing';
    else if (change < -10) trend = 'decreasing';
    
    return { trend, change: Math.round(change * 100) / 100, recentAvg, earlierAvg };
  }

  private getRecentErrors(sortedErrors: any[], days: number): any[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return sortedErrors
      .filter(error => new Date(error.timestamp) >= cutoff)
      .reverse(); // Most recent first
  }

  private identifyImprovementAreas(errorHistory: any[]): string[] {
    const areas = [];
    
    // Analyze error types
    const errorTypes = this.groupBy(errorHistory, 'errorType');
    const sortedTypes = Object.entries(errorTypes)
      .sort(([,a], [,b]) => (b as any[]).length - (a as any[]).length);
    
    if (sortedTypes.length > 0) {
      const topType = sortedTypes[0];
      areas.push(`${topType[0]} errors (${(topType[1] as any[]).length} occurrences)`);
    }
    
    // Analyze languages
    const languages = this.groupBy(errorHistory, 'language');
    const sortedLanguages = Object.entries(languages)
      .sort(([,a], [,b]) => (b as any[]).length - (a as any[]).length);
    
    if (sortedLanguages.length > 0) {
      const topLang = sortedLanguages[0];
      areas.push(`${topLang[0]} development practices`);
    }
    
    // Analyze resolution times (if available)
    const unresolvedErrors = errorHistory.filter(e => !e.fixed);
    if (unresolvedErrors.length > errorHistory.length * 0.2) {
      areas.push('Error resolution processes');
    }
    
    return areas;
  }
}
