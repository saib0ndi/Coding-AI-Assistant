import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { ContextManager } from '../utils/ContextManager.js';
import { CacheManager } from '../utils/CacheManager.js';
import { Logger } from '../utils/Logger.js';
import { ErrorAnalyzer } from '../utils/ErrorAnalyzer.js';
import {
  MCPTool,
  MCPResource,
  CodeCompletionRequest,
  CodeAnalysisRequest,
  OllamaConfig,
  ErrorFixRequest,
  ErrorFixResponse,
  ErrorType,
  DiagnosticRequest,
  QuickFixRequest,
} from '../types/index.js';

export class MCPServer {
  private readonly server: Server;
  private readonly ollamaProvider: OllamaProvider;
  private readonly contextManager: ContextManager;
  private readonly cacheManager: CacheManager;
  private readonly logger: Logger;
  private readonly errorAnalyzer: ErrorAnalyzer;
  private readonly tools = new Map<string, MCPTool>();
  private readonly resources = new Map<string, MCPResource>();
  private readonly config: OllamaConfig;
  private static readonly DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'codellama:7b-instruct';
  private transport?: StdioServerTransport;
  private isRunning = false;

  constructor(ollamaConfig: OllamaConfig) {
    try {
      this.config = ollamaConfig;
      this.server = new Server(
        { name: 'mcp-ollama-server', version: '2.0.0' },
        { capabilities: { tools: {}, resources: {} } }
      );

      this.logger = new Logger();
      this.ollamaProvider = new OllamaProvider(ollamaConfig);
      this.contextManager = new ContextManager();
      this.cacheManager = new CacheManager();
      this.errorAnalyzer = new ErrorAnalyzer();
      
      this.initializeServer();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to initialize MCPServer: ${errorMessage}`);
    }
  }

  private initializeServer(): void {
    this.setupTools();
    this.setupResources();
    this.setupHandlers();
  }

  private setupTools(): void {
    const allTools = [
      ...this.createCoreTools(),
      ...this.createErrorFixingTools(),
      ...this.createAnalysisTools()
    ];
    
    allTools.forEach(tool => this.tools.set(tool.name, tool));
  }

  private createCoreTools(): MCPTool[] {
    return [
      this.createCodeCompletionTool(),
      this.createCodeGenerationTool(),
      this.createCodeExplanationTool()
    ];
  }

  private createErrorFixingTools(): MCPTool[] {
    return [
      this.createAutoErrorFixTool(),
      this.createQuickFixTool(),
      this.createBatchErrorFixTool(),
      this.createValidationTool()
    ];
  }

  private createAnalysisTools(): MCPTool[] {
    return [
      this.createCodeAnalysisTool(),
      this.createDiagnosticTool(),
      this.createContextAnalysisTool(),
      this.createRefactoringTool(),
      this.createErrorPatternAnalysisTool()
    ];
  }

  private createAutoErrorFixTool(): MCPTool {
    return this.createTool('auto_error_fix', 
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
      this.handleAutoErrorFix.bind(this)
    );
  }

  private createDiagnosticTool(): MCPTool {
    return this.createTool('diagnose_code',
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
      this.handleDiagnoseCode.bind(this)
    );
  }

  private createQuickFixTool(): MCPTool {
    return this.createTool('quick_fix',
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
      this.handleQuickFix.bind(this)
    );
  }

  private createBatchErrorFixTool(): MCPTool {
    return this.createTool('batch_error_fix',
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
      this.handleBatchErrorFix.bind(this)
    );
  }

  private createErrorPatternAnalysisTool(): MCPTool {
    return this.createTool('error_pattern_analysis',
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
      this.handleErrorPatternAnalysis.bind(this)
    );
  }

  private createValidationTool(): MCPTool {
    return this.createTool('validate_fix',
      'Validate that a proposed fix actually resolves the issue',
      {
        originalCode: { type: 'string', description: 'Original code with error' },
        fixedCode: { type: 'string', description: 'Code after applying fix' },
        language: { type: 'string', description: 'Programming language' },
        originalError: { type: 'string', description: 'Original error message' },
        testCases: { type: 'array', items: { type: 'string' }, description: 'Test cases to validate against (optional)' }
      },
      ['originalCode', 'fixedCode', 'language', 'originalError'],
      this.handleValidateFix.bind(this)
    );
  }

  private createTool(name: string, description: string, properties: Record<string, any>, required: string[], handler: (params: any) => Promise<any>): MCPTool {
    return {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties,
        required
      },
      handler
    };
  }

  private createCodeCompletionTool(): MCPTool {
    return this.createTool('code_completion',
      'Generate intelligent code completions using Ollama',
      {
        code: { type: 'string', description: 'The current code content' },
        language: { type: 'string', description: 'Programming language' },
        position: {
          type: 'object',
          properties: {
            line: { type: 'number' },
            character: { type: 'number' }
          },
          required: ['line', 'character']
        },
        context: {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            projectPath: { type: 'string' },
            imports: { type: 'array', items: { type: 'string' } },
            functions: { type: 'array', items: { type: 'string' } },
            variables: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      ['code', 'language', 'position'],
      this.handleCodeCompletion.bind(this)
    );
  }

  private createCodeAnalysisTool(): MCPTool {
    return this.createTool('code_analysis',
      'Analyze code for explanations, refactoring, optimization, or bugs',
      {
        code: { type: 'string', description: 'The code to analyze' },
        language: { type: 'string', description: 'Programming language' },
        analysisType: {
          type: 'string',
          enum: ['explanation', 'refactoring', 'optimization', 'bugs'],
          description: 'Type of analysis to perform'
        }
      },
      ['code', 'language', 'analysisType'],
      this.handleCodeAnalysis.bind(this)
    );
  }

  private createCodeGenerationTool(): MCPTool {
    return this.createTool('code_generation',
      'Generate code based on natural language prompts',
      {
        prompt: { type: 'string', description: 'Natural language description of desired code' },
        language: { type: 'string', description: 'Target programming language' },
        context: {
          type: 'object',
          properties: {
            projectType: { type: 'string' },
            dependencies: { type: 'array', items: { type: 'string' } },
            style: { type: 'string' }
          }
        }
      },
      ['prompt', 'language'],
      this.handleCodeGeneration.bind(this)
    );
  }

  private createCodeExplanationTool(): MCPTool {
    return this.createTool('code_explanation',
      'Explain code functionality and concepts',
      {
        code: { type: 'string', description: 'The code to explain' },
        language: { type: 'string', description: 'Programming language' },
        level: {
          type: 'string',
          enum: ['beginner', 'intermediate', 'advanced'],
          description: 'Explanation complexity level',
          default: 'intermediate'
        }
      },
      ['code', 'language'],
      this.handleCodeExplanation.bind(this)
    );
  }

  private createContextAnalysisTool(): MCPTool {
    return this.createTool('context_analysis',
      'Analyze project context for better code suggestions',
      {
        projectPath: { type: 'string', description: 'Path to the project root' },
        filePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'File patterns to include in analysis',
          default: ['**/*.js', '**/*.ts', '**/*.py', '**/*.java']
        },
        maxFiles: { type: 'number', description: 'Maximum number of files to analyze', default: 50 }
      },
      ['projectPath'],
      this.handleContextAnalysis.bind(this)
    );
  }

  private createRefactoringTool(): MCPTool {
    return this.createTool('refactoring_suggestions',
      'Get intelligent refactoring suggestions for code improvement',
      {
        code: { type: 'string', description: 'The code to refactor' },
        language: { type: 'string', description: 'Programming language' },
        focusAreas: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['performance', 'readability', 'maintainability', 'security', 'patterns']
          },
          description: 'Areas to focus refactoring on'
        }
      },
      ['code', 'language'],
      this.handleRefactoringSuggestions.bind(this)
    );
  }

  private setupResources(): void {
    const resources = [
      { id: 'project_context', uri: 'context://project', name: 'Project Context', description: 'Current project context and metadata', handler: this.getProjectContext.bind(this) },
      { id: 'code_patterns', uri: 'patterns://common', name: 'Common Code Patterns', description: 'Library of common code patterns and best practices', handler: this.getCodePatterns.bind(this) },
      { id: 'model_status', uri: 'status://ollama', name: 'Ollama Model Status', description: 'Current status and capabilities of the Ollama model', handler: this.getModelStatus.bind(this) },
      { id: 'error_database', uri: 'errors://database', name: 'Error Solutions Database', description: 'Database of known errors and their solutions', handler: this.getErrorDatabase.bind(this) },
      { id: 'fix_templates', uri: 'templates://fixes', name: 'Fix Templates', description: 'Templates for common error fixes by language', handler: this.getFixTemplates.bind(this) }
    ];

    resources.forEach(({ id, uri, name, description, handler }) => {
      this.resources.set(id, {
        uri,
        name,
        description,
        mimeType: 'application/json',
        handler
      });
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, this.handleListTools.bind(this));
    this.server.setRequestHandler(CallToolRequestSchema, this.handleCallTool.bind(this));
  }

  private async handleListTools() {
    try {
      return {
        tools: Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema
        }))
      };
    } catch (error) {
      this.logger.error(`Error listing tools: ${this.getErrorMessage(error)}`);
      throw new McpError(ErrorCode.InternalError, 'Failed to retrieve tools list');
    }
  }

  private async handleCallTool(request: any) {
    const { name, arguments: args } = request.params;
    const sanitizedName = this.sanitizeString(name);

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
      }

      this.logger.info(`Executing tool: ${sanitizedName}`);
      const result = await tool.handler(args);
      this.logger.info(`Tool ${sanitizedName} completed successfully`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Tool ${sanitizedName} failed: ${this.sanitizeString(errorMessage)}`);

      if (error instanceof McpError) {
        throw error;
      }

      return {
        content: [{
          type: 'text',
          text: `Error executing tool '${sanitizedName}': ${this.sanitizeString(errorMessage)}`
        }],
        isError: true
      };
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private sanitizeString(str: string): string {
    return str.replace(/[\r\n\t]/g, '_');
  }

  // ERROR HANDLING IMPROVEMENTS

  // NEW ERROR FIXING HANDLERS

  private async handleAutoErrorFix(params: unknown): Promise<ErrorFixResponse> {
    const startTime = Date.now();
    
    return this.withErrorHandling(async () => {
      const request = this.validateErrorFixRequest(params);
      const cacheKey = this.generateCacheKey('error_fix', params);
      
      const cached = this.cacheManager.get(cacheKey);
      if (cached) {
        this.logger.debug('Returning cached error fix result');
        return cached;
      }

      const errorAnalysis = await this.errorAnalyzer.analyzeError(request);
      const fixes = await this.ollamaProvider.generateErrorFixes(request, errorAnalysis);

      const rankedFixes = await this.rankAndValidateFixes(fixes, request);
      const bestFix = rankedFixes[0] as any;

      if (!bestFix || !bestFix.fixedCode) {
        throw new Error('No valid fixes generated');
      }

      const validatedFix = await this.validateFix(
        request.code,
        bestFix.fixedCode,
        request.language,
        request.errorMessage
      );

      const result = this.buildErrorFixResponse(request, errorAnalysis, rankedFixes, bestFix, validatedFix, startTime);
      
      if (result.isValidated) {
        this.cacheManager.set(cacheKey, result, 600000);
      }

      return result;
    }, () => this.createErrorFixResponse(
      (params as { errorMessage?: string })?.errorMessage || 'Unknown error',
      'Auto fix handler failed',
      Date.now() - startTime
    ));
  }

  private buildErrorFixResponse(request: ErrorFixRequest, errorAnalysis: any, rankedFixes: any[], bestFix: any, validatedFix: any, startTime: number): ErrorFixResponse {
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

  private async withErrorHandling<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(`Operation failed: ${this.sanitizeString(this.getErrorMessage(error))}`);
      return fallback();
    }
  }

