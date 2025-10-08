import { MCPServer } from './MCPServer.js';
import { Symbol } from '../lsp/LSPClient.js';
import { BuildTool } from '../tools/BuildTool.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { GitTool } from '../tools/GitTool.js';
import { WorkflowExecutor } from '../workflows/WorkflowExecutor.js';

export class MCPServerEnhanced extends MCPServer {
  private buildTool: BuildTool;
  private fileSystemTool: FileSystemTool;
  private gitTool: GitTool;
  private workflowExecutor: WorkflowExecutor;

  constructor(config: any) {
    super(config);
    this.buildTool = new BuildTool();
    this.fileSystemTool = new FileSystemTool();
    this.gitTool = new GitTool();
    this.workflowExecutor = new WorkflowExecutor(new Map<string, any>([
      ['build', this.buildTool],
      ['file', this.fileSystemTool],
      ['git', this.gitTool]
    ]));
  }
  
  // Enhanced code completion with LSP integration
  async enhancedCodeCompletion(request: any): Promise<any> {
    const { code, language, context, filePath = 'temp.file' } = request;
    
    // Get LSP diagnostics and symbols
    const [diagnostics, symbols] = await Promise.all([
      (this as any).lspClient.getDiagnostics(filePath, code, language),
      (this as any).lspClient.getSymbols(filePath, code)
    ]);
    
    // Generate completion with LSP context
    const completion = await (this as any).ollamaProvider.generateText({
      prompt: `Complete this ${language} code with context:\nSymbols: ${symbols.map((s: any) => s.name).join(', ')}\nCode:\n${code}`,
      model: 'deepseek-coder-v2:236b'
    });
    
    // Format and validate
    const formatted = await (this as any).codeFormatter.formatCode(completion, language);
    const quality = await (this as any).qualityFilter.scoreResponse(formatted, language, context);
    const securityIssues = await (this as any).securityScanner.scanCode(formatted, language);
    
    return {
      code: formatted,
      quality: quality.overall,
      diagnostics,
      symbols,
      securityIssues,
      isValid: quality.overall >= 0.6 && securityIssues.length === 0,
      lspIntegrated: true
    };
  }
  
  // Enhanced semantic search with LSP symbols
  async enhancedSemanticSearch(request: any): Promise<any> {
    const { query, language, limit = 5, filePath } = request;
    
    // Get symbols for context if file provided
    let symbols: Symbol[] = [];
    if (filePath) {
      const fileContent = await this.readFileContent(filePath);
      symbols = await (this as any).lspClient.getSymbols(filePath, fileContent);
    }
    
    const results = await (this as any).vectorStore.search(query, limit);
    
    return {
      matches: results,
      count: results.length,
      symbols: symbols.slice(0, 10),
      contextEnhanced: symbols.length > 0
    };
  }
  
  // Comprehensive code analysis with LSP integration
  async enhancedCodeAnalysis(request: any): Promise<any> {
    const { code, language, filePath = 'temp.file' } = request;
    
    // Parallel analysis with LSP integration
    const [diagnostics, symbols, securityIssues, quality] = await Promise.all([
      (this as any).lspClient.getDiagnostics(filePath, code, language),
      (this as any).lspClient.getSymbols(filePath, code),
      (this as any).securityScanner.scanCode(code, language),
      (this as any).qualityFilter.scoreResponse(code, language)
    ]);
    
    return {
      diagnostics,
      symbols,
      securityIssues,
      quality,
      summary: {
        errorCount: diagnostics.filter((d: any) => d.severity === 'error').length,
        warningCount: diagnostics.filter((d: any) => d.severity === 'warning').length,
        securityIssueCount: securityIssues.length,
        qualityScore: quality.overall,
        symbolCount: symbols.length
      },
      lspIntegrated: true
    };
  }

  // Real-time diagnostics with LSP
  async realTimeDiagnostics(request: any): Promise<any> {
    const { code, language, filePath = 'temp.file', position } = request;
    
    const diagnostics = await (this as any).lspClient.getDiagnostics(filePath, code, language);
    
    // Filter diagnostics by position if provided
    const relevantDiagnostics = position 
      ? diagnostics.filter((d: any) => 
          d.range.start.line <= position.line && 
          d.range.end.line >= position.line
        )
      : diagnostics;
    
    return {
      diagnostics: relevantDiagnostics,
      totalDiagnostics: diagnostics.length,
      position,
      timestamp: new Date().toISOString()
    };
  }

