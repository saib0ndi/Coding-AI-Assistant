import { OllamaProvider } from './OllamaProvider.js';
import { AIProvider, CodeCompletionRequest, CodeCompletionResponse, CodeAnalysisRequest, CodeAnalysisResponse } from '../types/index.js';

export interface ModelConfig {
  name: string;
  provider: 'ollama' | 'openai' | 'anthropic';
  endpoint?: string;
  apiKey?: string;
  capabilities: string[];
}

export class MultiModelProvider implements AIProvider {
  private providers: Map<string, AIProvider> = new Map();
  private modelConfigs: ModelConfig[] = [];
  private fallbackOrder: string[] = [];

  constructor(configs: ModelConfig[]) {
    this.modelConfigs = configs;
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.modelConfigs.forEach(config => {
      if (config.provider === 'ollama') {
        const provider = new OllamaProvider({
          host: config.endpoint || 'http://localhost:11434',
          model: config.name,
          timeout: 5000
        });
        this.providers.set(config.name, provider);
        this.fallbackOrder.push(config.name);
      }
    });
  }

  async generateCompletion(request: CodeCompletionRequest): Promise<CodeCompletionResponse> {
    return this.executeWithFallback(
      (provider) => provider.generateCompletion(request),
      'completion',
      'All models failed for code completion'
    );
  }

  async analyzeCode(request: CodeAnalysisRequest): Promise<CodeAnalysisResponse> {
    return this.executeWithFallback(
      (provider) => provider.analyzeCode(request),
      'analysis',
      'All models failed for code analysis'
    );
  }

  private async executeWithFallback<T>(
    operation: (provider: AIProvider) => Promise<T>,
    capability: string,
    errorMessage: string
  ): Promise<T> {
    for (const modelName of this.fallbackOrder) {
      try {
        const provider = this.providers.get(modelName);
        if (provider && this.supportsCapability(modelName, capability)) {
          return await operation(provider);
        }
      } catch (error) {
        const sanitizedError = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Model ${modelName} failed for ${capability}: ${sanitizedError}`);
        continue;
      }
    }
    throw new Error(errorMessage);
  }

  async generateCode(prompt: string, language: string): Promise<string> {
    return this.executeWithFallback(
      (provider) => provider.generateCode(prompt, language),
      'generation',
      'All models failed for code generation'
    );
  }

  async explainCode(code: string, language: string): Promise<string> {
    return this.executeWithFallback(
      (provider) => provider.explainCode(code, language),
      'explanation',
      'All models failed for code explanation'
    );
  }

  async healthCheck(): Promise<boolean> {
    const results = await Promise.allSettled(
      Array.from(this.providers.values()).map(provider => provider.healthCheck())
    );
    return results.some(result => result.status === 'fulfilled' && result.value === true);
  }

  async getAvailableModels(): Promise<string[]> {
    return this.modelConfigs.map(config => config.name);
  }

  async generateErrorFixes(request: any, errorAnalysis: any): Promise<any[]> {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request object');
    }
    if (!errorAnalysis || typeof errorAnalysis !== 'object') {
      throw new Error('Invalid error analysis object');
    }
    try {
      return await this.executeWithFallback(
        (provider) => provider.generateErrorFixes(request, errorAnalysis),
        'error_fixing',
        'All models failed for error fixing'
      );
    } catch (error) {
      console.warn('Error fix generation failed:', error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }

  async generateQuickFixes(request: any): Promise<any[]> {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request object');
    }
    try {
      return await this.executeWithFallback(
        (provider) => provider.generateQuickFixes(request),
        'quick_fixes',
        'All models failed for quick fixes'
      );
    } catch (error) {
      console.warn('Quick fix generation failed:', error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }

  async validateCodeFix(request: any): Promise<any> {
    try {
      return await this.executeWithFallback(
        (provider) => provider.validateCodeFix(request),
        'validation',
        'All models failed for validation'
      );
    } catch (error) {
      console.warn('Code fix validation failed:', error instanceof Error ? error.message : 'Unknown error');
      return { isValid: false, confidence: 0, explanation: 'All models failed' };
    }
  }

  private supportsCapability(modelName: string, capability: string): boolean {
    const config = this.modelConfigs.find(c => c.name === modelName);
    return config?.capabilities.includes(capability) || false;
  }

  setFallbackOrder(order: string[]): void {
    this.fallbackOrder = order.filter(name => this.providers.has(name));
  }

  getModelStats(): Record<string, any> {
    return Object.fromEntries(
      this.modelConfigs.map(config => [
        config.name,
        {
          provider: config.provider,
          capabilities: config.capabilities,
          available: this.providers.has(config.name)
        }
      ])
    );
  }
}