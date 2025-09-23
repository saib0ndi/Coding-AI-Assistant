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

  constructor(config: OllamaConfig) {
    this.validatedHost = this.validateAndSanitizeHost(config.host);
    this.config = { ...config, host: this.validatedHost };
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
  const data = await this.callOllama({
    model: model || this.config.model,
    prompt,
    stream,
  });
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
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

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
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

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
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt: enhancedPrompt,
        stream: false,
      });

      return this.cleanGeneratedCode((response && response.response) || 'Failed to generate code');
    } catch (error) {
      console.error('Code generation failed:', error);
      return `// Error generating code: ${error}`;
    }
  }



  async explainCode(code: string, language: string): Promise<string> {
    try {
      const prompt = `You are a helpful coding assistant. Explain the following ${language} code in a clear, conversational way without using markdown symbols, asterisks, or special formatting characters. Write like you're explaining to a colleague:

${code}

Explain what this code does, how it works, and any important details:`;
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

      return this.formatGracefulResponse(response?.response || 'Failed to explain code');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Code explanation failed:', errorMessage);
      return `Error explaining code: ${errorMessage}`;
    }
  }

  async generateErrorFixes(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): Promise<CodeFix[]> {
    try {
      const prompt = this.buildErrorFixPrompt(request, errorAnalysis);
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

      return this.parseErrorFixResponse(response, request);
    } catch (error) {
      console.error('Error fix generation failed:', error);
      // Return fallback fix based on error type
      return this.generateFallbackFix(request, errorAnalysis);
    }
  }

  async generateQuickFixes(request: QuickFixRequest): Promise<any[]> {
    try {
      const prompt = this.buildQuickFixPrompt(request);
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

      return this.parseQuickFixResponse(response);
    } catch (error) {
      console.error('Quick fix generation failed:', error);
      return [];
    }
  }

  async validateCodeFix(request: ValidationRequest): Promise<any> {
    try {
      const prompt = this.buildValidationPrompt(request);
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

      return this.parseValidationResponse(response);
    } catch (error) {
      console.error('Code fix validation failed:', error);
      return {
        isValid: false,
        confidence: 0,
        explanation: `Validation failed: ${error}`,
        potentialIssues: ['Validation process failed'],
        semanticPreservation: false,
      };
    }
  }

  // Private helper methods

  private async callOllama(params: {
    model: string;
    prompt: string;
    stream?: boolean;
  }): Promise<OllamaGenerateResponse> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${this.validatedHost}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
        this.config.timeout || 30000
      );
    } catch (e: unknown) {
      const err = e as Error;
      if (err && err.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${this.config.timeout || 30000} ms`);
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

  private static readonly CODE_BLOCK_CACHE = new Map<string, RegExp>();

  private extractCodeFromResponse(response: string, language: string): string {
    // Cache regex patterns to avoid repeated compilation
    const cacheKey = `code_block_${language}`;
    let codeBlockRegex = OllamaProvider.CODE_BLOCK_CACHE.get(cacheKey);
    
    if (!codeBlockRegex) {
      codeBlockRegex = new RegExp(`\`\`\`${language}?\\s*([\\s\\S]*?)\`\`\``, 'i');
      OllamaProvider.CODE_BLOCK_CACHE.set(cacheKey, codeBlockRegex);
    }
    
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
    
    // Remove markdown formatting and special characters
    let formatted = response
      // Remove markdown headers
      .replace(/#{1,6}\s*/g, '')
      // Remove bold/italic markers
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove code block markers
      .replace(/```[\w]*\n?/g, '')
      .replace(/```/g, '')
      // Remove inline code markers
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

  private generateFallbackFix(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): CodeFix[] {
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
      explanation: 'Generated fallback fix due to timeout',
      category: 'syntax'
    }];
  }
}