  // Symbol-aware code completion
  async symbolAwareCompletion(request: any): Promise<any> {
    const { code, language, position, filePath = 'temp.file' } = request;
    
    const symbols = await (this as any).lspClient.getSymbols(filePath, code);
    const availableSymbols = symbols.map((s: any) => `${s.kind}: ${s.name}`).join('\n');
    
    const completion = await (this as any).ollamaProvider.generateText({
      prompt: `Complete ${language} code at line ${position.line}:\nAvailable symbols:\n${availableSymbols}\n\nCode:\n${code}`,
      model: 'deepseek-coder-v2:236b'
    });
    
    return {
      completion,
      symbols: symbols.slice(0, 20),
      position,
      symbolContext: true
    };
  }

  // VS Code Extension Integration
  async handleVSCodeLSPIntegration(request: any): Promise<any> {
    const { uri, position, language, action } = request;
    
    switch (action) {
      case 'diagnostics':
        return await this.realTimeDiagnostics({ code: request.code, language, filePath: uri, position });
      case 'symbols':
        return await (this as any).lspClient.getSymbols(uri, request.code);
      case 'completion':
        return await this.symbolAwareCompletion({ code: request.code, language, position, filePath: uri });
      default:
        throw new Error(`Unknown LSP action: ${action}`);
    }
  }

  async handleResponseValidation(request: any): Promise<any> {
    const { code, language, context } = request;
    const quality = await (this as any).qualityFilter.scoreResponse(code, language, context);
    
    return {
      isValid: quality.overall >= 0.6,
      score: quality.overall,
      issues: quality.issues || [],
      suggestions: quality.suggestions || [],
      details: quality
    };
  }

  async handleSemanticProvider(request: any): Promise<any> {
    const { query, language, workspacePath } = request;
    const results = await (this as any).vectorStore.search(query, 10);
    
    return {
      matches: results.map((r: any) => ({
        code: r.content || r.text,
        similarity: r.score || 0.8,
        location: { uri: r.filePath || 'unknown', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
      })),
      total: results.length
    };
  }

  // Build Tool Integration
  async handleBuildOperation(request: any): Promise<any> {
    const { operation, workspacePath, script, requirements } = request;
    
    switch (operation) {
      case 'install':
        return { result: await this.buildTool.installDependencies(workspacePath) };
      case 'test':
        return { result: await this.buildTool.runTests(workspacePath) };
      case 'build':
        return { result: await this.buildTool.npmBuild(workspacePath) };
      case 'detect':
        return { buildSystem: await this.buildTool.detectBuildSystem(workspacePath) };
      default:
        throw new Error(`Unknown build operation: ${operation}`);
    }
  }

  // Workflow Execution
  async handleWorkflowExecution(request: any): Promise<any> {
    const { plan, context } = request;
    return await this.workflowExecutor.executeWorkflow(plan, context);
  }

  // File System Operations
  async handleFileSystemOperation(request: any): Promise<any> {
    const { operation, path, content } = request;
    
    try {
      switch (operation) {
        case 'read':
          return { content: await this.fileSystemTool.readFile(path) };
        case 'write':
          await this.fileSystemTool.writeFile(path, content);
          return { success: true };
        case 'exists':
          return { exists: await this.fileSystemTool.fileExists(path) };
        default:
          throw new Error(`Unknown file operation: ${operation}`);
      }
    } catch (error) {
      throw new Error(`File operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Git Operations
  async handleGitOperation(request: any): Promise<any> {
    const { operation, workspacePath, message, branch } = request;
    
    switch (operation) {
      case 'status':
        return { result: await this.gitTool.status(workspacePath) };
      case 'commit':
        return { result: await this.gitTool.commit(workspacePath, message) };
      case 'branch':
        return { result: await this.gitTool.createBranch(workspacePath, branch) };
      case 'diff':
        return { result: await this.gitTool.diff(workspacePath) };
      default:
        throw new Error(`Unknown git operation: ${operation}`);
    }
  }

  private async readFileContent(filePath: string): Promise<string> {
    return await this.fileSystemTool.readFile(filePath);
  }
}