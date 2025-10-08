import fetch, { RequestInit, Response } from 'node-fetch';
// Use built-in AbortController for Node.js 16+
const AbortController = (globalThis as any).AbortController || require('abort-controller');

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
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: OllamaConfig) {
    this.validatedHost = this.validateAndSanitizeHost(config.host);
    this.config = { ...config, host: this.validatedHost };
    
    // Only start monitoring if explicitly enabled
    if (process.env.ENABLE_MEMORY_MONITORING === 'true') {
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
    for (const [key, entry] of this.resultCache) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.resultCache.delete(key);
      }
    }
    
    // Limit cache size
    if (this.resultCache.size > 100) {
      const entries = Array.from(this.resultCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50);
      this.resultCache.clear();
      entries.forEach(([key, value]) => this.resultCache.set(key, value));
    }
    
    // Force garbage collection if available
    if (global.gc) global.gc();
    
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
      const enhancedPrompt = `You are a helpful coding assistant. Generate clean, well-formatted ${language} code for the following request. Provide only the code without markdown formatting, explanations, or special characters:

${prompt}

Generate the code:`;
      
      const dynamicTimeout = this.calculateDynamicTimeout(enhancedPrompt, '');
      
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt: enhancedPrompt,
        stream: false,
      }, dynamicTimeout);

      return this.cleanGeneratedCode((response && response.response) || 'Failed to generate code');
    } catch (error) {
      console.error('Code generation failed:', error);
      return `// Error generating code: ${error}`;
    }
  }

  async explainCode(code: string, language: string): Promise<string> {
    try {
      // Handle massive code inputs with chunking
      if (code.length > 50000) {
        return await this.explainLargeCode(code, language);
      }
      
      const prompt = `You are a helpful coding assistant. Explain the following ${language} code in a clear, conversational way without using markdown symbols, asterisks, or special formatting characters. Write like you're explaining to a colleague:

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
      
      const prompt = `You are a helpful coding assistant. Explain the following ${language} code in a clear, conversational way without using markdown symbols, asterisks, or special formatting characters. Write like you're explaining to a colleague:

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
  }, timeoutMs: number): Promise<OllamaGenerateResponse> {
    // Limit timeout to reasonable bounds
    const boundedTimeout = Math.min(Math.max(timeoutMs, 30000), 120000); // 30s min, 2min max
    
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${this.validatedHost}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            // Add Ollama-specific timeout parameters
            options: {
              num_predict: 2000, // Comprehensive responses for enterprise
              temperature: 0.3,
              top_p: 0.8
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

  private parseCompletionResponse(response: OllamaGenerateResponse): CodeSuggestion[] {
    try {
      const raw = ((response && response.response) || '').trim();
      if (!raw) return [];

      // Strip ```lang ... ``` fences if present
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

  private parseErrorFixResponse(response: any, request: ErrorFixRequest): CodeFix[] {
    try {
      const responseText = (response && response.response) || '';
      
      return [{
        title: 'AI-generated fix',
        description: 'Fix generated by AI analysis',
        fixedCode: this.extractCodeFromResponse(responseText, request.language),
        changes: [],
        confidence: this.calculateFixConfidence(responseText),
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
      // You can parse multiple options later; for now return one generic suggestion
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

  private static readonly CODE_BLOCK_CACHE = new Map<string, {regex: RegExp, lastUsed: number}>();
  private static readonly MAX_CACHE_SIZE = 50;

  private extractCodeFromResponse(response: string, language: string): string {
    // Cache regex patterns with LRU eviction
    const cacheKey = `code_block_${language}`;
    let cacheEntry = OllamaProvider.CODE_BLOCK_CACHE.get(cacheKey);
    
    if (!cacheEntry) {
      // Evict oldest if cache is full
      if (OllamaProvider.CODE_BLOCK_CACHE.size >= OllamaProvider.MAX_CACHE_SIZE) {
        let oldestKey = '';
        let oldestTime = Date.now();
        for (const [key, entry] of OllamaProvider.CODE_BLOCK_CACHE) {
          if (entry.lastUsed < oldestTime) {
            oldestTime = entry.lastUsed;
            oldestKey = key;
          }
        }
        if (oldestKey) OllamaProvider.CODE_BLOCK_CACHE.delete(oldestKey);
      }
      
      cacheEntry = {
        regex: new RegExp(`\`\`\`${language}?\\s*([\\s\\S]*?)\`\`\``, 'i'),
        lastUsed: Date.now()
      };
      OllamaProvider.CODE_BLOCK_CACHE.set(cacheKey, cacheEntry);
    } else {
      cacheEntry.lastUsed = Date.now();
    }
    
    const codeBlockRegex = cacheEntry.regex;
    
    const match = response.match(codeBlockRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Fallback: return the response as-is
    return response;
  }

  private calculateConfidence(suggestions: CodeSuggestion[]): number {
    if (suggestions.length === 0) return 0;
    return Math.min(0.8, suggestions.length * 0.2);
  }

  private calculateAnalysisConfidence(analysis: string): number {
    if (!analysis || analysis.length < 10) return 0.1;
    const qualityIndicators = ['because', 'therefore', 'specifically', 'example', 'function', 'method'];
    const matches = qualityIndicators.filter(indicator => analysis.toLowerCase().includes(indicator)).length;
    return Math.min(0.9, Math.max(0.3, 0.5 + (matches * 0.1)));
  }

  private calculateFixConfidence(responseText: string): number {
    if (!responseText || responseText.length < 5) return 0.1;
    const codeIndicators = ['{', '}', '(', ')', ';', '=', 'function', 'const', 'let', 'var'];
    const matches = codeIndicators.filter(indicator => responseText.includes(indicator)).length;
    return Math.min(0.9, Math.max(0.3, 0.4 + (matches * 0.05)));
  }

  private static readonly CLEANUP_PATTERNS = [
    /^(Here's|Here is|The code is).*?:\s*/i,
    /```[\w]*\s*/g,
    /```\s*$/g
  ];

  private cleanGeneratedCode(code: string): string {
    // Remove common AI response prefixes/suffixes using cached patterns
    let cleaned = code;
    for (const pattern of OllamaProvider.CLEANUP_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
  }

  private formatGracefulResponse(response: string): string {
    if (!response) return response;
    
    // For code generation requests, preserve code blocks
    if (response.includes('```') && (response.includes('class ') || response.includes('function ') || response.includes('import '))) {
      return response.trim(); // Keep original formatting for code
    }
    
    // Remove markdown formatting for explanations only
    let formatted = response
      // Remove markdown headers
      .replace(/#{1,6}\s*/g, '')
      // Remove bold/italic markers
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove inline code markers (but preserve code blocks)
      .replace(/`([^`]+)`/g, '$1')
      // Remove bullet points and list markers
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      // Remove excessive newlines
      .replace(/\n{3,}/g, '\n\n')
      // Clean up whitespace
      .trim();
    
    // Format as conversational paragraphs
    const sentences = formatted.split(/(?<=[.!?])\s+/);
    const paragraphs = [];
    let currentParagraph = [];
    
    for (const sentence of sentences) {
      if (sentence.trim()) {
        currentParagraph.push(sentence.trim());
        
        // Start new paragraph after 2-3 sentences
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

  getCurrentModel(): string {
    return this.config.model;
  }

  async handleChatRequest(params: any): Promise<string> {
    const prompt = params.query || params.message || 'Hello';
    return await this.generateText({ prompt, model: this.config.model });
  }

  async handleGenericRequest(toolName: string, params: any): Promise<any> {
    // Ensure we actually call Ollama for the request
    const prompt = `You are a helpful AI assistant. Handle this ${toolName} request: ${JSON.stringify(params, null, 2)}`;
    
    console.log(`[OllamaProvider] Making actual request to Ollama for ${toolName}`);
    console.log(`[OllamaProvider] Prompt: ${prompt.substring(0, 200)}...`);
    
    const result = await this.generateText({ prompt, model: this.config.model });
    
    console.log(`[OllamaProvider] Received response from Ollama: ${result.substring(0, 200)}...`);
    
    return { result, toolName, timestamp: new Date().toISOString() };
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
   * Token-aware chunking with context preservation
   */
  private splitCodeByTokens(code: string, maxTokens: number = 3000): Array<{content: string, context: string}> {
    const lines = code.split('\n');
    const chunks: Array<{content: string, context: string}> = [];
    let currentChunk = '';
    let currentTokens = 0;
    
    // Extract context (imports, declarations)
    const context = this.extractContext(code);
    const contextTokens = this.estimateTokens(context);
    const availableTokens = maxTokens - contextTokens;
    
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
    const baseTimeout = 60000; // 60 seconds base
    const minTimeout = 30000;  // 30 seconds minimum
    const maxTimeout = 120000; // 2 minutes maximum
    
    // Simple length-based timeout calculation
    const totalLength = prompt.length + code.length;
    
    // Much more conservative timeout calculation
    // 1 second per 1000 characters (instead of 200)
    const lengthFactor = Math.floor(totalLength / 1000) * 1000;
    
    const calculatedTimeout = baseTimeout + lengthFactor;
    
    // Ensure timeout is within bounds
    const finalTimeout = Math.max(minTimeout, Math.min(calculatedTimeout, maxTimeout));
    
    console.log(`Timeout: ${finalTimeout}ms for ${totalLength} chars`);
    
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
   * Handle massive code inputs with caching and graceful degradation
   */
  private async explainLargeCode(code: string, language: string): Promise<string> {
    // Check cache first
    const cacheKey = `explain_${language}_${code.slice(0, 100)}_${code.length}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.result;
    }
    
    try {
      console.log(`Processing large code: ${code.length} characters`);
      
      // Use token-aware chunking
      const chunks = this.splitCodeByTokens(code, 3000);
      const explanations: string[] = [];
      const failedChunks: number[] = [];
      
      // Process chunks with backpressure
      const batchSize = 2;
      for (let i = 0; i < chunks.length; i += batchSize) {
        // Check memory before processing batch
        if (!this.checkMemoryUsage()) {
          console.log('Memory pressure detected, waiting...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          this.triggerCleanup();
        }
        
        const batch = chunks.slice(i, i + batchSize);
        const batchPromises = batch.map(async (chunk, index) => {
          try {
            const chunkPrompt = `Context:\n${chunk.context}\n\nExplain this ${language} code section (part ${i + index + 1} of ${chunks.length}):\n\n${chunk.content}`;
            
            const timeout = Math.min(this.calculateDynamicTimeout(chunkPrompt, chunk.content), 120000); // Max 2 min per chunk
            const response = await this.callOllamaWithRetry({
              model: this.config.model,
              prompt: chunkPrompt,
              stream: false,
            }, timeout);
            
            return `## Section ${i + index + 1}\n${response?.response || 'Analysis unavailable'}`;
          } catch (error) {
            failedChunks.push(i + index);
            return `## Section ${i + index + 1}\n[Analysis failed - code section contains complex logic]`;
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
        
        // Rate limiting
        if (i + batchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Generate summary even if some chunks failed
      const summary = await this.generateCodeSummary(code, language, explanations).catch(() => 
        `Large ${language} codebase (${Math.floor(code.length / 1000)}K chars) with ${chunks.length} sections analyzed.`
      );
      
      const result = `# Code Overview\n${summary}\n\n# Analysis\n${explanations.join('\n\n')}${failedChunks.length > 0 ? `\n\n*Note: ${failedChunks.length} sections failed analysis due to complexity*` : ''}`;
      
      // Cache result
      this.resultCache.set(cacheKey, { result, timestamp: Date.now() });
      
      return result;
      
    } catch (error) {
      console.error('Large code explanation failed:', error);
      return `This is a very large ${language} codebase with ${Math.floor(code.length / 1000)}K+ characters. The code appears to contain multiple components, classes, and functions working together to implement complex functionality.`;
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
      typescript: [/class\s+\w+[^{]*{[^}]*}/gs, /function\s+\w+[^{]*{[^}]*}/gs, /interface\s+\w+[^{]*{[^}]*}/gs],
      javascript: [/class\s+\w+[^{]*{[^}]*}/gs, /function\s+\w+[^{]*{[^}]*}/gs],
      python: [/class\s+\w+[^:]*:[\s\S]*?(?=\n\S|$)/gs, /def\s+\w+[^:]*:[\s\S]*?(?=\n\S|$)/gs],
      java: [/class\s+\w+[^{]*{[^}]*}/gs, /public\s+[^{]*{[^}]*}/gs],
      default: [/\{[^{}]*\}/gs] // Generic block matching
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
   * Generate high-level summary of large codebase
   */
  private async generateCodeSummary(code: string, language: string, explanations: string[]): Promise<string> {
    const stats = {
      lines: code.split('\n').length,
      characters: code.length,
      functions: (code.match(/function|def /g) || []).length,
      classes: (code.match(/class /g) || []).length,
      imports: (code.match(/import|from /g) || []).length
    };
    
    const summaryPrompt = `Provide a high-level summary of this ${language} codebase:\n\nStats: ${stats.lines} lines, ${stats.characters} chars, ${stats.functions} functions, ${stats.classes} classes\n\nKey components analyzed: ${explanations.length} sections\n\nProvide a brief architectural overview:`;
    
    try {
      const response = await this.callOllamaWithTimeout({
        model: this.config.model,
        prompt: summaryPrompt,
        stream: false,
      }, 30000);
      
      return response?.response || `Large ${language} codebase with ${stats.lines} lines containing ${stats.classes} classes and ${stats.functions} functions.`;
    } catch (error) {
      return `Large ${language} codebase with ${stats.lines} lines containing ${stats.classes} classes and ${stats.functions} functions.`;
    }
  }

  generateFallbackFix(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): CodeFix[] {
    const fallbackFixes: Record<string, string> = {
      'undefined_variable': `// Declare the variable
let ${(() => { const match = request.errorMessage.match(/\w+/); return match ? match[0] : 'variable'; })()} = null;
${request.code}`,
      'import_error': `// Add import statement
// import { module } from 'package';
${request.code}`,
      'syntax_error': `// Fixed syntax
${request.code.replace(/var /g, 'let ')}`
    };

    const fixedCode = fallbackFixes[errorAnalysis.type] || request.code;
    
    return [{
      title: 'Fallback fix',
      description: 'Basic fix suggestion',
      fixedCode,
      changes: [],
      confidence: 0.5,
      preservesSemantics: true,
      requiresUserReview: true,
      explanation: 'Generated fallback fix due to timeout or error',
      category: 'syntax'
    }];
  }
}