  private validateErrorFixRequest(params: unknown): ErrorFixRequest {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters object');
    }

    const p = params as Record<string, unknown>;

    // Validate required parameters with proper type checking
    if (!p.errorMessage || typeof p.errorMessage !== 'string') {
      throw new Error('Missing or invalid errorMessage parameter');
    }
    if (!p.code || typeof p.code !== 'string') {
      throw new Error('Missing or invalid code parameter');
    }
    if (!p.language || typeof p.language !== 'string') {
      throw new Error('Missing or invalid language parameter');
    }
    
    // Validate optional parameters
    if (p.filePath !== undefined && typeof p.filePath !== 'string') {
      throw new Error('Invalid filePath parameter: must be string');
    }
    if (p.lineNumber !== undefined && typeof p.lineNumber !== 'number') {
      throw new Error('Invalid lineNumber parameter: must be number');
    }
    if (p.stackTrace !== undefined && typeof p.stackTrace !== 'string') {
      throw new Error('Invalid stackTrace parameter: must be string');
    }

    const result: ErrorFixRequest = {
      errorMessage: p.errorMessage,
      code: p.code,
      language: p.language,
      filePath: typeof p.filePath === 'string' ? p.filePath : ''
    };

    if (typeof p.lineNumber === 'number') {
      (result as any).lineNumber = p.lineNumber;
    }

