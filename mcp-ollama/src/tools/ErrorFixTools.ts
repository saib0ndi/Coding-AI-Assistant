/**
 * Error fixing tools: auto_error_fix, diagnose_code, quick_fix, batch_error_fix, error_pattern_analysis, validate_fix
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling, sanitizeString } from './toolHelper.js';
import { 
  ErrorFixRequest, 
  ErrorFixResponse, 
  DiagnosticRequest, 
  QuickFixRequest, 
  ErrorHistoryItem, 
  CodeFix, 
  ErrorType 
} from '../types/index.js';

export function createErrorFixingTools(deps: ToolDependencies): MCPTool[] {
  return [
    createAutoErrorFixTool(deps),
    createDiagnosticTool(deps),
    createQuickFixTool(deps),
    createBatchErrorFixTool(deps),
    createErrorPatternAnalysisTool(deps),
    createValidationTool(deps),
  ];
}

// ---------------------------------------------------------------------------
// auto_error_fix
// ---------------------------------------------------------------------------
function createAutoErrorFixTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'auto_error_fix',
    'Automatically fix errors by analyzing error messages and code context',
    {
      errorMessage: { type: 'string', description: 'The complete error message' },
      code: { type: 'string', description: 'The code that produced the error' },
      language: { type: 'string', description: 'Programming language' },
      filePath: { type: 'string', description: 'Path to the file with the error (optional)' },
      lineNumber: { type: 'number', description: 'Line number where error occurs (optional)' },
      stackTrace: { type: 'string', description: 'Full stack trace if available (optional)' },
      context: {
        type: 'object',
        properties: {
          projectPath: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } },
          framework: { type: 'string' },
          buildTool: { type: 'string' }
        }
      }
    },
    ['errorMessage', 'code', 'language'],
    async (params: any) => {
      const startTime = Date.now();
      return withErrorHandling(
        async () => {
          const request = validateErrorFixRequest(params);
          const cacheKey = generateCacheKey('error_fix', params);

          const cached = deps.cacheManager.get(cacheKey);
          if (cached) {
            deps.logger.debug('Returning cached error fix result');
            return cached as ErrorFixResponse;
          }

          const errorAnalysis = await deps.errorAnalyzer.analyzeError(request);

          // Generate fixes with fallback
          let fixes: CodeFix[] = [];
          try {
            fixes = await deps.ollamaProvider.generateErrorFixes(request, errorAnalysis);
          } catch (error) {
            deps.logger.warn('Failed to generate fixes from Ollama, using fallback');
            fixes = await deps.ollamaProvider.generateFallbackFix(request, errorAnalysis);
          }

          const rankedFixes = await rankAndValidateFixes(deps, fixes, request);

          // Safe access to bestFix
          if (!Array.isArray(rankedFixes) || rankedFixes.length === 0) {
            return createErrorFixResponse(
              request.errorMessage,
              'No fixes could be generated',
              Date.now() - startTime
            );
          }

          const bestFix = rankedFixes[0] as any;
          if (!bestFix || !bestFix.fixedCode) {
            return createErrorFixResponse(
              request.errorMessage,
              'Generated fixes were invalid',
              Date.now() - startTime
            );
          }

          const validatedFix = await validateFix(
            deps,
            request.code,
            bestFix.fixedCode,
            request.language,
            request.errorMessage
          );

          const result = buildErrorFixResponse(request, errorAnalysis, rankedFixes, bestFix, validatedFix, startTime);

          if (result.isValidated) {
            deps.cacheManager.set(cacheKey, result, 600000);
          }

          return result;
        },
        () => {
          const p = params as { errorMessage?: string };
          return createErrorFixResponse(
            (p && p.errorMessage) || 'Unknown error',
            'Auto fix handler failed',
            Date.now() - startTime
          );
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// diagnose_code
// ---------------------------------------------------------------------------
function createDiagnosticTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'diagnose_code',
    'Perform real-time error detection and diagnostics on code',
    {
      code: { type: 'string', description: 'Code to diagnose' },
      language: { type: 'string', description: 'Programming language' },
      filePath: { type: 'string', description: 'File path for context' },
      checkTypes: {
        type: 'array',
        items: { type: 'string', enum: ['syntax', 'semantic', 'style', 'security', 'performance', 'all'] },
        description: 'Types of checks to perform',
        default: ['all']
      }
    },
    ['code', 'language'],
    async (params: DiagnosticRequest) => {
      return withErrorHandling(
        async () => {
          const { code, language, filePath, checkTypes = ['all'] } = params;

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const diagnostics = await deps.errorAnalyzer.performDiagnostics(code, language, checkTypes);

          return {
            diagnostics: diagnostics.map(mapDiagnostic),
            summary: calculateDiagnosticSummary(diagnostics),
            language,
            filePath: filePath || 'untitled',
            analysisTime: new Date().toISOString()
          };
        },
        () => ({
          diagnostics: [],
          summary: { errorCount: 0, warningCount: 0, infoCount: 0, totalIssues: 0 },
          language: params.language,
          filePath: 'unknown',
          analysisTime: new Date().toISOString(),
          error: 'Diagnostic analysis failed'
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// quick_fix
// ---------------------------------------------------------------------------
function createQuickFixTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'quick_fix',
    'Generate quick fix suggestions for specific code issues',
    {
      code: { type: 'string', description: 'Code with the issue' },
      language: { type: 'string', description: 'Programming language' },
      issueType: {
        type: 'string',
        enum: ['syntax_error', 'type_error', 'import_error', 'undefined_variable', 'missing_dependency', 'deprecated_api', 'security_issue', 'performance_issue'],
        description: 'Type of issue to fix'
      },
      issueDescription: { type: 'string', description: 'Description of the issue' },
      lineNumber: { type: 'number', description: 'Line number with the issue' },
      severity: { type: 'string', enum: ['error', 'warning', 'info', 'hint'], description: 'Severity of the issue', default: 'error' }
    },
    ['code', 'language', 'issueType', 'issueDescription'],
    async (params: QuickFixRequest) => {
      const { code, language, issueType, issueDescription, lineNumber, severity = 'error' } = params;
      return withErrorHandling(
        async () => {
          const quickFixes = await deps.ollamaProvider.generateQuickFixes({
            code,
            language,
            issueType,
            issueDescription,
            severity,
            ...(lineNumber !== undefined && { lineNumber })
          });

          const fixesArray = Array.isArray(quickFixes) ? quickFixes : [];
          return {
            fixes: fixesArray.map(normalizeFix),
            issueType,
            severity,
            lineNumber,
            language,
            generatedAt: new Date().toISOString()
          };
        },
        () => ({
          fixes: [],
          error: 'Quick fix generation failed',
          issueType,
          severity,
          lineNumber,
          language,
          generatedAt: new Date().toISOString()
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// batch_error_fix
// ---------------------------------------------------------------------------
function createBatchErrorFixTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'batch_error_fix',
    'Fix multiple errors in a codebase at once',
    {
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            errorMessage: { type: 'string' },
            filePath: { type: 'string' },
            lineNumber: { type: 'number' },
            code: { type: 'string' },
            language: { type: 'string' }
          },
          required: ['errorMessage', 'code', 'language']
        }
      },
      prioritizeBy: { type: 'string', enum: ['severity', 'frequency', 'dependencies', 'complexity'], default: 'severity' }
    },
    ['errors'],
    async (params: any) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters');
      }

      const p = params as { errors?: unknown[]; prioritizeBy?: string };
      const { errors, prioritizeBy = 'severity' } = p;

      try {
        if (!Array.isArray(errors) || errors.length === 0) {
          throw new Error('Invalid or empty errors array');
        }

        const sortedErrors = prioritizeErrors(errors, prioritizeBy);
        const batchSize = Math.min(5, sortedErrors.length);
        const results = await processBatchErrors(deps, sortedErrors.slice(0, batchSize));

        return {
          totalErrors: errors.length,
          processedErrors: batchSize,
          successfulFixes: results.fixes.length,
          failedFixes: results.failed.length,
          fixes: results.fixes,
          failed: results.failed,
          prioritizedBy: prioritizeBy,
          processedAt: new Date().toISOString()
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        deps.logger.error(`Batch fix handler failed: ${sanitizeString(errorMessage)}`);
        return createBatchErrorResponse(errors?.length || 0, prioritizeBy, errorMessage);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// error_pattern_analysis
// ---------------------------------------------------------------------------
function createErrorPatternAnalysisTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'error_pattern_analysis',
    'Analyze error patterns and suggest preventive measures',
    {
      errorHistory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            errorMessage: { type: 'string' },
            timestamp: { type: 'string' },
            filePath: { type: 'string' },
            language: { type: 'string' },
            fixed: { type: 'boolean' }
          }
        }
      },
      analysisDepth: { type: 'string', enum: ['basic', 'detailed', 'comprehensive'], default: 'detailed' }
    },
    ['errorHistory'],
    async (params: any) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters');
      }

      const p = params as { errorHistory?: unknown[]; analysisDepth?: string };
      const { errorHistory, analysisDepth = 'detailed' } = p;

      try {
        const validatedErrorHistory = validateErrorHistory(errorHistory || []);
        const patterns = await deps.errorAnalyzer.analyzeErrorPatterns(validatedErrorHistory, analysisDepth);

        return {
          patterns: patterns.commonPatterns,
          recommendations: patterns.preventiveRecommendations,
          statistics: patterns.statistics,
          trends: patterns.trends,
          analysisDepth,
          analyzedAt: new Date().toISOString()
        };
      } catch (error) {
        deps.logger.error('Error in pattern analysis handler:', error);
        return {
          patterns: [],
          recommendations: [],
          statistics: {
            totalErrors: 0,
            resolvedErrors: 0,
            resolutionRate: 0,
            byLanguage: [],
            byType: []
          },
          trends: {
            errorFrequencyTrend: { trend: 'insufficient_data', change: 0 },
            mostCommonRecentErrors: [],
            improvementAreas: []
          },
          analysisDepth,
          error: `Pattern analysis failed: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// validate_fix
// ---------------------------------------------------------------------------
function createValidationTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'validate_fix',
    'Validate that a proposed fix actually resolves the issue',
    {
      originalCode: { type: 'string', description: 'Original code with error' },
      fixedCode: { type: 'string', description: 'Code after applying fix' },
      language: { type: 'string', description: 'Programming language' },
      originalError: { type: 'string', description: 'Original error message' },
      testCases: { type: 'array', items: { type: 'string' }, description: 'Test cases to validate against (optional)' }
    },
    ['originalCode', 'fixedCode', 'language', 'originalError'],
    async (params: any) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters');
      }

      const p = params as {
        originalCode?: string;
        fixedCode?: string;
        language?: string;
        originalError?: string;
        testCases?: string[];
      };

      const { originalCode, fixedCode, language, originalError, testCases } = p;

      if (!originalCode || !fixedCode || !language || !originalError) {
        throw new Error('Missing required parameters');
      }

      try {
        const validation = await validateFix(deps, originalCode, fixedCode, language, originalError, testCases);

        return {
          isValid: validation.isValid,
          confidence: validation.confidence,
          details: validation.details,
          potentialIssues: validation.potentialIssues,
          testResults: validation.testResults,
          semanticPreservation: validation.semanticPreservation,
          validatedAt: new Date().toISOString()
        };
      } catch (error) {
        deps.logger.error('Error in validate fix handler:', error);
        return {
          isValid: false,
          confidence: 0,
          details: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
          potentialIssues: ['Validation process failed'],
          testResults: [],
          semanticPreservation: false,
          validatedAt: new Date().toISOString(),
          error: true
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function validateErrorFixRequest(params: unknown): ErrorFixRequest {
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid parameters object');
  }

  const p = params as Record<string, unknown>;

  if (!p.errorMessage || typeof p.errorMessage !== 'string') {
    throw new Error('Missing or invalid errorMessage parameter');
  }
  if (!p.code || typeof p.code !== 'string') {
    throw new Error('Missing or invalid code parameter');
  }
  if (!p.language || typeof p.language !== 'string') {
    throw new Error('Missing or invalid language parameter');
  }
  
  if (p.filePath !== undefined && typeof p.filePath !== 'string') {
    throw new Error('Invalid filePath parameter: must be string');
  }
  if (p.lineNumber !== undefined && typeof p.lineNumber !== 'number') {
    throw new Error('Invalid lineNumber parameter: must be number');
  }

  const result: ErrorFixRequest = {
    errorMessage: p.errorMessage,
    code: p.code,
    language: p.language,
    filePath: typeof p.filePath === 'string' ? p.filePath : ''
  };

  return result;
}

function buildErrorFixResponse(
  request: ErrorFixRequest, 
  errorAnalysis: any, 
  rankedFixes: any[], 
  bestFix: any, 
  validatedFix: any, 
  startTime: number
): ErrorFixResponse {
  return {
    originalError: request.errorMessage,
    errorType: errorAnalysis.type,
    errorCategory: errorAnalysis.category,
    fixes: rankedFixes,
    recommendedFix: bestFix,
    isValidated: validatedFix.isValid,
    validationDetails: validatedFix.details,
    metadata: {
      processingTime: Date.now() - startTime,
      confidence: bestFix.confidence,
      alternativeFixesCount: rankedFixes.length - 1,
      errorAnalysisDetails: {
        type: errorAnalysis.type,
        category: errorAnalysis.category,
        severity: errorAnalysis.severity || 'error',
        cause: errorAnalysis.cause || 'Unknown cause',
        affectedComponents: errorAnalysis.affectedComponents || [],
        suggestedApproach: errorAnalysis.suggestedApproach || 'Standard error fixing approach',
        complexity: errorAnalysis.complexity || 'medium',
        confidence: errorAnalysis.confidence || 0
      }
    }
  };
}

function createErrorFixResponse(
  originalError: string,
  errorMessage: string,
  processingTime: number
): ErrorFixResponse {
  return {
    originalError: originalError || 'Unknown error',
    errorType: ErrorType.SYNTAX_ERROR,
    errorCategory: 'unknown',
    fixes: [],
    recommendedFix: null,
    isValidated: false,
    validationDetails: `Failed to generate fix: ${errorMessage}`,
    metadata: {
      processingTime: Math.max(0, processingTime),
      confidence: 0,
      alternativeFixesCount: 0,
      errorAnalysisDetails: {
        type: ErrorType.SYNTAX_ERROR,
        category: 'unknown',
        severity: 'error',
        cause: errorMessage,
        affectedComponents: [],
        suggestedApproach: 'Manual review required',
        complexity: 'medium',
        confidence: 0
      }
    }
  };
}

function prioritizeErrors(errors: unknown[], prioritizeBy: string): unknown[] {
  const priorityMap: Record<string, (error: unknown) => number> = {
    'severity': (error: unknown) => {
      const errorObj = error as { severity?: string };
      const severityOrder: Record<string, number> = {
        'error': 3, 'warning': 2, 'info': 1, 'hint': 0
      };
      return severityOrder[errorObj.severity || 'info'] || 1;
    },
    'frequency': (error: unknown) => {
      const errorObj = error as { frequency?: number };
      return errorObj.frequency || 1;
    },
    'dependencies': (error: unknown) => {
      const errorObj = error as { dependencyCount?: number };
      return errorObj.dependencyCount || 1;
    },
    'complexity': (error: unknown) => {
      const errorObj = error as { complexityScore?: number };
      return errorObj.complexityScore || 1;
    }
  };

  const priorityFn = priorityMap[prioritizeBy] || priorityMap['severity'];
  return errors.slice().sort((a, b) => priorityFn(b) - priorityFn(a));
}

async function processBatchErrors(
  deps: ToolDependencies, 
  errors: unknown[]
): Promise<{ fixes: unknown[]; failed: unknown[] }> {
  const fixes: unknown[] = [];
  const failed: unknown[] = [];
  
  for (const error of errors) {
    try {
      // Create a dummy params object wrapping the error params
      const result = await autoFixSingleError(deps, error);
      if (result.isValidated) {
        fixes.push({ error, fix: result.recommendedFix });
      } else {
        failed.push({ error, reason: result.validationDetails });
      }
    } catch (err) {
      failed.push({ error, reason: 'Fix generation failed' });
    }
  }
  
  return { fixes, failed };
}

async function autoFixSingleError(deps: ToolDependencies, params: unknown): Promise<ErrorFixResponse> {
  // Directly mimic the handleAutoErrorFix logic without caching/wrapping in outer withErrorHandling
  const startTime = Date.now();
  const request = validateErrorFixRequest(params);
  const errorAnalysis = await deps.errorAnalyzer.analyzeError(request);
  let fixes: CodeFix[] = [];
  try {
    fixes = await deps.ollamaProvider.generateErrorFixes(request, errorAnalysis);
  } catch (error) {
    fixes = await deps.ollamaProvider.generateFallbackFix(request, errorAnalysis);
  }
  const rankedFixes = await rankAndValidateFixes(deps, fixes, request);
  if (!Array.isArray(rankedFixes) || rankedFixes.length === 0) {
    return createErrorFixResponse(request.errorMessage, 'No fixes could be generated', Date.now() - startTime);
  }
  const bestFix = rankedFixes[0] as any;
  if (!bestFix || !bestFix.fixedCode) {
    return createErrorFixResponse(request.errorMessage, 'Generated fixes were invalid', Date.now() - startTime);
  }
  const validatedFix = await validateFix(deps, request.code, bestFix.fixedCode, request.language, request.errorMessage);
  return buildErrorFixResponse(request, errorAnalysis, rankedFixes, bestFix, validatedFix, startTime);
}

function createBatchErrorResponse(totalErrors: number, prioritizeBy: string, errorMessage: string) {
  return {
    totalErrors,
    processedErrors: 0,
    successfulFixes: 0,
    failedFixes: totalErrors,
    fixes: [],
    failed: [],
    prioritizedBy: prioritizeBy,
    processedAt: new Date().toISOString(),
    error: `Batch fix failed: ${errorMessage}`
  };
}

function validateErrorHistory(errorHistory: unknown[]): ErrorHistoryItem[] {
  return errorHistory.map((item) => {
    if (!item || typeof item !== 'object') {
      return {
        type: 'unknown',
        timestamp: Date.now(),
        message: 'Invalid error history item',
        severity: 'info',
        resolved: false
      };
    }

    const errorItem = item as any;
    return {
      type: typeof errorItem.type === 'string' ? errorItem.type : 'unknown',
      timestamp: typeof errorItem.timestamp === 'number' ? errorItem.timestamp : Date.now(),
      message: typeof errorItem.message === 'string' ? errorItem.message : undefined,
      severity: typeof errorItem.severity === 'string' ? errorItem.severity : 'info',
      resolved: typeof errorItem.resolved === 'boolean' ? errorItem.resolved : false
    };
  });
}

function mapDiagnostic(diagnostic: any) {
  if (!diagnostic || typeof diagnostic !== 'object') {
    return {
      severity: 'info',
      message: 'Invalid diagnostic',
      line: 0,
      column: 0,
      type: 'unknown',
      code: undefined,
      source: 'mcp-ollama',
      quickFix: undefined
    };
  }
  
  return {
    severity: diagnostic.severity || 'info',
    message: diagnostic.message || 'No message',
    line: diagnostic.line || 0,
    column: diagnostic.column || 0,
    type: diagnostic.type || 'unknown',
    code: diagnostic.code,
    source: diagnostic.source || 'mcp-ollama',
    quickFix: diagnostic.quickFix
  };
}

function calculateDiagnosticSummary(diagnostics: unknown[]): {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  totalIssues: number;
} {
  const summary = { errorCount: 0, warningCount: 0, infoCount: 0, totalIssues: 0 };

  for (const diagnostic of diagnostics) {
    if (!diagnostic || typeof diagnostic !== 'object') {
      continue;
    }

    const diagObj = diagnostic as { severity?: string };
    
    switch (diagObj.severity) {
      case 'error':
        summary.errorCount++;
        summary.totalIssues++;
        break;
      case 'warning':
        summary.warningCount++;
        summary.totalIssues++;
        break;
      case 'info':
        summary.infoCount++;
        summary.totalIssues++;
        break;
      default:
        summary.infoCount++;
        summary.totalIssues++;
        break;
    }
  }

  return summary;
}

async function rankAndValidateFixes(deps: ToolDependencies, fixes: unknown[], request: ErrorFixRequest): Promise<unknown[]> {
  const rankedFixes: unknown[] = [];

  for (const fix of fixes) {
    if (!fix || typeof fix !== 'object') {
      continue;
    }

    const fixObj = fix as { fixedCode?: string; confidence?: number };

    if (!fixObj.fixedCode) {
      continue;
    }

    try {
      const validation = await validateFix(
        deps,
        request.code,
        fixObj.fixedCode,
        request.language,
        request.errorMessage
      );

      rankedFixes.push({
        ...fix,
        validationScore: validation.confidence,
        isValidated: validation.isValid,
        validationDetails: validation.details
      });
    } catch (error) {
      deps.logger.warn('Failed to validate fix:', error);
      rankedFixes.push({
        ...fix,
        validationScore: 0,
        isValidated: false,
        validationDetails: 'Validation failed'
      });
    }
  }

  return rankedFixes.sort((a, b) => {
    const aObj = a as { validationScore?: number; confidence?: number };
    const bObj = b as { validationScore?: number; confidence?: number };

    const scoreA = ((aObj.validationScore || 0) * 0.7) + ((aObj.confidence || 0) * 0.3);
    const scoreB = ((bObj.validationScore || 0) * 0.7) + ((bObj.confidence || 0) * 0.3);
    return scoreB - scoreA;
  });
}

function normalizeFix(fix: any) {
  if (!fix || typeof fix !== 'object') {
    return {
      title: 'Invalid Fix',
      description: 'Fix data was invalid',
      fixedCode: '',
      changes: [],
      confidence: 0,
      preservesSemantics: false,
      requiresUserReview: true
    };
  }

  return {
    title: typeof fix.title === 'string' ? fix.title : 'Quick Fix',
    description: typeof fix.description === 'string' ? fix.description : 'Generated fix',
    fixedCode: typeof fix.fixedCode === 'string' ? fix.fixedCode : (typeof fix.code === 'string' ? fix.code : ''),
    changes: Array.isArray(fix.changes) ? fix.changes : [],
    confidence: typeof fix.confidence === 'number' ? Math.max(0, Math.min(1, fix.confidence)) : 0.5,
    preservesSemantics: typeof fix.preservesSemantics === 'boolean' ? fix.preservesSemantics : true,
    requiresUserReview: typeof fix.requiresUserReview === 'boolean' ? fix.requiresUserReview : false
  };
}

async function validateFix(
  deps: ToolDependencies,
  originalCode: string,
  fixedCode: string,
  language: string,
  originalError: string,
  testCases?: string[]
): Promise<{
  isValid: boolean;
  confidence: number;
  details: string;
  potentialIssues: string[];
  testResults: unknown[];
  semanticPreservation: boolean;
}> {
  try {
    const validationResult = await deps.ollamaProvider.validateCodeFix({
      originalCode,
      fixedCode,
      language,
      originalError,
      testCases: testCases || []
    });

    return {
      isValid: validationResult.isValid,
      confidence: validationResult.confidence,
      details: validationResult.explanation,
      potentialIssues: validationResult.potentialIssues || [],
      testResults: validationResult.testResults || [],
      semanticPreservation: validationResult.semanticPreservation || true
    };
  } catch (error) {
    deps.logger.error('Error validating fix:', error);
    return {
      isValid: false,
      confidence: 0,
      details: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      potentialIssues: ['Validation process failed'],
      testResults: [],
      semanticPreservation: false
    };
  }
}

// Local cache helper
function generateCacheKey(prefix: string, params: unknown): string {
  try {
    const key = `${prefix}:${JSON.stringify(params)}`;
    return key.length > 250 ? `${prefix}:${hashParams(params)}` : key;
  } catch {
    return `${prefix}:${Date.now()}`;
  }
}

function hashParams(params: unknown): string {
  try {
    return Buffer.from(JSON.stringify(params)).toString('base64').substring(0, 50);
  } catch {
    return Math.random().toString(36).substring(7);
  }
}
