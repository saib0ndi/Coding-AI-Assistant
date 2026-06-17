/**
 * Inline tools: inline_suggestion, multi_file_suggestion, ghost_text, streaming_suggestion, suggestion_filter, multi_model, context_window
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling } from './toolHelper.js';
import { parsePositiveInteger } from '../config/AppConfig.js';

export function createInlineTools(deps: ToolDependencies): MCPTool[] {
  return [
    createInlineSuggestionTool(deps),
    createMultiFileSuggestionTool(deps),
    createGhostTextTool(deps),
    createStreamingSuggestionTool(deps),
    createSuggestionFilterTool(deps),
    createMultiModelTool(deps),
    createContextWindowTool(deps),
  ];
}

// ---------------------------------------------------------------------------
// inline_suggestion
// ---------------------------------------------------------------------------
function createInlineSuggestionTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'inline_suggestion',
    'Real-time inline code suggestions as you type',
    {
      code: { type: 'string', description: 'Current code content' },
      position: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
      language: { type: 'string', description: 'Programming language' },
      triggerKind: { type: 'string', enum: ['typing', 'invoke', 'auto'], description: 'How suggestion was triggered' },
      context: { type: 'object', description: 'Editor context and open files' }
    },
    ['code', 'position', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, position, language, triggerKind = 'typing' } = params as {
            code?: string; position?: { line: number; character: number }; language?: string;
            triggerKind?: string; context?: any;
          };

          if (code === undefined || code === null || !position || !language) {
            throw new Error('Missing required parameters: code, position, language');
          }

          if (code.trim() === '') {
            return {
              suggestions: [],
              triggerKind,
              position,
              ghostText: '',
              confidence: 0,
              timestamp: new Date().toISOString()
            };
          }

          const suggestion = await deps.ollamaProvider.generateCompletion({
            code, language, position
          });

          const suggestions = Array.isArray(suggestion.suggestions) ? suggestion.suggestions : [];
          const firstSuggestion = suggestions.length > 0 ? suggestions.slice(0, 1)[0] : null;
          const ghostText = firstSuggestion && typeof firstSuggestion.text === 'string' ? firstSuggestion.text : '';

          return {
            suggestions,
            triggerKind,
            position,
            ghostText,
            confidence: suggestion.metadata?.confidence || 0,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            suggestions: [],
            triggerKind: p?.triggerKind || 'typing',
            position: p?.position || { line: 0, character: 0 },
            ghostText: '',
            confidence: 0,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// multi_file_suggestion
// ---------------------------------------------------------------------------
function createMultiFileSuggestionTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'multi_file_suggestion',
    'Context-aware suggestions using multiple open files',
    {
      currentFile: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
      openFiles: { type: 'array', items: { type: 'object' } },
      position: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
      language: { type: 'string', description: 'Programming language' },
      projectContext: { type: 'object', description: 'Project-wide context' }
    },
    ['currentFile', 'position', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { currentFile, openFiles = [], position, language, projectContext } = params as {
            currentFile?: { path: string; content: string };
            openFiles?: any[]; position?: { line: number; character: number };
            language?: string; projectContext?: any;
          };

          if (!currentFile || !position || !language) {
            throw new Error('Missing required parameters');
          }

          buildMultiFileContext(currentFile, openFiles, projectContext);
          const suggestion = await deps.ollamaProvider.generateCompletion({
            code: currentFile.content,
            language,
            position
          });

          return {
            suggestions: suggestion.suggestions || [],
            contextFiles: openFiles.length,
            confidence: suggestion.metadata?.confidence || 0,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          return {
            suggestions: [],
            contextFiles: 0,
            confidence: 0,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// ghost_text
// ---------------------------------------------------------------------------
function createGhostTextTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'ghost_text',
    'Generate ghost text for inline display in editor',
    {
      code: { type: 'string', description: 'Current code content' },
      position: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
      language: { type: 'string', description: 'Programming language' },
      maxLength: { type: 'number', description: 'Maximum ghost text length', default: 100 },
      style: { type: 'string', enum: ['completion', 'suggestion', 'snippet'], description: 'Ghost text style' }
    },
    ['code', 'position', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, position, language, maxLength = 100, style = 'completion' } = params as {
            code?: string; position?: { line: number; character: number };
            language?: string; maxLength?: number; style?: string;
          };

          if (code === undefined || code === null || !position || !language) {
            throw new Error('Missing required parameters');
          }

          if (code.trim() === '') {
            return {
              ghostText: '',
              style,
              confidence: 0,
              position,
              maxLength,
              timestamp: new Date().toISOString()
            };
          }

          const suggestion = await deps.ollamaProvider.generateCompletion({
            code, language, position
          });
          
          const firstSug = Array.isArray(suggestion.suggestions) ? suggestion.suggestions.slice(0, 1)[0] : null;
          const ghostText = (firstSug?.text || '').substring(0, maxLength);

          return {
            ghostText,
            style,
            confidence: suggestion.metadata?.confidence || 0,
            position,
            maxLength,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            ghostText: '',
            style: p?.style || 'completion',
            confidence: 0,
            position: p?.position || { line: 0, character: 0 },
            maxLength: p?.maxLength || 100,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// streaming_suggestion
// ---------------------------------------------------------------------------
function createStreamingSuggestionTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'streaming_suggestion',
    'Real-time streaming suggestions as user types',
    {
      code: { type: 'string', description: 'Current code content' },
      position: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
      language: { type: 'string', description: 'Programming language' },
      streamId: { type: 'string', description: 'Stream identifier' },
      partial: { type: 'boolean', description: 'Partial input flag' }
    },
    ['code', 'position', 'language', 'streamId'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, position, language, streamId, partial = false } = params as {
            code?: string; position?: { line: number; character: number };
            language?: string; streamId?: string; partial?: boolean;
          };

          if (code === undefined || code === null || !position || !language || !streamId) {
            throw new Error('Missing required parameters');
          }

          if (code.trim() === '') {
            return {
              streamId,
              suggestion: '',
              confidence: 0,
              partial,
              timestamp: new Date().toISOString()
            };
          }

          const suggestion = await deps.ollamaProvider.generateCompletion({
            code, language, position
          });

          const firstSug = Array.isArray(suggestion.suggestions) ? suggestion.suggestions.slice(0, 1)[0] : null;

          return {
            streamId,
            suggestion: firstSug?.text || '',
            confidence: suggestion.metadata?.confidence || 0,
            partial,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            streamId: p?.streamId || '',
            suggestion: '',
            confidence: 0,
            partial: false,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// suggestion_filter
// ---------------------------------------------------------------------------
function createSuggestionFilterTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'suggestion_filter',
    'Filter and rank suggestions by confidence and context',
    {
      suggestions: { type: 'array', items: { type: 'object' }, description: 'Raw suggestions' },
      context: { type: 'object', description: 'Current context' },
      userPreferences: { type: 'object', description: 'User preferences and history' },
      language: { type: 'string', description: 'Programming language' }
    },
    ['suggestions'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { suggestions = [], context, userPreferences, language } = params as {
            suggestions?: any[]; context?: any; userPreferences?: any; language?: string;
          };

          const filtered = filterSuggestions(suggestions, context, userPreferences, language || 'unknown');
          const ranked = rankSuggestions(filtered);

          return {
            originalCount: suggestions.length,
            filteredCount: filtered.length,
            suggestions: ranked,
            filters: ['confidence', 'context', 'preferences'],
            timestamp: new Date().toISOString()
          };
        },
        () => ({
          originalCount: 0,
          filteredCount: 0,
          suggestions: [],
          filters: ['confidence', 'context', 'preferences'],
          timestamp: new Date().toISOString()
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// multi_model
// ---------------------------------------------------------------------------
function createMultiModelTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'multi_model',
    'Switch between different AI models and combine results',
    {
      models: { type: 'array', items: { type: 'string' }, description: 'Models to use' },
      prompt: { type: 'string', description: 'Input prompt' },
      strategy: { type: 'string', enum: ['best', 'consensus', 'fallback'], description: 'Multi-model strategy' },
      language: { type: 'string', description: 'Programming language' }
    },
    ['models', 'prompt'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { models = [], prompt, strategy = 'best', language } = params as {
            models?: string[]; prompt?: string; strategy?: string; language?: string;
          };

          if (!models.length || !prompt) {
            throw new Error('Missing required parameters');
          }

          const results = await executeMultiModel(deps, models, prompt, strategy, language);

          return {
            models,
            strategy,
            results,
            bestResult: results.length > 0 ? results.slice(0, 1)[0] : null,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            models: p?.models || [],
            strategy: p?.strategy || 'best',
            results: [],
            bestResult: null,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// context_window
// ---------------------------------------------------------------------------
function createContextWindowTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'context_window',
    'Smart context window management with automatic file selection',
    {
      currentFile: { type: 'string', description: 'Current file path' },
      position: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
      workspaceRoot: { type: 'string', description: 'Workspace root path' },
      maxFiles: { type: 'number', description: 'Maximum files to include', default: 10 },
      includeTests: { type: 'boolean', description: 'Include test files', default: false }
    },
    ['currentFile', 'position'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { currentFile, position, maxFiles = 10, includeTests = false } = params as {
            currentFile?: string; position?: { line: number; character: number };
            workspaceRoot?: string; maxFiles?: number; includeTests?: boolean;
          };

          if (!currentFile || !position) {
            throw new Error('Missing required parameters');
          }

          const contextFiles = [{ path: currentFile, relevance: 1.0 }];
          const contextWindow = `Current file: ${currentFile}\nPosition: ${position.line}:${position.character}`;

          return {
            contextFiles: contextFiles.map(f => f.path),
            contextWindow,
            totalFiles: contextFiles.length,
            includeTests,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            contextFiles: [],
            contextWindow: '',
            totalFiles: 0,
            includeTests: p?.includeTests || false,
            timestamp: new Date().toISOString()
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildMultiFileContext(currentFile: any, openFiles: any[], projectContext: any): string {
  let context = `Current file: ${currentFile.path}\n`;
  context += `Open files: ${openFiles.map(f => f.path || 'untitled').join(', ')}\n`;
  if (projectContext) {
    context += `Project: ${JSON.stringify(projectContext).substring(0, 500)}\n`;
  }
  return context;
}

export async function generateLSPAwareSuggestions(deps: ToolDependencies, uri: string, position: any, language: string, lspContext: any): Promise<any[]> {
  const prompt = `Generate code suggestions for ${language} at position ${position.line}:${position.character}\nLSP Context: ${JSON.stringify(lspContext)}`;
  const response = await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
  return [{ text: response, confidence: 0.8, lspAware: true }];
}

export function buildLSPContext(syntaxTree: any, symbols: any[], position: any): any {
  return {
    syntaxTree: syntaxTree ? JSON.stringify(syntaxTree).substring(0, parsePositiveInteger(process.env.MAX_SYNTAX_TREE_LENGTH, 1000)) : null,
    symbols: symbols.slice(0, 20),
    position
  };
}

function rankSuggestions(suggestions: any[]): any[] {
  return suggestions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

function filterSuggestions(suggestions: any[], context: any, userPreferences: any, language: string): any[] {
  return suggestions.filter(s => {
    if (s.confidence < 0.3) return false;
    if (language && s.language && s.language !== language) return false;
    return true;
  });
}

async function executeMultiModel(deps: ToolDependencies, models: string[], prompt: string, strategy: string, language?: string): Promise<any[]> {
  const results = [];
  const modelPromises = models.slice(0, 3).map(async (model) => {
    try {
      const response = await deps.ollamaProvider.generateText({ prompt, model });
      return { model, response, confidence: 0.7 };
    } catch (error) {
      return { model, error: 'Model failed', confidence: 0 };
    }
  });
  
  const responses = await Promise.all(modelPromises);
  results.push(...responses);
  return results.sort((a, b) => b.confidence - a.confidence);
}

export async function getMultiModelConsensus(deps: ToolDependencies, prompt: string, language: string, models?: string[]): Promise<any> {
  const providerAny = deps.ollamaProvider as any;
  const getModelFn = typeof providerAny.getModel === 'function' ? providerAny.getModel.bind(providerAny) : () => deps.config.model;
  
  const targetModels = models || [
    getModelFn(undefined, 'fast'),
    getModelFn(undefined, 'code')
  ];
  
  const responses = await Promise.allSettled(
    targetModels.slice(0, 3).map(model => 
      deps.ollamaProvider.generateText({ prompt, model })
    )
  );

  const validResponses = responses
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<string>).value);

  return {
    consensus: validResponses.slice(0, 1)[0] || 'No consensus available',
    confidence: validResponses.length / targetModels.length,
    responses: validResponses,
    models: targetModels.slice(0, validResponses.length)
  };
}
