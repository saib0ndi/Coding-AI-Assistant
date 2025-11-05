import fetch, { RequestInit, Response } from 'node-fetch';
import nlp from 'compromise';
// Use built-in AbortController for Node.js 16+
const AbortController = globalThis.AbortController;

type OllamaGenerateResponse = {
  response?: string;
  model?: string;
  created_at?: string;
  done?: boolean;
  total_duration?: number;
};
import {
  AIProvider,
  OllamaConfig,
  CodeCompletionRequest,
  CodeCompletionResponse,
  CodeAnalysisRequest,
  CodeAnalysisResponse,
  CodeSuggestion,
  CompletionItemKind,
  InsertTextFormat,
  ErrorFixRequest,
  ErrorAnalysis,
  CodeFix,
  CodeChange,
  QuickFixRequest,
  ValidationRequest,
} from '../types/index.js';

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export class OllamaProvider implements AIProvider {
  private config: OllamaConfig;
  private validatedHost: string;

  private memoryLimit = 1024 * 1024 * 1024; // 1GB
  private lastCleanup = Date.now();
  private resultCache = new Map<string, {result: string, timestamp: number}>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private monitoringInterval?: ReturnType<typeof setInterval>;

  constructor(config: OllamaConfig) {
    this.validatedHost = this.validateAndSanitizeHost(config.host);
    this.config = { ...config, host: this.validatedHost };
    console.log(`[OllamaProvider] Initialized with host: ${this.validatedHost}`);
    
    // Only start monitoring if explicitly enabled
    if (typeof process !== 'undefined' && process.env?.ENABLE_MEMORY_MONITORING === 'true') {
      this.startResourceMonitoring();
    }
  }

  private startResourceMonitoring(): void {
    // Only run monitoring if explicitly enabled
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 300000); // Check every 5 minutes instead of 30 seconds
  }

  public stopResourceMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined as any;
    }
  }

  private checkMemoryUsage(): boolean {
    if (typeof process === 'undefined') return true;
    const usage = process.memoryUsage();
    if (usage.heapUsed > this.memoryLimit) {
      console.log(`Memory usage high: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
      this.triggerCleanup();
      return false;
    }
    return true;
  }

  private triggerCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < 60000) return;
    
    console.log('Triggering memory cleanup...');
    
    // Clean expired cache entries
    this.resultCache.forEach((entry, key) => {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.resultCache.delete(key);
      }
    });
    
    // Limit cache size 
    if (this.resultCache.size > 100) {
      const entries = Array.from(this.resultCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50);
      this.resultCache.clear();
      entries.forEach(([key, value]) => this.resultCache.set(key, value));
    }
    
    // Force garbage collection if available
    if (typeof global !== 'undefined' && (global as any).gc) {
      (global as any).gc();
    }
    
    this.lastCleanup = now;
  }

  private validateAndSanitizeHost(host: string): string {
    if (!host || typeof host !== 'string') {
      throw new Error('Invalid host: must be a non-empty string');
    }

    try {
      const url = new URL(host);
      
      // Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid protocol: only HTTP and HTTPS are allowed');
      }

      // Allow localhost for development and specific Ollama server
      const hostname = url.hostname.toLowerCase();
      const allowedHosts = ['localhost', '127.0.0.1', '::1', '10.10.110.25'];
      
      if (!allowedHosts.includes(hostname) && this.isPrivateIP(hostname)) {
        throw new Error('Access to private IP ranges is not allowed');
      }

      // Block metadata services
      if (['169.254.169.254', 'metadata.google.internal'].includes(hostname)) {
        throw new Error('Access to metadata services is not allowed');
      }

      return url.origin;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`Invalid URL format: ${host}`);
      }
      throw error;
    }
  }

  private isPrivateIP(hostname: string): boolean {
    // IPv4 private ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    
    if (match) {
      const [, a, b, c, d] = match.map(Number);
      
      // 10.0.0.0/8
      if (a === 10) return true;
      
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;
    }
    
    return false;
  }

  async generateText({
    prompt,
    model,
    stream = false,
  }: {
    prompt: string;
    model?: string;
    stream?: boolean;
  }): Promise<string> {
    try {
      // Use streaming for large prompts
      if (prompt.length > 10000 || stream) {
        return await this.generateTextStreaming(prompt, model || this.config.model);
      }
      
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, '');
      const data = await this.callOllamaWithRetry({
        model: model || this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);
      return data.response || '';
    } catch (error) {
      console.error('Text generation failed:', error);
      return `I'm unable to generate text right now as the Ollama server is not available. Please ensure Ollama is running and try again.`;
    }
  }

  /**
   * Generate text with streaming for large responses
   */
  private async generateTextStreaming(prompt: string, model: string): Promise<string> {
    const chunks: string[] = [];
    const timeout = this.calculateDynamicTimeout(prompt, '');
    
    try {
      const response = await fetchWithTimeout(
        `${this.validatedHost}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, stream: true }),
        },
        timeout
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const reader = (response.body as any)?.getReader();
      if (!reader) throw new Error('No response body');
      
      const decoder = new TextDecoder();
      let buffer = '';
      const maxBufferSize = 1024 * 1024; // 1MB buffer limit
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        
        // Prevent buffer overflow
        if (buffer.length + chunk.length > maxBufferSize) {
          console.warn('Buffer overflow prevented, processing partial data');
          break;
        }
        
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                chunks.push(data.response);
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      }
      
      return chunks.join('');
    } catch (error) {
      console.error('Streaming generation failed:', error);
      // Fallback to non-streaming
      const data = await this.callOllamaWithRetry({ model, prompt, stream: false }, timeout);
      return data.response || '';
    }
  }

  async generateTextWithModel({
    prompt,
    model,
    stream = false,
  }: {
    prompt: string;
    model: string;
    stream?: boolean;
  }): Promise<string> {
    const dynamicTimeout = this.calculateDynamicTimeout(prompt, '');
    const data = await this.callOllamaWithTimeout({
      model: model,
      prompt,
      stream,
    }, dynamicTimeout);
    return data.response || '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(
        `${this.validatedHost}/api/tags`,
        { method: 'GET' },
        this.config.timeout || 30000
      );
      return res.ok;
    } catch (error) {
      console.error('Ollama health check failed:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetchWithTimeout(
        `${this.validatedHost}/api/tags`,
        { method: 'GET' },
        this.config.timeout || 30000
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as any;
      return (data && data.models && data.models.map((m: any) => m && m.name).filter(Boolean)) || [];
    } catch (error) {
      console.error('Failed to get available models:', error);
      return [];
    }
  }

  async generateCompletion(request: CodeCompletionRequest): Promise<CodeCompletionResponse> {
    const startTime = Date.now();

    try {
      const prompt = this.buildCompletionPrompt(request);
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, request.code);
      
      const response = await this.callOllamaWithRetry({
        model: this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      const suggestions = this.parseCompletionResponse(response);
      const processingTime = Date.now() - startTime;

      return {
        suggestions,
        metadata: {
          model: this.config.model,
          processingTime,
          confidence: this.calculateConfidence(suggestions),
        },
      };
    } catch (error) {
      console.error('Code completion failed:', error);
      return {
        suggestions: [],
        metadata: {
          model: this.config.model,
          processingTime: Date.now() - startTime,
          confidence: 0,
        },
      };
    }
  }

  async analyzeCode(request: CodeAnalysisRequest): Promise<CodeAnalysisResponse> {
    const startTime = Date.now();

    try {
      const prompt = this.buildAnalysisPrompt(request);
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, request.code);
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      const analysis = this.parseAnalysisResponse(response);
      const processingTime = Date.now() - startTime;

      return {
        analysis: analysis.explanation,
        suggestions: analysis.suggestions || [],
        confidence: this.calculateAnalysisConfidence(analysis.explanation),
        metadata: {
          model: this.config.model,
          processingTime,
        },
      };
    } catch (error) {
      console.error('Code analysis failed:', error);
      return {
        analysis: 'Analysis failed due to an error.',
        suggestions: [],
        confidence: 0,
        metadata: {
          model: this.config.model,
          processingTime: Date.now() - startTime,
        },
      };
    }
  }

  async generateCode(prompt: string, language: string): Promise<string> {
    try {
      const enhancedPrompt = `You are a coding assistant. Generate complete, production-ready ${language} code for the following request. Generate comprehensive code with all necessary functions, classes, imports, and implementations. Do not truncate or summarize - provide the full working code:

${prompt}

Generate complete ${language} code:`;
      
      const dynamicTimeout = this.calculateDynamicTimeout(enhancedPrompt, '');
      
      // Use streaming for large code generation
      if (prompt.includes('large') || prompt.includes('complete') || prompt.includes('full')) {
        return await this.generateLargeCode(enhancedPrompt, language);
      }
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt: enhancedPrompt,
        stream: false,
        options: {
          num_predict: 4000, // Allow longer outputs
          temperature: 0.2,
          top_p: 0.9
        }
      }, dynamicTimeout);

      return this.cleanGeneratedCode((response && response.response) || 'Failed to generate code');
    } catch (error) {
      console.error('Code generation failed:', error);
      return `// Error generating code: ${error}`;
    }
  }

  async explainCode(code: string, language: string): Promise<string> {
    try {
      // Handle large code inputs (1500+ lines or 30K+ chars)
      const lines = code.split('\n').length;
      if (lines > 1500 || code.length > 30000) {
        return await this.explainLargeCode(code, language);
      }
      
      const prompt = `You are a coding assistant. Explain the following ${language} code in a clear, conversational way without using markdown symbols, asterisks, or special formatting characters. Write like you're explaining to a colleague:

${code}

Explain what this code does, how it works, and any important details:`;
      
      // Calculate dynamic timeout based on request complexity
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, code);
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.formatGracefulResponse(response?.response || 'Failed to explain code');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Code explanation failed:', errorMessage);
      
      // Return a helpful fallback explanation
      if (errorMessage.includes('timeout')) {
        return `This ${language} code appears to be a complex piece that would take some time to analyze fully. The code contains various programming constructs and logic that work together to perform specific functionality.`;
      }
      
      return `Error explaining code: ${errorMessage}`;
    }
  }

  async explainCodeWithModel(code: string, language: string, model: string): Promise<string> {
    try {
      // Use full code for explanation (no truncation)
      const truncatedCode = code;
      
      const prompt = `You are a coding assistant. Explain the following ${language} code in a clear, conversational way without using markdown symbols, asterisks, or special formatting characters. Write like you're explaining to a colleague:

${truncatedCode}

Explain what this code does, how it works, and any important details:`;
      
      // Calculate dynamic timeout based on request complexity
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, code);
      
      const response = await this.callOllamaWithTimeout({
        model: model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.formatGracefulResponse(response?.response || 'Failed to explain code');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Code explanation failed:', errorMessage);
      
      // Return a helpful fallback explanation
      if (errorMessage.includes('timeout')) {
        return `This ${language} code appears to be a complex piece that would take some time to analyze fully. The code contains various programming constructs and logic that work together to perform specific functionality.`;
      }
      
      return `Error explaining code: ${errorMessage}`;
    }
  }

  async generateErrorFixes(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): Promise<CodeFix[]> {
    try {
      const prompt = this.buildErrorFixPrompt(request, errorAnalysis);
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, request.code);
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.parseErrorFixResponse(response, request);
    } catch (error) {
      console.error('Error fix generation failed:', error);
      // Return fallback fix based on error type
      return this.generateFallbackFix(request, errorAnalysis);
    }
  }

  async generateErrorFixesWithModel(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis, model: string): Promise<CodeFix[]> {
    try {
      const prompt = this.buildErrorFixPrompt(request, errorAnalysis);
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, request.code);
      
      const response = await this.callOllamaWithTimeout({
        model: model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.parseErrorFixResponse(response, request);
    } catch (error) {
      console.error('Error fix generation failed:', error);
      return this.generateFallbackFix(request, errorAnalysis);
    }
  }

  async generateQuickFixes(request: QuickFixRequest): Promise<any[]> {
    try {
      const prompt = this.buildQuickFixPrompt(request);
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, request.code);
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.parseQuickFixResponse(response);
    } catch (error) {
      console.error('Quick fix generation failed:', error);
      return [];
    }
  }

  async generateQuickFixesWithModel(request: QuickFixRequest, model: string): Promise<any[]> {
    try {
      const prompt = this.buildQuickFixPrompt(request);
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, request.code);
      
      const response = await this.callOllamaWithTimeout({
        model: model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.parseQuickFixResponse(response);
    } catch (error) {
      console.error('Quick fix generation failed:', error);
      return [];
    }
  }

  async validateCodeFix(request: ValidationRequest): Promise<any> {
    try {
      const prompt = this.buildValidationPrompt(request);
      const combinedCode = request.originalCode + '\n' + request.fixedCode;
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, combinedCode);
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.parseValidationResponse(response);
    } catch (error) {
      console.error('Code fix validation failed:', error);
      return {
        isValid: false,
        confidence: 0,
        explanation: `Validation failed: ${error}`,
        potentialIssues: ['Validation process failed'],
        semanticPreservation: false,
        testResults: []
      };
    }
  }

  async validateCodeFixWithModel(request: ValidationRequest, model: string): Promise<any> {
    try {
      const prompt = this.buildValidationPrompt(request);
      const combinedCode = request.originalCode + '\n' + request.fixedCode;
      const dynamicTimeout = this.calculateDynamicTimeout(prompt, combinedCode);
      
      const response = await this.callOllamaWithTimeout({
        model: model,
        prompt,
        stream: false,
      }, dynamicTimeout);

      return this.parseValidationResponse(response);
    } catch (error) {
      console.error('Code fix validation failed:', error);
      return {
        isValid: false,
        confidence: 0,
        explanation: `Validation failed: ${error}`,
        potentialIssues: ['Validation process failed'],
        semanticPreservation: false,
        testResults: []
      };
    }
  }

  // Private helper methods

  private async callOllamaWithRetry(
    params: { model: string; prompt: string; stream?: boolean },
    timeoutMs: number,
    maxRetries: number = 3
  ): Promise<OllamaGenerateResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.callOllamaWithTimeout(params, timeoutMs);
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on non-transient errors
        if (error instanceof Error && (error.message.includes('404') || error.message.includes('401'))) {
          throw error;
        }
        
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  private async callOllamaWithTimeout(params: {
    model: string;
    prompt: string;
    stream?: boolean;
    options?: any;
  }, timeoutMs: number): Promise<OllamaGenerateResponse> {
    // Extended timeout for large code generation
    const boundedTimeout = Math.min(Math.max(timeoutMs, 30000), 600000); // 30s min, 10min max
    
    let res: Response;
    try {
      console.log(`[OllamaProvider] Making request to: ${this.validatedHost}/api/generate`);
      res = await fetchWithTimeout(
        `${this.validatedHost}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            // Enhanced options for large code generation
            options: {
              num_predict: params.options?.num_predict || 4000, // Allow much longer outputs
              temperature: params.options?.temperature || 0.3,
              top_p: params.options?.top_p || 0.8,
              repeat_penalty: 1.1,
              stop: [] // Don't stop early
            }
          }),
        },
        boundedTimeout
      );
    } catch (e: unknown) {
      const err = e as Error;
      if (err && (err.name === 'AbortError' || err.message.includes('timeout'))) {
        throw new Error(`Request timed out after ${boundedTimeout}ms. Try with shorter code.`);
      }
      throw new Error(`Ollama request failed: ${(err && err.message) || String(e)}`);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
    }

    return (await res.json()) as OllamaGenerateResponse;
  }

  private buildCompletionPrompt(request: CodeCompletionRequest): string {
    const { code, language, position } = request;
    const lines = code.split('\n');

    const safeLine = Math.max(0, Math.min(position.line, lines.length - 1));
    const currentLine = lines[safeLine] || '';
    const safeChar = Math.max(0, Math.min(position.character, currentLine.length));
    const beforeCursor = currentLine.slice(0, safeChar);
    const afterCursor  = currentLine.slice(safeChar);

    return `Complete the following ${language} code at the cursor position (marked with <CURSOR>):

\`\`\`${language}
${lines.slice(0, safeLine).join('\n')}
${beforeCursor}<CURSOR>${afterCursor}
${lines.slice(safeLine + 1).join('\n')}
\`\`\`

Provide only the completion text that should be inserted at the cursor position:`;
  }

  private buildAnalysisPrompt(request: CodeAnalysisRequest): string {
    const { code, language, analysisType } = request;
    
    const prompts = {
      explanation: `You are a helpful coding assistant. Explain what the following ${language} code does in a clear, conversational way without using markdown symbols or special formatting:`,
      refactoring: `You are a helpful coding assistant. Suggest refactoring improvements for the following ${language} code in a clear, conversational way:`,
      optimization: `You are a helpful coding assistant. Suggest performance optimizations for the following ${language} code in a clear, conversational way:`,
      bugs: `You are a helpful coding assistant. Identify potential bugs and issues in the following ${language} code in a clear, conversational way:`,
    };

    return `${prompts[analysisType]}

${code}

Provide a detailed analysis:`;
  }

  private buildErrorFixPrompt(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): string {
    return `Fix this ${request.language} error:

Error: ${request.errorMessage}
Code: ${request.code}

Provide only the fixed code:`;
  }

  private buildQuickFixPrompt(request: QuickFixRequest): string {
    return `Provide quick fixes for the following ${request.language} code issue:

Issue Type: ${request.issueType}
Description: ${request.issueDescription}
${request.lineNumber ? `Line: ${request.lineNumber}` : ''}

Code:
\`\`\`${request.language}
${request.code}
\`\`\`

Provide multiple quick fix options:`;
  }

  // AI Project Planning and Execution Methods
  async generateProjectPlan(userInput: string, context?: any): Promise<{
    projectName: string;
    description: string;
    plan: Array<{step: number; task: string; files: string[]; estimated: string}>;
    technologies: string[];
    structure: any;
    confirmation: string;
  }> {
    const prompt = `You are an intelligent AI project planner. User wants: "${userInput}"

Generate a comprehensive project plan with:
1. Project name and description
2. Step-by-step implementation plan
3. Required technologies
4. File structure
5. Ask for user confirmation

Format as JSON with fields: projectName, description, plan (array of {step, task, files, estimated}), technologies, structure, confirmation`;

    try {
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt,
        stream: false
      }, 60000);

      return this.parseProjectPlan(response.response || '', userInput);
    } catch (error) {
      return this.generateFallbackPlan(userInput);
    }
  }

  async executeProjectPlan(plan: any, userApproval: boolean = false): Promise<{
    success: boolean;
    steps: Array<{id: string; status: string; result?: string}>;
    summary: string;
    filesCreated: string[];
  }> {
    if (!userApproval) {
      return {
        success: false,
        steps: [],
        summary: 'User approval required before execution',
        filesCreated: []
      };
    }

    const results = {
      success: true,
      steps: [] as Array<{id: string; status: string; result?: string}>,
      summary: '',
      filesCreated: [] as string[]
    };

    for (const [index, step] of plan.plan.entries()) {
      try {
        const stepResult = await this.executeProjectStep(step, plan.projectName);
        results.steps.push({
          id: `step_${index + 1}`,
          status: stepResult.success ? 'completed' : 'failed',
          result: stepResult.message
        });
        
        if (stepResult.filesCreated) {
          results.filesCreated.push(...stepResult.filesCreated);
        }
      } catch (error) {
        results.steps.push({
          id: `step_${index + 1}`,
          status: 'failed',
          result: error instanceof Error ? error.message : 'Unknown error'
        });
        results.success = false;
      }
    }

    results.summary = `Project '${plan.projectName}' execution ${results.success ? 'completed' : 'partially completed'}. ${results.filesCreated.length} files created.`;
    return results;
  }

  private parseProjectPlan(response: string, userInput: string): any {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {}

    // Fallback parsing
    return this.generateFallbackPlan(userInput);
  }

  private generateFallbackPlan(userInput: string): any {
    const projectName = this.extractProjectName(userInput);
    return {
      projectName,
      description: `A ${projectName} application based on user requirements`,
      plan: [
        { step: 1, task: 'Create project structure', files: ['package.json', 'src/'], estimated: '5 min' },
        { step: 2, task: 'Setup main application files', files: ['src/index.ts', 'src/app.ts'], estimated: '10 min' },
        { step: 3, task: 'Implement core functionality', files: ['src/components/', 'src/utils/'], estimated: '20 min' },
        { step: 4, task: 'Add configuration and documentation', files: ['README.md', 'tsconfig.json'], estimated: '5 min' }
      ],
      technologies: ['TypeScript', 'Node.js'],
      structure: {
        'src/': 'Main source code',
        'src/components/': 'Reusable components',
        'src/utils/': 'Utility functions',
        'package.json': 'Project dependencies',
        'README.md': 'Project documentation'
      },
      confirmation: `I've created a plan for your ${projectName} project. This will create a TypeScript application with a clean structure. Can I start creating this project with proper planning?`
    };
  }

  private extractProjectName(input: string): string {
    const match = input.match(/(?:project|application|app)\s+(?:called|named)?\s*([\w\s-]+)/i);
    if (match) {
      return match[1].trim().replace(/\s+/g, '-').toLowerCase();
    }
    return 'web-application';
  }

  private async executeProjectStep(step: any, projectName: string): Promise<{
    success: boolean;
    message: string;
    filesCreated?: string[];
  }> {
    const fs = await import('fs');
    const path = await import('path');
    const filesCreated: string[] = [];

    try {
      // Create project directory if it doesn't exist
      const projectDir = path.resolve(projectName);
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
        filesCreated.push(projectDir);
      }

      // Create files specified in the step
      for (const file of step.files || []) {
        const filePath = path.join(projectDir, file);
        
        if (file.endsWith('/')) {
          // It's a directory
          if (!fs.existsSync(filePath)) {
            fs.mkdirSync(filePath, { recursive: true });
            filesCreated.push(filePath);
          }
        } else {
          // It's a file
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          if (!fs.existsSync(filePath)) {
            const content = await this.generateFileContent(file, step.task, projectName);
            fs.writeFileSync(filePath, content);
            filesCreated.push(filePath);
          }
        }
      }

      return {
        success: true,
        message: `Completed: ${step.task}`,
        filesCreated
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed: ${step.task} - ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async generateFileContent(fileName: string, task: string, projectName: string): Promise<string> {
    const templates: Record<string, string> = {
      'package.json': JSON.stringify({
        name: projectName,
        version: '1.0.0',
        description: `${projectName} application`,
        main: 'dist/index.js',
        scripts: {
          build: 'tsc',
          start: 'node dist/index.js',
          dev: 'ts-node src/index.ts'
        },
        dependencies: {
          'express': '^4.18.0'
        },
        devDependencies: {
          'typescript': '^5.0.0',
          'ts-node': '^10.9.0',
          '@types/node': '^20.0.0',
          '@types/express': '^4.17.0'
        }
      }, null, 2),
      
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist']
      }, null, 2),
      
      'README.md': `# ${projectName}\n\n${task}\n\n## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Usage\n\n\`\`\`bash\nnpm run dev\n\`\`\``,
      
      'src/index.ts': `import express from 'express';\nimport { app } from './app';\n\nconst PORT = process.env.PORT || 3000;\n\napp.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});`,
      
      'src/app.ts': `import express from 'express';\n\nexport const app = express();\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.json({ message: 'Welcome to ${projectName}!' });\n});\n\napp.get('/health', (req, res) => {\n  res.json({ status: 'OK', timestamp: new Date().toISOString() });\n});`
    };

    return templates[fileName] || `// ${fileName}\n// Generated for: ${task}\n\nexport default {};`;
  }

  private buildValidationPrompt(request: ValidationRequest): string {
    return `Validate if the following code fix correctly resolves the original error:

Original Error: ${request.originalError}

Original Code:
\`\`\`${request.language}
${request.originalCode}
\`\`\`

Fixed Code:
\`\`\`${request.language}
${request.fixedCode}
\`\`\`

${request.testCases ? `Test Cases:\n${request.testCases.map((test, i) => `${i + 1}. ${test}`).join('\n')}` : ''}

Analyze if the fix is correct and complete:`;
  }



  getCurrentModel(): string {
    return this.config.model;
  }

  private parseCompletionResponse(response: OllamaGenerateResponse): CodeSuggestion[] {
    try {
      const raw = ((response && response.response) || '').trim();
      if (!raw) return [];

      const stripped = raw.replace(/^```[a-zA-Z]*\s*|\s*```$/g, '');

      return [{
        text: stripped,
        insertText: stripped,
        kind: CompletionItemKind.Text,
        detail: 'AI-generated completion',
        documentation: `Generated by ${this.config.model}`,
        insertTextFormat: InsertTextFormat.PlainText,
      }];
    } catch (error) {
      console.error('Failed to parse completion response:', error);
      return [];
    }
  }

  private calculateConfidence(suggestions: CodeSuggestion[]): number {
    if (suggestions.length === 0) return 0;
    return Math.min(0.8, suggestions.length * 0.2);
  }

  private parseAnalysisResponse(response: any): any {
    try {
      const analysisText = (response && response.response) || '';
      return {
        explanation: this.formatGracefulResponse(analysisText),
        suggestions: [],
      };
    } catch (error) {
      console.error('Failed to parse analysis response:', error);
      return {
        explanation: 'Failed to analyze code',
        suggestions: [],
      };
    }
  }

  private calculateAnalysisConfidence(analysis: string): number {
    if (!analysis || analysis.length < 10) return 0.1;
    const qualityIndicators = ['because', 'therefore', 'specifically', 'example', 'function', 'method'];
    const matches = qualityIndicators.filter(indicator => analysis.toLowerCase().includes(indicator)).length;
    return Math.min(0.9, Math.max(0.3, 0.5 + (matches * 0.1)));
  }

  private cleanGeneratedCode(code: string): string {
    let cleaned = code;
    const patterns = [
      /^(Here's|Here is|The code is).*?:\s*/i,
      /```[\w]*\s*/g,
      /```\s*$/g
    ];
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
  }

  private formatGracefulResponse(response: string): string {
    if (!response) return response;
    
    if (response.includes('```') && (response.includes('class ') || response.includes('function ') || response.includes('import '))) {
      return response.trim();
    }
    
    let formatted = response
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    const sentences = formatted.split(/(?<=[.!?])\s+/);
    const paragraphs = [];
    let currentParagraph = [];
    
    for (const sentence of sentences) {
      if (sentence.trim()) {
        currentParagraph.push(sentence.trim());
        
        if (currentParagraph.length >= 2 && 
            (sentence.includes('However') || sentence.includes('Additionally') || 
             sentence.includes('Furthermore') || sentence.includes('Moreover'))) {
          paragraphs.push(currentParagraph.join(' '));
          currentParagraph = [];
        }
      }
    }
    
    if (currentParagraph.length > 0) {
      paragraphs.push(currentParagraph.join(' '));
    }
    
    return paragraphs.join('\n\n');
  }

private parseErrorFixResponse(response: any, request: ErrorFixRequest): CodeFix[] {
    try {
      const responseText = (response && response.response) || '';
      
      return [{
        title: 'AI-generated fix',
        description: 'Fix generated by AI analysis',
        fixedCode: this.extractCodeFromResponse(responseText, request.code),
        changes: [],
        confidence: this.calculateFixConfidence('syntax_error', request.code),
        preservesSemantics: true,
        requiresUserReview: true,
        explanation: responseText,
        category: 'syntax',
      }];
    } catch (error) {
      console.error('Failed to parse error fix response:', error);
      return [];
    }
  }

  private parseQuickFixResponse(response: OllamaGenerateResponse): any[] {
    try {
      const responseText = (response && response.response) || '';
      return [{
        title: 'Quick fix',
        description: responseText || 'AI-generated quick fix',
        changes: [],
        confidence: 0.7,
        preservesSemantics: true,
        requiresUserReview: true,
      }];
    } catch (error) {
      console.error('Failed to parse quick fix response:', error);
      return [];
    }
  }

  private extractCodeFromResponse(response: string, language: string): string {
    const regex = new RegExp(`\`\`\`${language}?\\s*([\\s\\S]*?)\`\`\``, 'i');
    const match = response.match(regex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    return response;
  }

  private parseValidationResponse(response: any): any {
    try {
      const validationText = (response && response.response) || '';
      if (!validationText.trim()) {
        throw new Error('Empty validation response');
      }
      const validKeywords = ['valid', 'correct', 'fixes', 'resolves'];
      const invalidKeywords = ['invalid', 'incorrect', 'broken', 'fails'];
      const validCount = validKeywords.filter(word => validationText.toLowerCase().includes(word)).length;
      const invalidCount = invalidKeywords.filter(word => validationText.toLowerCase().includes(word)).length;
      const isValid = validCount > invalidCount;
      
      return {
        isValid,
        confidence: isValid ? Math.min(0.9, 0.5 + (validCount * 0.1)) : Math.max(0.1, 0.5 - (invalidCount * 0.1)),
        explanation: validationText,
        potentialIssues: [],
        semanticPreservation: true,
      };
    } catch (error) {
      console.error('Failed to parse validation response:', error);
      return {
        isValid: false,
        confidence: 0,
        explanation: `Validation parsing failed: ${error}`,
        potentialIssues: ['Parsing error'],
        semanticPreservation: false,
      };
    }
  }

  /**
   * Clear conversation context for a session
   */
  clearContext(sessionId: string): void {
    this.conversationHistory.delete(sessionId);
  }

  /**
   * Get conversation statistics
   */
  getContextStats(): {totalSessions: number, totalMessages: number} {
    let totalMessages = 0;
    for (const history of this.conversationHistory.values()) {
      totalMessages += history.length;
    }
    
    return {
      totalSessions: this.conversationHistory.size,
      totalMessages
    };
  }

  async handleChatRequest(params: any): Promise<string> {
    const prompt = params.query || params.message || 'Hello';
    const sessionId = params.sessionId || 'default';
    
    // Store user message in context
    this.storeContext(sessionId, 'user', prompt);
    
    // Handle identity questions directly
    if (prompt.toLowerCase().includes('who are you')) {
      const response = 'I am a coding assistant designed to help you with programming tasks, code analysis, debugging, and software development.';
      this.storeContext(sessionId, 'assistant', response);
      return response;
    }
    
    // Get conversation context
    const context = this.getContext(sessionId);
    const enhancedPrompt = context ? `${context}\n${prompt}` : prompt;
    
    // Detect if this is a code-related request
    const isCodeRequest = this.isCodeRelatedRequest(prompt);
    
    let result: string;
    if (isCodeRequest) {
      result = await this.handleCodeRequest(enhancedPrompt, sessionId);
    } else {
      result = await this.generateText({ prompt: enhancedPrompt, model: this.config.model });
    }
    
    // Store assistant response in context
    this.storeContext(sessionId, 'assistant', result);
    
    return result;
  }

  /**
   * Check if the request is code-related
   */
  private isCodeRelatedRequest(prompt: string): boolean {
    const codeKeywords = [
      'function', 'class', 'variable', 'code', 'programming', 'syntax',
      'error', 'debug', 'fix', 'optimize', 'refactor', 'typescript',
      'javascript', 'python', 'java', 'import', 'export', 'const', 'let'
    ];
    
    const lowerPrompt = prompt.toLowerCase();
    return codeKeywords.some(keyword => lowerPrompt.includes(keyword)) ||
           /```[\w]*[\s\S]*```/.test(prompt) || // Code blocks
           /\b(def|function|class|interface|import)\s+\w+/.test(prompt); // Code patterns
  }

  /**
   * Handle code-specific requests with enhanced context
   */
  private async handleCodeRequest(prompt: string, sessionId: string): Promise<string> {
    // Extract code from prompt if present
    const codeMatch = prompt.match(/```[\w]*([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : '';
    
    if (code) {
      const language = this.detectLanguage(code);
      const enhancedPrompt = `You are analyzing ${language} code. Previous context is important for understanding the flow.\n\n${prompt}`;
      
      return await this.generateText({ prompt: enhancedPrompt, model: this.config.model });
    }
    
    return await this.generateText({ prompt, model: this.config.model });
  }

  async handleGenericRequest(toolName: string, params: any): Promise<string> {
    const sessionId = params.sessionId || 'default';
    
    // Get conversation context for better continuity
    const context = this.getContext(sessionId);
    
    // Enhanced prompt with context awareness
    const prompt = `You are a helpful AI assistant with memory of our conversation. ${context ? 'Continue our discussion naturally.' : ''} Handle this ${toolName} request: ${JSON.stringify(params, null, 2)}`;
    
    console.log(`[OllamaProvider] Making contextual request to Ollama for ${toolName}`);
    console.log(`[OllamaProvider] Context length: ${context.length} chars`);
    
    const result = await this.generateText({ prompt, model: this.config.model });
    
    // Store the interaction
    this.storeContext(sessionId, 'user', `${toolName}: ${JSON.stringify(params)}`);
    this.storeContext(sessionId, 'assistant', result);
    
    console.log(`[OllamaProvider] Received contextual response: ${result.substring(0, 100)}...`);
    
    return result;
  }

  async fixCode(code: string, language: string): Promise<string> {
    const prompt = `Fix any issues in this ${language} code:\n\n${code}`;
    return await this.generateText({ prompt, model: this.config.model });
  }

  async generateTests(code: string, language: string): Promise<string> {
    const prompt = `Generate unit tests for this ${language} code:\n\n${code}`;
    return await this.generateText({ prompt, model: this.config.model });
  }

  /**
   * Better token estimation
   */
  private estimateTokens(text: string): number {
    // More accurate token estimation
    const words = text.split(/\s+/).length;
    const chars = text.length;
    const symbols = (text.match(/[{}()\[\];,.:]/g) || []).length;
    return Math.ceil((words * 1.3) + (chars * 0.25) + symbols);
  }

  /**
   * Token-aware chunking with context preservation for large files
   */
  private splitCodeByTokens(code: string, maxTokens: number = 4000): Array<{content: string, context: string}> {
    const lines = code.split('\n');
    const chunks: Array<{content: string, context: string}> = [];
    let currentChunk = '';
    let currentTokens = 0;
    
    // Extract context (imports, declarations)
    const context = this.extractContext(code);
    const contextTokens = this.estimateTokens(context);
    const availableTokens = maxTokens - contextTokens;
    
    // For large files, use intelligent chunking by functions/classes
    if (lines.length > 1500) {
      return this.intelligentChunkLargeCode(code, context, availableTokens);
    }
    
    for (const line of lines) {
      const lineTokens = this.estimateTokens(line);
      if (currentTokens + lineTokens > availableTokens && currentChunk) {
        chunks.push({ content: currentChunk, context });
        currentChunk = '';
        currentTokens = 0;
      }
      currentChunk += line + '\n';
      currentTokens += lineTokens;
    }
    
    if (currentChunk) chunks.push({ content: currentChunk, context });
    return chunks;
  }

  /**
   * Extract context (imports, types, declarations)
   */
  private extractContext(code: string): string {
    const lines = code.split('\n');
    const contextLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') || 
          trimmed.startsWith('from ') ||
          trimmed.startsWith('type ') ||
          trimmed.startsWith('interface ') ||
          trimmed.startsWith('const ') && trimmed.includes('=') ||
          trimmed.startsWith('let ') && trimmed.includes('=') ||
          trimmed.startsWith('var ') && trimmed.includes('=')) {
        contextLines.push(line);
      }
    }
    
    return contextLines.slice(0, 20).join('\n'); // Limit context size
  }

  /**
   * Calculate dynamic timeout based on request complexity
   * @param prompt - The prompt text
   * @param code - The code being processed
   * @returns Calculated timeout in milliseconds
   */
  private calculateDynamicTimeout(prompt: string, code: string): number {
    const baseTimeout = 120000; // 2 minutes base for large code generation
    const minTimeout = 60000;   // 60 seconds minimum
    const maxTimeout = 600000;  // 10 minutes maximum for very large outputs
    
    const totalLength = prompt.length + code.length;
    const lines = code.split('\n').length;
    
    // Check if this is a large code generation request
    const isLargeGeneration = prompt.includes('complete') || prompt.includes('full') || 
                             prompt.includes('comprehensive') || prompt.includes('large');
    
    let lengthFactor = 0;
    if (isLargeGeneration) {
      lengthFactor = Math.floor(totalLength / 200) * 1000; // 5 seconds per 200 chars for generation
    } else if (totalLength > 100000) {
      lengthFactor = Math.floor(totalLength / 500) * 1000; // 2 seconds per 500 chars
    } else {
      lengthFactor = Math.floor(totalLength / 1000) * 1000; // 1 second per 1000 chars
    }
    
    // Additional time for complex code (many lines)
    const linesFactor = lines > 1000 ? (lines - 1000) * 100 : 0;
    
    const calculatedTimeout = baseTimeout + lengthFactor + linesFactor;
    const finalTimeout = Math.max(minTimeout, Math.min(calculatedTimeout, maxTimeout));
    
    console.log(`Timeout: ${finalTimeout}ms for ${totalLength} chars, ${lines} lines, large gen: ${isLargeGeneration}`);
    return finalTimeout;
  }

  /**
   * Estimate the maximum block nesting depth in code
   * @param code - The code to analyze
   * @returns Maximum nesting depth
   */
  private estimateBlockDepth(code: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    
    for (const char of code) {
      if (char === '{' || char === '(' || char === '[') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}' || char === ')' || char === ']') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }
    
    return maxDepth;
  }

  /**
   * Handle massive code inputs with enhanced chunking and analysis
   */
  private async explainLargeCode(code: string, language: string): Promise<string> {
    const cacheKey = `explain_${language}_${code.slice(0, 100)}_${code.length}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.result;
    }
    
    try {
      const lines = code.split('\n').length;
      console.log(`Processing large code: ${code.length} characters, ${lines} lines`);
      
      // Enhanced chunking for 1500+ line files
      const chunks = this.splitCodeByTokens(code, 4000);
      const explanations: string[] = [];
      const failedChunks: number[] = [];
      
      // Generate architectural overview first
      const overview = await this.generateArchitecturalOverview(code, language);
      
      // Process chunks with enhanced batching
      const batchSize = lines > 2000 ? 1 : 2; // Smaller batches for very large files
      for (let i = 0; i < chunks.length; i += batchSize) {
        if (!this.checkMemoryUsage()) {
          console.log('Memory pressure detected, waiting...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          this.triggerCleanup();
        }
        
        const batch = chunks.slice(i, i + batchSize);
        const batchPromises = batch.map(async (chunk, index) => {
          try {
            const chunkPrompt = `You are analyzing a large ${language} codebase (${lines} lines total).\n\nContext:\n${chunk.context}\n\nAnalyze this code section (${i + index + 1}/${chunks.length}) and provide insights on:\n1. Main functionality\n2. Key patterns used\n3. Potential improvements\n4. Dependencies\n\nCode:\n${chunk.content}`;
            
            const timeout = this.calculateDynamicTimeout(chunkPrompt, chunk.content);
            const response = await this.callOllamaWithRetry({
              model: this.config.model,
              prompt: chunkPrompt,
              stream: false,
            }, timeout);
            
            return `## Section ${i + index + 1}/${chunks.length}\n${response?.response || 'Analysis unavailable'}`;
          } catch (error) {
            failedChunks.push(i + index);
            return `## Section ${i + index + 1}\n[Complex section - analysis skipped]`;
          }
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach(result => {
          if (result.status === 'fulfilled') {
            explanations.push(result.value);
          } else {
            explanations.push('[Section analysis failed]');
          }
        });
        
        // Progressive delay for large files
        if (i + batchSize < chunks.length) {
          const delay = lines > 2000 ? 1000 : 500;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      const result = `# 📋 Architectural Overview\n${overview}\n\n# 🔍 Detailed Analysis\n${explanations.join('\n\n')}${failedChunks.length > 0 ? `\n\n*Note: ${failedChunks.length} sections required simplified analysis*` : ''}\n\n# 💡 Suggestions\n- Consider breaking down large functions into smaller, focused methods\n- Review code organization and module structure\n- Implement proper error handling and logging\n- Add comprehensive documentation for complex logic`;
      
      this.resultCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
      
    } catch (error) {
      console.error('Large code explanation failed:', error);
      return `This ${language} file contains ${Math.floor(code.length / 1000)}K+ characters with complex functionality. Consider breaking it into smaller, more manageable modules for better maintainability.`;
    }
  }

  /**
   * Intelligently chunk code based on structure rather than arbitrary character limits
   */
  private intelligentChunk(code: string, language: string): Array<{content: string, type: string}> {
    const chunks: Array<{content: string, type: string}> = [];
    const maxChunkSize = 20000; // 20K characters per chunk
    
    // Try to split by logical boundaries
    const boundaries = this.findLogicalBoundaries(code, language);
    
    if (boundaries.length === 0) {
      // Fallback to simple chunking
      for (let i = 0; i < code.length; i += maxChunkSize) {
        chunks.push({
          content: code.slice(i, i + maxChunkSize),
          type: `Code Section ${Math.floor(i / maxChunkSize) + 1}`
        });
      }
    } else {
      // Use logical boundaries
      let currentChunk = '';
      let currentType = 'Code Section';
      
      for (const boundary of boundaries) {
        if (currentChunk.length + boundary.content.length > maxChunkSize && currentChunk.length > 0) {
          chunks.push({ content: currentChunk, type: currentType });
          currentChunk = boundary.content;
          currentType = boundary.type;
        } else {
          currentChunk += boundary.content;
          if (!currentType.includes(boundary.type)) {
            currentType += ` & ${boundary.type}`;
          }
        }
      }
      
      if (currentChunk.length > 0) {
        chunks.push({ content: currentChunk, type: currentType });
      }
    }
    
    return chunks;
  }

  /**
   * Find logical boundaries in code (classes, functions, modules)
   */
  private findLogicalBoundaries(code: string, language: string): Array<{content: string, type: string}> {
    const boundaries: Array<{content: string, type: string}> = [];
    
    // Language-specific patterns
    const patterns = {
      typescript: [/class\s+\w+[^{]*{[^}]*}/g, /function\s+\w+[^{]*{[^}]*}/g, /interface\s+\w+[^{]*{[^}]*}/g],
      javascript: [/class\s+\w+[^{]*{[^}]*}/g, /function\s+\w+[^{]*{[^}]*}/g],
      python: [/class\s+\w+[^:]*:[\s\S]*?(?=\n\S|$)/g, /def\s+\w+[^:]*:[\s\S]*?(?=\n\S|$)/g],
      java: [/class\s+\w+[^{]*{[^}]*}/g, /public\s+[^{]*{[^}]*}/g],
      default: [/\{[^{}]*\}/g] // Generic block matching
    };
    
    const langPatterns = patterns[language as keyof typeof patterns] || patterns.default;
    
    for (const pattern of langPatterns) {
      const matches = code.match(pattern) || [];
      for (const match of matches) {
        const type = this.identifyCodeType(match, language);
        boundaries.push({ content: match, type });
      }
    }
    
    return boundaries;
  }

  /**
   * Identify the type of code block
   */
  private identifyCodeType(codeBlock: string, language: string): string {
    if (codeBlock.includes('class ')) return 'Class Definition';
    if (codeBlock.includes('function ') || codeBlock.includes('def ')) return 'Function Definition';
    if (codeBlock.includes('interface ')) return 'Interface Definition';
    if (codeBlock.includes('import ') || codeBlock.includes('from ')) return 'Imports & Dependencies';
    if (codeBlock.includes('export ')) return 'Exports';
    return 'Code Block';
  }

  /**
   * Generate architectural overview for large codebases
   */
  private async generateArchitecturalOverview(code: string, language: string): Promise<string> {
    const stats = {
      lines: code.split('\n').length,
      characters: code.length,
      functions: (code.match(/function|def |func /g) || []).length,
      classes: (code.match(/class |interface /g) || []).length,
      imports: (code.match(/import|from |#include/g) || []).length,
      complexity: this.estimateBlockDepth(code)
    };
    
    // Extract key structural elements
    const structure = this.analyzeCodeStructure(code, language);
    
    const summaryPrompt = `Analyze this ${language} codebase architecture:\n\n📊 Stats: ${stats.lines} lines, ${stats.functions} functions, ${stats.classes} classes, ${stats.imports} imports\n🏗️ Complexity: ${stats.complexity} max nesting depth\n\n🔍 Key Elements:\n${structure}\n\nProvide architectural insights:`;
    
    try {
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt: summaryPrompt,
        stream: false,
      }, 45000);
      
      return response?.response || `${language} codebase with ${stats.lines} lines, ${stats.classes} classes, and ${stats.functions} functions. Complexity level: ${stats.complexity > 5 ? 'High' : 'Moderate'}.`;
    } catch (error) {
      return `${language} codebase with ${stats.lines} lines, ${stats.classes} classes, and ${stats.functions} functions. Complexity level: ${stats.complexity > 5 ? 'High' : 'Moderate'}.`;
    }
  }

  /**
   * Intelligent chunking for large code files
   */
  private intelligentChunkLargeCode(code: string, context: string, maxTokens: number): Array<{content: string, context: string}> {
    const chunks: Array<{content: string, context: string}> = [];
    const lines = code.split('\n');
    
    // Find logical boundaries (functions, classes, modules)
    const boundaries = this.findLogicalBoundaries(code, this.detectLanguage(code));
    
    if (boundaries.length === 0) {
      // Fallback to line-based chunking
      const chunkSize = Math.ceil(lines.length / Math.ceil(lines.length / 500)); // ~500 lines per chunk
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunkLines = lines.slice(i, i + chunkSize);
        chunks.push({ content: chunkLines.join('\n'), context });
      }
    } else {
      // Use logical boundaries
      let currentChunk = '';
      let currentTokens = 0;
      
      for (const boundary of boundaries) {
        const tokens = this.estimateTokens(boundary.content);
        if (currentTokens + tokens > maxTokens && currentChunk) {
          chunks.push({ content: currentChunk, context });
          currentChunk = boundary.content;
          currentTokens = tokens;
        } else {
          currentChunk += boundary.content + '\n';
          currentTokens += tokens;
        }
      }
      
      if (currentChunk) {
        chunks.push({ content: currentChunk, context });
      }
    }
    
    return chunks;
  }

  /**
   * Analyze code structure for architectural overview
   */
  private analyzeCodeStructure(code: string, language: string): string {
    const structure: string[] = [];
    
    // Extract main components
    const classes = code.match(/class\s+(\w+)/g) || [];
    const functions = code.match(/(?:function|def|func)\s+(\w+)/g) || [];
    const interfaces = code.match(/interface\s+(\w+)/g) || [];
    
    if (classes.length > 0) {
      structure.push(`Classes: ${classes.slice(0, 5).join(', ')}${classes.length > 5 ? ` (+${classes.length - 5} more)` : ''}`);
    }
    
    if (functions.length > 0) {
      structure.push(`Functions: ${functions.slice(0, 5).join(', ')}${functions.length > 5 ? ` (+${functions.length - 5} more)` : ''}`);
    }
    
    if (interfaces.length > 0) {
      structure.push(`Interfaces: ${interfaces.slice(0, 3).join(', ')}${interfaces.length > 3 ? ` (+${interfaces.length - 3} more)` : ''}`);
    }
    
    return structure.join('\n') || 'Mixed code structure with various components';
  }

  /**
   * Generate large code outputs with streaming and chunking
   */
  private async generateLargeCode(prompt: string, language: string): Promise<string> {
    console.log(`[OllamaProvider] Generating large ${language} code...`);
    
    try {
      // Use streaming for large code generation
      const enhancedPrompt = `${prompt}

IMPORTANT: Generate complete, comprehensive ${language} code. Do not truncate or summarize. Provide the full implementation with all necessary components, imports, functions, and classes. Generate at least 500-2000 lines of production-ready code.`;
      
      const response = await this.generateTextStreaming(enhancedPrompt, this.config.model);
      
      if (response.length < 1000) {
        // If response is too short, try again with more explicit instructions
        const expandedPrompt = `${enhancedPrompt}

The code should be comprehensive and detailed. Include:
- All necessary imports and dependencies
- Complete class definitions with all methods
- Proper error handling
- Documentation and comments
- Example usage
- Helper functions and utilities

Generate extensive, production-ready ${language} code:`;
        
        return await this.generateTextStreaming(expandedPrompt, this.config.model);
      }
      
      return response;
    } catch (error) {
      console.error('Large code generation failed:', error);
      return `// Large code generation failed: ${error}
// Please try with a more specific request`;
    }
  }

  // Conversation context storage
  private conversationHistory: Map<string, Array<{role: 'user' | 'assistant', content: string, timestamp: number}>> = new Map();
  private readonly MAX_CONTEXT_LENGTH = 10;
  private readonly CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  /**
   * Detect programming language from code content
   */
  private detectLanguage(code: string): string {
    // More accurate language detection with priority order
    if (code.includes('interface ') && (code.includes(': string') || code.includes(': number') || code.includes('Promise<'))) return 'typescript';
    if (code.includes('class ') && code.includes('def ') && code.includes('self')) return 'python';
    if (code.includes('public class ') && (code.includes('import java') || code.includes('System.out'))) return 'java';
    if (code.includes('#include') && (code.includes('int main') || code.includes('std::'))) return 'cpp';
    if (code.includes('function ') || code.includes('const ') || code.includes('let ') || code.includes('=>')) return 'javascript';
    if (code.includes('func ') && code.includes('package ')) return 'go';
    if (code.includes('fn ') && code.includes('let mut')) return 'rust';
    return 'unknown';
  }

  /**
   * Store conversation context for better continuity
   */
  private storeContext(sessionId: string, role: 'user' | 'assistant', content: string): void {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    
    const history = this.conversationHistory.get(sessionId)!;
    history.push({ role, content, timestamp: Date.now() });
    
    // Keep only recent messages
    if (history.length > this.MAX_CONTEXT_LENGTH) {
      history.splice(0, history.length - this.MAX_CONTEXT_LENGTH);
    }
    
    // Clean old sessions
    this.cleanOldSessions();
  }

  /**
   * Get conversation context for continuity
   */
  private getContext(sessionId: string): string {
    const history = this.conversationHistory.get(sessionId);
    if (!history || history.length === 0) return '';
    
    const contextMessages = history
      .filter(msg => Date.now() - msg.timestamp < this.CONTEXT_TIMEOUT)
      .slice(-5) // Last 5 messages for context
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
    
    return contextMessages ? `\nPrevious conversation:\n${contextMessages}\n\nCurrent request:` : '';
  }

  /**
   * Clean expired conversation sessions
   */
  private cleanOldSessions(): void {
    const now = Date.now();
    for (const [sessionId, history] of this.conversationHistory.entries()) {
      const lastMessage = history[history.length - 1];
      if (lastMessage && now - lastMessage.timestamp > this.CONTEXT_TIMEOUT) {
        this.conversationHistory.delete(sessionId);
      }
    }
  }

  async extractEntities(text: string): Promise<Array<{entity: string, type: string}>> {
    try {
      const doc = nlp(text);
      const entities: Array<{entity: string, type: string}> = [];
      
      // Enhanced entity extraction
      entities.push(...doc.people().out('array').map((e: string) => ({entity: e.trim(), type: 'PERSON'})));
      entities.push(...doc.places().out('array').map((e: string) => ({entity: e.trim(), type: 'LOCATION'})));
      entities.push(...doc.organizations().out('array').map((e: string) => ({entity: e.trim(), type: 'ORGANIZATION'})));
      entities.push(...doc.match('#Date').out('array').map((e: string) => ({entity: e.trim(), type: 'DATE'})));
      
      // Extract code-related entities
      const codeEntities = this.extractCodeEntities(text);
      entities.push(...codeEntities);
      
      return entities.filter(e => e.entity.length > 1); // Filter out single characters
    } catch (error) {
      console.error('Entity extraction failed:', error);
      return [];
    }
  }

  /**
   * Extract code-specific entities (functions, classes, variables)
   */
  private extractCodeEntities(text: string): Array<{entity: string, type: string}> {
    const entities: Array<{entity: string, type: string}> = [];
    
    // Function names
    const functions = text.match(/(?:function|def|func)\s+(\w+)/g) || [];
    functions.forEach(f => {
      const name = f.split(/\s+/)[1];
      if (name) entities.push({entity: name, type: 'FUNCTION'});
    });
    
    // Class names
    const classes = text.match(/class\s+(\w+)/g) || [];
    classes.forEach(c => {
      const name = c.split(/\s+/)[1];
      if (name) entities.push({entity: name, type: 'CLASS'});
    });
    
    // Variable declarations
    const variables = text.match(/(?:let|const|var)\s+(\w+)/g) || [];
    variables.forEach(v => {
      const name = v.split(/\s+/)[1];
      if (name) entities.push({entity: name, type: 'VARIABLE'});
    });
    
    return entities;
  }

  /**
   * Enhanced fallback fix generation with context awareness
   */
  generateFallbackFix(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): CodeFix[] {
    const language = this.detectLanguage(request.code);
    const variableName = this.extractVariableName(request.errorMessage) || 'variable';
    
    const fallbackFixes: Record<string, string> = {
      'undefined_variable': this.generateVariableFix(request.code, variableName, language),
      'import_error': this.generateImportFix(request.code, language),
      'syntax_error': this.generateSyntaxFix(request.code, language),
      'type_error': this.generateTypeFix(request.code, language),
      'missing_semicolon': request.code.replace(/([^;])\n/g, '$1;\n'),
      'bracket_mismatch': this.fixBracketMismatch(request.code)
    };

    const fixedCode = fallbackFixes[errorAnalysis.type] || this.applyGenericFix(request.code, language);
    
    return [{
      title: `${errorAnalysis.type.replace('_', ' ')} fix`,
      description: `Automatic fix for ${errorAnalysis.type} in ${language}`,
      fixedCode,
      changes: this.calculateChanges(request.code, fixedCode),
      confidence: this.calculateFixConfidence(errorAnalysis.type, request.code),
      preservesSemantics: true,
      requiresUserReview: true,
      explanation: `Generated ${errorAnalysis.type} fix based on error pattern analysis`,
      category: this.categorizeError(errorAnalysis.type)
    }];
  }

  private extractVariableName(errorMessage: string): string | null {
    const patterns = [
      /'(\w+)' is not defined/,
      /Cannot find name '(\w+)'/,
      /Undefined variable: (\w+)/,
      /(\w+) is not declared/
    ];
    
    for (const pattern of patterns) {
      const match = errorMessage.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private generateVariableFix(code: string, variableName: string, language: string): string {
    const declaration = language === 'typescript' ? `let ${variableName}: any = null;` :
                       language === 'python' ? `${variableName} = None` :
                       `let ${variableName} = null;`;
    return `// Declare missing variable\n${declaration}\n${code}`;
  }

  private generateImportFix(code: string, language: string): string {
    const importStatement = language === 'python' ? '# Add required imports\n# import module_name' :
                           '// Add required imports\n// import { module } from \'package\';';
    return `${importStatement}\n${code}`;
  }

  private generateSyntaxFix(code: string, language: string): string {
    let fixed = code;
    if (language === 'javascript' || language === 'typescript') {
      fixed = fixed.replace(/var /g, 'let '); // Replace var with let
      fixed = fixed.replace(/==/g, '==='); // Use strict equality
    }
    return `// Fixed syntax issues\n${fixed}`;
  }

  private generateTypeFix(code: string, language: string): string {
    if (language === 'typescript') {
      // Add basic type annotations
      let fixed = code.replace(/(let|const)\s+(\w+)\s*=/g, '$1 $2: any =');
      return `// Added type annotations\n${fixed}`;
    }
    return code;
  }

  private fixBracketMismatch(code: string): string {
    const lines = code.split('\n');
    let braceCount = 0;
    let parenCount = 0;
    
    for (const line of lines) {
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      parenCount += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
    }
    
    let fixed = code;
    if (braceCount > 0) fixed += '\n' + '}'.repeat(braceCount);
    if (parenCount > 0) fixed += ')'.repeat(parenCount);
    
    return fixed;
  }

  private applyGenericFix(code: string, language: string): string {
    // Apply common fixes based on language
    let fixed = code;
    if (language === 'javascript' || language === 'typescript') {
      fixed = fixed.replace(/var /g, 'let ');
      fixed = fixed.replace(/;\s*;/g, ';');
    }
    return fixed;
  }

  private calculateChanges(original: string, fixed: string): CodeChange[] {
    const originalLines = original.split('\n');
    const fixedLines = fixed.split('\n');
    const changes: CodeChange[] = [];
    
    const maxLines = Math.max(originalLines.length, fixedLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (originalLines[i] !== fixedLines[i]) {
        const changeType = !originalLines[i] ? 'insert' : !fixedLines[i] ? 'delete' : 'replace';
        changes.push({
          type: changeType,
          startLine: i + 1,
          endLine: i + 1,
          newText: fixedLines[i] || '',
          description: changeType === 'delete' ? 'Line removed' : `Line ${changeType}d`
        });
      }
    }
    
    return changes;
  }

  private calculateFixConfidence(errorType: string, code: string): number {
    const confidenceMap: Record<string, number> = {
      'syntax_error': 0.8,
      'undefined_variable': 0.7,
      'import_error': 0.6,
      'type_error': 0.5,
      'missing_semicolon': 0.9,
      'bracket_mismatch': 0.8
    };
    
    const baseConfidence = confidenceMap[errorType] || 0.4;
    const codeComplexity = this.estimateBlockDepth(code);
    
    // Reduce confidence for complex code
    return Math.max(0.1, baseConfidence - (codeComplexity * 0.05));
  }

  private categorizeError(errorType: string): 'syntax' | 'logic' | 'performance' | 'security' | 'style' {
    const categories: Record<string, 'syntax' | 'logic' | 'performance' | 'security' | 'style'> = {
      'syntax_error': 'syntax',
      'undefined_variable': 'syntax',
      'import_error': 'syntax',
      'type_error': 'syntax',
      'missing_semicolon': 'syntax',
      'bracket_mismatch': 'syntax'
    };
    
    return categories[errorType] || 'syntax';
  }
}