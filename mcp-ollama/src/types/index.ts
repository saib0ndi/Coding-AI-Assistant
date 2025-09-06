// Core MCP Types
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  handler: (params: any) => Promise<any>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => Promise<any>;
}

// Ollama Configuration
export interface OllamaConfig {
  host: string;
  model: string;
  timeout: number;
}

// AI Provider Interface
export interface AIProvider {
  generateCompletion(request: CodeCompletionRequest): Promise<CodeCompletionResponse>;
  analyzeCode(request: CodeAnalysisRequest): Promise<CodeAnalysisResponse>;
  generateCode(prompt: string, language: string): Promise<string>;
  explainCode(code: string, language: string): Promise<string>;
  healthCheck(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  generateErrorFixes(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): Promise<CodeFix[]>;
  generateQuickFixes(request: QuickFixRequest): Promise<any[]>;
  validateCodeFix(request: ValidationRequest): Promise<any>;
}

// Code Completion Types
export interface CodeCompletionRequest {
  code: string;
  language: string;
  position: {
    line: number;
    character: number;
  };
  context?: {
    fileName?: string;
    projectPath?: string;
    imports?: string[];
    functions?: string[];
    variables?: string[];
  };
}

export interface CodeCompletionResponse {
  suggestions: CodeSuggestion[];
  metadata: {
    model: string;
    processingTime: number;
    confidence: number;
  };
}

export interface CodeSuggestion {
  text: string;
  insertText: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertTextFormat?: InsertTextFormat;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25
}

export enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2
}

// Code Analysis Types
export interface CodeAnalysisRequest {
  code: string;
  language: string;
  analysisType: 'explanation' | 'refactoring' | 'optimization' | 'bugs';
}

export interface CodeAnalysisResponse {
  analysis: string;
  suggestions: string[];
  confidence: number;
  metadata: {
    model: string;
    processingTime: number;
  };
}

// Error Fixing Types
export interface ErrorFixRequest {
  errorMessage: string;
  code: string;
  language: string;
  filePath?: string;
  lineNumber?: number;
  stackTrace?: string;
  context?: {
    projectPath?: string;
    dependencies?: string[];
    framework?: string;
    buildTool?: string;
  };
}

export interface ErrorFixResponse {
  originalError: string;
  errorType: ErrorType;
  errorCategory: string;
  fixes: CodeFix[];
  recommendedFix: CodeFix | null;
  isValidated: boolean;
  validationDetails: string;
  metadata: {
    processingTime: number;
    confidence: number;
    alternativeFixesCount: number;
    errorAnalysisDetails: {
      type: ErrorType;
      category: string;
      severity: string;
      cause: string;
      affectedComponents: string[];
      suggestedApproach: string;
      complexity: string;
      confidence: number;
    } | null;
  };
}

export interface ErrorAnalysis {
  type: ErrorType;
  category: string;
  severity: 'error' | 'warning' | 'info';
  cause: string;
  affectedComponents: string[];
  suggestedApproach: string;
  complexity: 'low' | 'medium' | 'high';
  confidence: number;
}

// Additional types for ErrorAnalyzer
export interface ErrorPattern {
  pattern: RegExp;
  type: ErrorType;
  category: string;
  confidence: number;
  commonCauses: string[];
  solutions: string[];
}

export interface ErrorHistoryItem {
  type: string;
  timestamp: number;
  message?: string;
  severity?: string;
  resolved?: boolean;
}

export interface PatternAnalysisResult {
  commonPatterns: Array<{ type: string; count: number }>;
  statistics: {
    total: number;
    byType: Array<{ type: string; count: number }>;
    averagePerDay: number;
  };
  trends: Array<{ trend: string; description: string }>;
  preventiveRecommendations: string[];
}

export interface CodeFix {
  title: string;
  description: string;
  fixedCode: string;
  changes: CodeChange[];
  confidence: number;
  preservesSemantics: boolean;
  requiresUserReview: boolean;
  explanation: string;
  category: 'syntax' | 'logic' | 'performance' | 'security' | 'style';
}

export interface CodeChange {
  type: 'replace' | 'insert' | 'delete';
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  newText?: string;
  description: string;
}

export enum ErrorType {
  SYNTAX_ERROR = 'syntax_error',
  TYPE_ERROR = 'type_error',
  IMPORT_ERROR = 'import_error',
  UNDEFINED_VARIABLE = 'undefined_variable',
  MISSING_DEPENDENCY = 'missing_dependency',
  DEPRECATED_API = 'deprecated_api',
  SECURITY_ISSUE = 'security_issue',
  PERFORMANCE_ISSUE = 'performance_issue',
  RUNTIME_ERROR = 'runtime_error',
  COMPILATION_ERROR = 'compilation_error',
  UNKNOWN = 'unknown'
}

// Quick Fix Types
export interface QuickFixRequest {
  code: string;
  language: string;
  issueType: 'syntax_error' | 'type_error' | 'import_error' | 'undefined_variable' | 'missing_dependency' | 'deprecated_api' | 'security_issue' | 'performance_issue';
  issueDescription: string;
  lineNumber?: number;
  severity?: 'error' | 'warning' | 'info' | 'hint';
}

// Validation Types
export interface ValidationRequest {
  originalCode: string;
  fixedCode: string;
  language: string;
  originalError: string;
  testCases?: string[];
}

// Diagnostic Types
export interface DiagnosticRequest {
  code: string;
  language: string;
  filePath?: string;
  checkTypes?: ('syntax' | 'semantic' | 'style' | 'security' | 'performance' | 'all')[];
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  line: number;
  column: number;
  type: string;
  code?: string;
  source?: string;
  quickFix?: any;
}

// Context Management Types
export interface ContextData {
  currentFile: {
    path: string;
    content: string;
    language: string;
  };
  projectFiles: Array<{
    path: string;
    content: string;
    language: string;
  }>;
  dependencies: string[];
  gitContext?: {
    branch: string;
    recentCommits: string[];
  };
}
