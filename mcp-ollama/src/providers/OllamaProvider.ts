// import fetch from 'node-fetch';
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

  constructor(config: OllamaConfig) {
    this.config = config;
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
    model: model ?? this.config.model,
    prompt,
    stream,
  });
  return data.response ?? '';
}


  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(
        `${this.config.host}/api/tags`,
        { method: 'GET' },
        this.config.timeout ?? 5000
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
        `${this.config.host}/api/tags`,
        { method: 'GET' },
        this.config.timeout ?? 5000
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as any;
      return data?.models?.map((m: any) => m?.name).filter(Boolean) ?? [];
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
        confidence: 0.8,
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
      const enhancedPrompt = `Generate ${language} code for the following request:\n\n${prompt}\n\nProvide only the code without explanations:`;
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt: enhancedPrompt,
        stream: false,
      });

      return this.cleanGeneratedCode(response?.response || 'Failed to generate code');
    } catch (error) {
      console.error('Code generation failed:', error);
      return `// Error generating code: ${error}`;
    }
  }



  async explainCode(code: string, language: string): Promise<string> {
    try {
      const prompt = `Explain the following ${language} code in detail:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nProvide a clear explanation of what this code does:`;
      
      const response = await this.callOllama({
        model: this.config.model,
        prompt,
        stream: false,
      });

      return response?.response || 'Failed to explain code';
    } catch (error) {
      console.error('Code explanation failed:', error);
      return `Error explaining code: ${error}`;
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
      return [];
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
        `${this.config.host}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
        this.config.timeout ?? 5000
      );
    } catch (e: unknown) {
      const err = e as Error;
      if (err?.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${this.config.timeout ?? 5000} ms`);
      }
      throw new Error(`Ollama request failed: ${err?.message ?? String(e)}`);
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
      const currentLine = lines[safeLine] ?? '';
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
      explanation: `Explain what the following ${language} code does:`,
      refactoring: `Suggest refactoring improvements for the following ${language} code:`,
      optimization: `Suggest performance optimizations for the following ${language} code:`,
      bugs: `Identify potential bugs and issues in the following ${language} code:`,
    };

    return `${prompts[analysisType]}

\`\`\`${language}
${code}
\`\`\`

Provide a detailed analysis:`;
  }

  private buildErrorFixPrompt(request: ErrorFixRequest, errorAnalysis: ErrorAnalysis): string {
    return `Fix the following ${request.language} code error:

Error: ${request.errorMessage}
${request.stackTrace ? `Stack Trace: ${request.stackTrace}` : ''}

Code:
\`\`\`${request.language}
${request.code}
\`\`\`

Error Analysis:
- Type: ${errorAnalysis.type}
- Category: ${errorAnalysis.category}
- Cause: ${errorAnalysis.cause}
- Suggested Approach: ${errorAnalysis.suggestedApproach}

Provide the fixed code and explain the changes:`;
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
    const raw = (response?.response ?? '').trim();
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
      const analysisText = response?.response || '';
      return {
        explanation: analysisText,
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
      const responseText = response?.response || '';
      
      return [{
        title: 'AI-generated fix',
        description: 'Fix generated by AI analysis',
        fixedCode: this.extractCodeFromResponse(responseText, request.language),
        changes: [],
        confidence: 0.7,
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
    const responseText = response?.response ?? '';
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
      const validationText = response?.response || '';
      const isValid = validationText.toLowerCase().includes('valid') || validationText.toLowerCase().includes('correct');
      
      return {
        isValid,
        confidence: isValid ? 0.8 : 0.3,
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

  private extractCodeFromResponse(response: string, language: string): string {
    // Try to extract code blocks
    const codeBlockRegex = new RegExp(`\`\`\`${language}?\\s*([\\s\\S]*?)\`\`\``, 'i');
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

  private cleanGeneratedCode(code: string): string {
    // Remove common AI response prefixes/suffixes
    return code
      .replace(/^(Here's|Here is|The code is).*?:\s*/i, '')
      .replace(/```\w*\s*/g, '')
      .replace(/```\s*$/g, '')
      .trim();
  }
}