    if (typeof p.stackTrace === 'string') {
      (result as any).stackTrace = p.stackTrace;
    }

    if (typeof p.context === 'object' && p.context !== null) {
      const ctx = p.context as any;
      (result as any).context = {
        projectPath: typeof ctx.projectPath === 'string' ? ctx.projectPath : undefined,
        dependencies: Array.isArray(ctx.dependencies) ? ctx.dependencies : undefined,
        framework: typeof ctx.framework === 'string' ? ctx.framework : undefined,
        buildTool: typeof ctx.buildTool === 'string' ? ctx.buildTool : undefined
      };
    }

    return result;
  }

  private createErrorFixResponse(
    originalError: string,
    errorMessage: string,
    processingTime: number
  ): ErrorFixResponse {
    return {
      originalError,
      errorType: 'unknown' as ErrorType,
      errorCategory: 'unknown',
      fixes: [],
      recommendedFix: null,
      isValidated: false,
      validationDetails: `Failed to generate fix: ${errorMessage}`,
      metadata: {
        processingTime,
        confidence: 0,
        alternativeFixesCount: 0,
        errorAnalysisDetails: null
      }
    };
  }

  private async handleDiagnoseCode(params: DiagnosticRequest): Promise<unknown> {
    return this.withErrorHandling(async () => {
      const { code, language, filePath, checkTypes = ['all'] } = params;

      if (!code || !language) {
        throw new Error('Missing required parameters: code, language');
      }

      const diagnostics = await this.errorAnalyzer.performDiagnostics(code, language, checkTypes);

      return {
        diagnostics: diagnostics.map(this.mapDiagnostic),
        summary: this.calculateDiagnosticSummary(diagnostics),
        language,
        filePath: filePath || 'untitled',
        analysisTime: new Date().toISOString()
      };
    }, () => ({
      diagnostics: [],
      summary: { errorCount: 0, warningCount: 0, infoCount: 0, totalIssues: 0 },
      language: params.language,
      filePath: 'unknown',
      analysisTime: new Date().toISOString(),
      error: 'Diagnostic analysis failed'
    }));
  }

  private mapDiagnostic(diagnostic: any) {
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

  private async handleQuickFix(params: QuickFixRequest): Promise<unknown> {
    const { code, language, issueType, issueDescription, lineNumber, severity = 'error' } = params;

    return this.withErrorHandling(async () => {
      const quickFixes = await this.ollamaProvider.generateQuickFixes({
        code,
        language,
        issueType,
        issueDescription,
        severity,
        ...(lineNumber !== undefined && { lineNumber })
      });

      const fixesArray = Array.isArray(quickFixes) ? quickFixes : [];
      return {
        fixes: fixesArray.map(this.normalizeFix),
        issueType,
        severity,
        lineNumber,
        language,
        generatedAt: new Date().toISOString()
      };
    }, () => ({
      fixes: [],
      error: 'Quick fix generation failed',
      issueType,
      severity,
      lineNumber,
      language,
      generatedAt: new Date().toISOString()
    }));
  }

  private normalizeFix(fix: any) {
    return {
      title: fix.title || 'Quick Fix',
      description: fix.description || 'Generated fix',
      fixedCode: fix.fixedCode || fix.code || '',
      changes: fix.changes || [],
      confidence: fix.confidence || 0.5,
      preservesSemantics: fix.preservesSemantics ?? true,
      requiresUserReview: fix.requiresUserReview ?? false
    };
  }

  private async handleBatchErrorFix(params: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters');
    }

    const p = params as { errors?: unknown[]; prioritizeBy?: string };
    const { errors, prioritizeBy = 'severity' } = p;

    try {
      if (!Array.isArray(errors) || errors.length === 0) {
        throw new Error('Invalid or empty errors array');
      }

      const sortedErrors = this.prioritizeErrors(errors, prioritizeBy);
      const batchSize = Math.min(5, sortedErrors.length);
      const results = await this.processBatchErrors(sortedErrors.slice(0, batchSize));

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
      this.logger.error(`Batch fix handler failed: ${errorMessage.replace(/[\r\n\t]/g, '_')}`);

      return this.createBatchErrorResponse(errors?.length || 0, prioritizeBy, errorMessage);
    }
  }

  private async processBatchErrors(errors: unknown[]): Promise<{ fixes: unknown[]; failed: unknown[] }> {
    const fixes: unknown[] = [];
    const failed: unknown[] = [];

    const results = await Promise.allSettled(
      errors.map(error => this.handleAutoErrorFix(error))
    );

    results.forEach((result, index) => {
      if (this.isSuccessfulFix(result)) {
        const successfulFix = this.createSuccessfulFix(result, errors[index]);
        fixes.push(successfulFix);
      } else {
        const failedFix = this.createFailedFix(result, errors[index]);
        failed.push(failedFix);
      }
    });

    return { fixes, failed };
  }

  private isSuccessfulFix(result: PromiseSettledResult<any>): result is PromiseFulfilledResult<any> {
    return result.status === 'fulfilled' &&
      result.value.isValidated &&
      result.value.recommendedFix;
  }

  private createSuccessfulFix(result: PromiseFulfilledResult<any>, originalError: unknown): unknown {
    const defaultFix = {
      title: 'Fix',
      description: 'Generated fix',
      fixedCode: '',
      changes: [],
      confidence: 0
    };

    return {
      originalError,
      fix: result.value.recommendedFix || defaultFix,
      confidence: result.value.metadata?.confidence || 0
    };
  }

  private createFailedFix(result: PromiseSettledResult<any>, originalError: unknown): unknown {
    const failureReason = result.status === 'fulfilled'
      ? result.value.validationDetails || 'Validation failed'
      : 'Fix generation failed';

    return {
      originalError,
      reason: failureReason
    };
  }

  private createBatchErrorResponse(totalErrors: number, prioritizeBy: string, errorMessage: string) {
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

  private async handleErrorPatternAnalysis(params: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters');
    }

    const p = params as { errorHistory?: unknown[]; analysisDepth?: string };
    const { errorHistory, analysisDepth = 'detailed' } = p;

    try {
      const patterns = await this.errorAnalyzer.analyzeErrorPatterns(errorHistory || [], analysisDepth);

      return {
        patterns: patterns.commonPatterns,
        recommendations: patterns.preventiveRecommendations,
        statistics: patterns.statistics,
        trends: patterns.trends,
        analysisDepth,
        analyzedAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error in pattern analysis handler:', error);
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

  private async handleValidateFix(params: unknown): Promise<unknown> {
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
      const validation = await this.validateFix(originalCode, fixedCode, language, originalError, testCases);

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
      this.logger.error('Error in validate fix handler:', error);
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

  // EXISTING HANDLERS (improved with better error handling)
  // EXISTING HANDLERS (improved with better error handling)
  private async handleCodeCompletion(params: unknown): Promise<unknown> {
    return this.withErrorHandling(async () => {
      this.validateParams(params, 'object');
      const p = params as {
        code?: string;
        language?: string;
        position?: { line: number; character: number };
        context?: Record<string, unknown>;
        prefix?: string;
        prompt?: string;
        maxTokens?: number;
      };

      if (!p.language) throw new Error('Missing required parameter: language');

      if (p.code && p.position) {
        return this.handleIDECompletion(p, params);
      }

      const ctx = p.prefix ?? p.prompt ?? p.code;
      if (!ctx) {
        throw new Error('Missing required parameters: provide either (code+position) or (prefix/prompt/code)');
      }

      return this.handlePrefixCompletion(p, ctx, params);
    }, () => ({
      suggestions: [],
      metadata: {
        model: this.config?.model || 'unknown',
        processingTime: 0,
        confidence: 0,
        error: 'Code completion failed'
      }
    }));
  }

  private async handleIDECompletion(p: any, params: unknown) {
    const cacheKey = this.generateCacheKey('completion:pos', params);
    const cached = this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const req: CodeCompletionRequest = {
      code: p.code,
      language: p.language,
      position: p.position
    };

    if (p.context) {
      req.context = this.normalizeContext(p.context);
    }

    const res = await this.ollamaProvider.generateCompletion(req);
    if (res.suggestions?.length) {
      this.cacheManager.set(cacheKey, res, 300000);
    }
    return res;
  }

  private async handlePrefixCompletion(p: any, ctx: string, params: unknown) {
    const cacheKey = this.generateCacheKey('completion:prefix', {
      language: p.language,
      prefix: ctx,
      maxTokens: p.maxTokens
    });
    
    const cached = this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const suggestions = await this.generatePrefixSuggestions(ctx, p.language, p.maxTokens);
    
    const result = {
      suggestions,
      metadata: {
        model: this.config?.model || 'unknown',
        mode: 'prefix',
        processingTime: 0,
        confidence: suggestions.length ? 0.6 : 0
      }
    };
    
    if (suggestions.length) {
      this.cacheManager.set(cacheKey, result, 300000);
    }
    return result;
  }

  private normalizeContext(context: Record<string, unknown>) {
    const result: {
      fileName?: string;
      projectPath?: string;
      imports?: string[];
      functions?: string[];
      variables?: string[];
    } = {};

    if (typeof context.fileName === 'string') result.fileName = context.fileName;
    if (typeof context.projectPath === 'string') result.projectPath = context.projectPath;
    if (Array.isArray(context.imports)) result.imports = context.imports;
    if (Array.isArray(context.functions)) result.functions = context.functions;
    if (Array.isArray(context.variables)) result.variables = context.variables;

    return result;
  }

  private async generatePrefixSuggestions(ctx: string, language: string, maxTokens?: number): Promise<string[]> {
    const providerAny = this.ollamaProvider as any;
    
    if (typeof providerAny.completeCode === 'function') {
      const out = await providerAny.completeCode({ prefix: ctx, language, maxTokens });
      return Array.isArray(out) ? out : [];
    }

    const lines = ctx.split('\n');
    const line = Math.max(0, lines.length - 1);
    const character = lines[lines.length - 1]?.length ?? 0;
    const res = await this.ollamaProvider.generateCompletion({
      code: ctx,
      language,
      position: { line, character }
    });
    
    return (res.suggestions || []).map((s: any) =>
      typeof s === 'string' ? s : (s?.text ?? s?.completion ?? '')
    ).filter(Boolean);
  }

  private validateParams(params: unknown, expectedType: string): void {
    if (!params || typeof params !== expectedType) {
      throw new Error(`Invalid parameters: expected ${expectedType}`);
    }
  }



  private async handleCodeAnalysis(params: unknown): Promise<unknown> {
    return this.withErrorHandling(async () => {
      this.validateParams(params, 'object');
      const { code, language, analysisType } = params as {
        code?: string;
        language?: string;
        analysisType?: string;
      };

      if (!code || !language) {
        throw new Error('Missing required parameters: code, language');
      }

      const validTypes = ['explanation', 'refactoring', 'optimization', 'bugs'] as const;
      const normalizedType = validTypes.includes(analysisType as any) ? analysisType as typeof validTypes[number] : 'explanation';

      return await this.ollamaProvider.analyzeCode({
        code,
        language,
        analysisType: normalizedType
      });
    }, () => ({
      analysis: 'Analysis failed due to an error.',
      suggestions: [],
      confidence: 0,
      metadata: {
        model: this.config.model,
        processingTime: 0,
        error: 'Code analysis failed'
      }
    }));
  }



  private async handleCodeGeneration(params: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters object');
    }

    const p = params as {
      prompt?: string;
      language?: string;
      context?: Record<string, unknown>;
    };

    const { prompt, language, context } = p;

    if (!prompt || !language) {
      throw new Error('Missing required parameters: prompt, language');
    }

    let enhancedPrompt = prompt;
    if (context) {
      const contextStr = this.serializeContext(context);
      enhancedPrompt = `${prompt}\n\nContext: ${contextStr}`;
    }

    try {
      const generatedCode = await this.ollamaProvider.generateCode(enhancedPrompt, language);

      return {
        code: generatedCode,
        language,
        metadata: {
          prompt,
          context,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Code generation failed:', error);
      return {
        code: '',
        language,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          prompt,
          context,
          generatedAt: new Date().toISOString(),
        },
      };
    }
  }

  private async handleCodeExplanation(params: unknown): Promise<unknown> {
    try {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters object');
      }

      const p = params as {
        code?: string;
        language?: string;
        level?: string;
      };

      const { code, language, level = 'intermediate' } = p;

      if (!code || !language) {
        throw new Error('Missing required parameters: code, language');
      }

      const explanation = await this.ollamaProvider.explainCode(code, language);

      return {
        explanation,
        language,
        level,
        metadata: {
          codeLength: code.length,
          explainedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Code explanation failed:', error);

      const p = params as { code?: string; language?: string; level?: string };

      return {
        explanation: `Error explaining code: ${error instanceof Error ? error.message : String(error)}`,
        language: p.language || 'unknown',
        level: p.level || 'intermediate',
        metadata: {
          codeLength: p.code?.length || 0,
          explainedAt: new Date().toISOString(),
        },
      };
    }
  }

  private async handleContextAnalysis(params: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters object');
    }

    const p = params as {
      projectPath?: string;
      filePatterns?: string[];
      maxFiles?: number;
    };

    const { projectPath, filePatterns, maxFiles } = p;

    if (!projectPath) {
      throw new Error('Missing required parameter: projectPath');
    }

    try {
      const context = await this.contextManager.analyzeProject(projectPath, {
        filePatterns: filePatterns || ['**/*.js', '**/*.ts', '**/*.py', '**/*.java'],
        maxFiles: maxFiles || 50,
      });

      return context;
    } catch (error) {
      this.logger.error('Context analysis failed:', error);
      return {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
        analyzedAt: new Date().toISOString(),
      };
    }
  }

  private async handleRefactoringSuggestions(params: unknown): Promise<unknown> {
    try {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters object');
      }

      const p = params as {
        code?: string;
        language?: string;
        focusAreas?: string[];
      };

      const { code, language, focusAreas } = p;

      if (!code || !language) {
        throw new Error('Missing required parameters: code, language');
      }

      const analysisRequest: CodeAnalysisRequest = {
        code,
        language,
        analysisType: 'refactoring',
      };

      const analysis = await this.ollamaProvider.analyzeCode(analysisRequest);

      return {
        ...analysis,
        focusAreas: focusAreas || ['readability', 'maintainability'],
        refactoringType: 'suggestions',
      };
    } catch (error) {
      this.logger.error('Refactoring suggestions failed:', error);

      const p = params as { focusAreas?: string[] };

      return {
        analysis: 'Refactoring analysis failed due to an error.',
        suggestions: [],
        confidence: 0,
        focusAreas: p.focusAreas || ['readability', 'maintainability'],
        refactoringType: 'suggestions',
        metadata: {
          model: this.config.model,
          processingTime: 0,
        },
      };
    }
  }

  // UTILITY METHODS FOR ERROR FIXING

  private async rankAndValidateFixes(fixes: unknown[], request: ErrorFixRequest): Promise<unknown[]> {
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
        const validation = await this.validateFix(
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
        this.logger.warn('Failed to validate fix:', error);
        rankedFixes.push({
          ...fix,
          validationScore: 0,
          isValidated: false,
          validationDetails: 'Validation failed'
        });
      }
    }

    // Sort by validation score and confidence
    return rankedFixes.sort((a, b) => {
      const aObj = a as { validationScore?: number; confidence?: number };
      const bObj = b as { validationScore?: number; confidence?: number };

      const scoreA = ((aObj.validationScore || 0) * 0.7) + ((aObj.confidence || 0) * 0.3);
      const scoreB = ((bObj.validationScore || 0) * 0.7) + ((bObj.confidence || 0) * 0.3);
      return scoreB - scoreA;
    });
  }

  private async validateFix(
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
      // Use Ollama to validate the fix
      const validationResult = await this.ollamaProvider.validateCodeFix({
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
      this.logger.error('Error validating fix:', error);
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

  private prioritizeErrors(errors: unknown[], prioritizeBy: string): unknown[] {
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

  private calculateDiagnosticSummary(diagnostics: unknown[]): {
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
      summary.totalIssues++;

      switch (diagObj.severity) {
        case 'error':
          summary.errorCount++;
          break;
        case 'warning':
          summary.warningCount++;
          break;
        case 'info':
          summary.infoCount++;
          break;
        default:
          summary.infoCount++;
          break;
      }
    }

    return summary;
  }

  private generateCacheKey(prefix: string, params: unknown): string {
    try {
      const key = `${prefix}:${JSON.stringify(params)}`;
      return key.length > 250 ? `${prefix}:${this.hashParams(params)}` : key;
    } catch {
      return `${prefix}:${Date.now()}`;
    }
  }

  private hashParams(params: unknown): string {
    try {
      return Buffer.from(JSON.stringify(params)).toString('base64').substring(0, 50);
    } catch {
      return Math.random().toString(36).substring(7);
    }
  }

  private serializeContext(context: Record<string, unknown>): string {
    try {
      // Limit context size to prevent performance issues
      const limitedContext: Record<string, unknown> = {};
      let charCount = 0;
      const maxChars = 2000;
      
      for (const [key, value] of Object.entries(context)) {
        if (charCount >= maxChars) break;
        
        let serializedValue: unknown;
        if (typeof value === 'string') {
          serializedValue = value.substring(0, 500);
        } else if (Array.isArray(value)) {
          serializedValue = value.slice(0, 10);
        } else {
          serializedValue = value;
        }
        
        // Cache the serialized string to avoid double serialization
        const serialized = JSON.stringify(serializedValue);
        limitedContext[key] = serializedValue;
        charCount += serialized.length;
      }
      
      return JSON.stringify(limitedContext);
    } catch {
      return '{"error": "Context serialization failed"}';
    }
  }

  // RESOURCE HANDLERS

  private async getProjectContext(): Promise<unknown> {
    try {
      return await this.contextManager.getCurrentContext();
    } catch (error) {
      this.logger.error('Failed to get project context:', error);
      return {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }

  private async getCodePatterns(): Promise<unknown> {
    return {
      patterns: [
        {
          name: 'Singleton Pattern',
          language: 'typescript',
          description: 'Ensure a class has only one instance',
          example: 'class Singleton { private static instance: Singleton; }',
        },
        {
          name: 'Factory Pattern',
          language: 'typescript',
          description: 'Create objects without specifying exact classes',
          example: 'interface Factory { create(): Product; }',
        },
        {
          name: 'Observer Pattern',
          language: 'typescript',
          description: 'Define a one-to-many dependency between objects',
          example: 'interface Observer { update(data: any): void; }',
        },
        {
          name: 'Strategy Pattern',
          language: 'typescript',
          description: 'Define a family of algorithms and make them interchangeable',
          example: 'interface Strategy { execute(data: any): any; }',
        },
      ],
    };
  }

  private async getModelStatus(): Promise<unknown> {
    try {
      const [isHealthy, availableModels] = await Promise.all([
        this.ollamaProvider.healthCheck(),
        this.ollamaProvider.getAvailableModels()
      ]);

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        availableModels,
        currentModel: MCPServer.DEFAULT_MODEL,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Model status check failed: ${errorMessage}`);

      return {
        status: 'error',
        availableModels: [],
        currentModel: MCPServer.DEFAULT_MODEL,
        lastChecked: new Date().toISOString(),
        error: errorMessage
      };
    }
  }

  private async getErrorDatabase(): Promise<unknown> {
    return {
      commonErrors: [
        {
          pattern: "Cannot find module",
          language: "javascript",
          category: "import_error",
          solutions: [
            "Install the missing package using npm/yarn",
            "Check the import path spelling",
            "Verify the module exists in node_modules",
            "Update the package.json dependencies"
          ]
        },
        {
          pattern: "NameError: name '.*' is not defined",
          language: "python",
          category: "undefined_variable",
          solutions: [
            "Check variable spelling",
            "Ensure variable is declared before use",
            "Import the required module/function",
            "Check variable scope"
          ]
        },
        {
          pattern: "NullPointerException",
          language: "java",
          category: "null_reference",
          solutions: [
            "Add null checks before accessing object",
            "Initialize the object before use",
            "Use Optional<T> for nullable values",
            "Add defensive programming practices"
          ]
        },
        {
          pattern: "TypeError: Cannot read property .* of undefined",
          language: "javascript",
          category: "undefined_property",
          solutions: [
            "Add optional chaining (?.)",
            "Check if object exists before accessing property",
            "Initialize the object with default values",
            "Use nullish coalescing operator (??)"
          ]
        },
        {
          pattern: "IndentationError: expected an indented block",
          language: "python",
          category: "syntax_error",
          solutions: [
            "Add proper indentation (4 spaces or 1 tab)",
            "Ensure consistent indentation throughout",
            "Add pass statement for empty blocks",
            "Check for missing colons in control statements"
          ]
        },
        {
          pattern: "error: expected '.*' before",
          language: "cpp",
          category: "syntax_error",
          solutions: [
            "Add missing semicolon",
            "Check bracket/parenthesis matching",
            "Include required headers",
            "Fix syntax near the error location"
          ]
        }
      ],
      errorCategories: {
        "import_error": {
          description: "Issues with importing modules or packages",
          commonCauses: ["Missing dependencies", "Wrong import paths", "Module not found"],
          preventiveMeasures: ["Use dependency management tools", "Verify import paths", "Keep dependencies updated"]
        },
        "syntax_error": {
          description: "Code syntax violations",
          commonCauses: ["Missing punctuation", "Incorrect indentation", "Invalid syntax"],
          preventiveMeasures: ["Use IDE syntax highlighting", "Enable linting", "Follow style guides"]
        },
        "type_error": {
          description: "Type-related errors",
          commonCauses: ["Type mismatches", "Invalid operations on types", "Missing type annotations"],
          preventiveMeasures: ["Use static typing", "Add type hints", "Enable strict type checking"]
        },
        "runtime_error": {
          description: "Errors that occur during program execution",
          commonCauses: ["Null references", "Array bounds", "Resource access"],
          preventiveMeasures: ["Add error handling", "Validate inputs", "Use defensive programming"]
        }
      }
    };
  }

  private async getFixTemplates(): Promise<unknown> {
    return {
      javascript: {
        import_error: {
          template: "import { ${symbol} } from '${package}';",
          description: "Fix import statement",
          variables: ["symbol", "package"]
        },
        undefined_variable: {
          template: "const ${variable} = ${defaultValue};",
          description: "Declare missing variable",
          variables: ["variable", "defaultValue"]
        },
        null_check: {
          template: "if (${object} && ${object}.${property}) { ${code} }",
          description: "Add null check",
          variables: ["object", "property", "code"]
        }
      },
      python: {
        import_error: {
          template: "from ${module} import ${symbol}",
          description: "Fix import statement",
          variables: ["module", "symbol"]
        },
        undefined_variable: {
          template: "${variable} = ${defaultValue}",
          description: "Declare missing variable",
          variables: ["variable", "defaultValue"]
        },
        indentation_error: {
          template: "    ${code}",
          description: "Fix indentation",
          variables: ["code"]
        }
      },
      java: {
        import_error: {
          template: "import ${package}.${class};",
          description: "Add import statement",
          variables: ["package", "class"]
        },
        null_check: {
          template: "if (${object} != null) { ${code} }",
          description: "Add null check",
          variables: ["object", "code"]
        },
        exception_handling: {
          template: "try { ${code} } catch (${exception} e) { ${handler} }",
          description: "Add exception handling",
          variables: ["code", "exception", "handler"]
        }
      },
      typescript: {
        type_error: {
          template: "const ${variable}: ${type} = ${value};",
          description: "Add type annotation",
          variables: ["variable", "type", "value"]
        },
        optional_chaining: {
          template: "${object}?.${property}",
          description: "Use optional chaining",
          variables: ["object", "property"]
        },
        null_check: {
          template: "${object} ?? ${defaultValue}",
          description: "Use nullish coalescing",
          variables: ["object", "defaultValue"]
        }
      },
      cpp: {
        include_error: {
          template: "#include <${header}>",
          description: "Add include directive",
          variables: ["header"]
        },
        null_check: {
          template: "if (${pointer} != nullptr) { ${code} }",
          description: "Add null pointer check",
          variables: ["pointer", "code"]
        },
        memory_management: {
          template: "std::unique_ptr<${type}> ${variable} = std::make_unique<${type}>(${args});",
          description: "Use smart pointers",
          variables: ["type", "variable", "args"]
        }
      }
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Server is already running');
      return;
    }

    try {
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);
      this.isRunning = true;
      this.logger.info('Enhanced MCP Server with Auto Error Fixing started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to start MCP Server: ${errorMessage}`);
      throw new Error(`Server startup failed: ${errorMessage}`);
    }
  }

  async stop(): Promise<void> {
    try {
      await this.server.close();
      this.logger.info('MCP Server stopped');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to stop MCP Server: ${errorMessage}`);
      throw new Error(`Server shutdown failed: ${errorMessage}`);
    }
  }
}
