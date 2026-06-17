/**
 * Core tools: code_completion, code_generation, chat_assistant
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling } from './toolHelper.js';
import { CodeCompletionRequest, CodeAnalysisRequest } from '../types/index.js';

export function createCoreTools(deps: ToolDependencies): MCPTool[] {
  return [
    createCodeCompletionTool(deps),
    createCodeGenerationTool(deps),
    createChatAssistantTool(deps),
  ];
}

// ---------------------------------------------------------------------------
// code_completion
// ---------------------------------------------------------------------------
function createCodeCompletionTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'code_completion',
    'Generate intelligent code completions using Ollama',
    {
      code: { type: 'string', description: 'The current code content' },
      language: { type: 'string', description: 'Programming language' },
      position: {
        type: 'object',
        properties: { line: { type: 'number' }, character: { type: 'number' } },
        description: 'Cursor position',
      },
      context: { type: 'object', description: 'Additional context' },
      prefix: { type: 'string', description: 'Code prefix for completion' },
      prompt: { type: 'string', description: 'Natural language prompt' },
      maxTokens: { type: 'number', description: 'Maximum tokens to generate' },
    },
    ['language'],
    async (params: any) => {
      return withErrorHandling(
        async () => {
          const p = params as {
            code?: string; language?: string;
            position?: { line: number; character: number };
            context?: Record<string, unknown>;
            prefix?: string; prompt?: string; maxTokens?: number;
          };
          if (!p.language) throw new Error('Missing required parameter: language');

          if (p.code && p.position) {
            return handleIDECompletion(deps, p, params);
          }

          const ctx = p.prefix || p.prompt || p.code;
          if (!ctx) {
            throw new Error('Missing required parameters: provide either (code+position) or (prefix/prompt/code)');
          }
          return handlePrefixCompletion(deps, p, ctx, params);
        },
        () => ({
          suggestions: [],
          metadata: {
            model: deps.config?.model || 'unknown',
            processingTime: 0,
            confidence: 0,
            error: 'Code completion failed',
          },
        }),
      );
    },
  );
}

async function handleIDECompletion(deps: ToolDependencies, p: any, params: unknown) {
  const cacheKey = generateCacheKey('completion:pos', params);
  const cached = deps.cacheManager.get(cacheKey);
  if (cached) return cached;

  const req: CodeCompletionRequest = { code: p.code, language: p.language, position: p.position };
  if (p.context) req.context = normalizeContext(p.context);

  const res = await deps.ollamaProvider.generateCompletion(req);
  if (res.suggestions?.length) deps.cacheManager.set(cacheKey, res, 300000);
  return res;
}

async function handlePrefixCompletion(deps: ToolDependencies, p: any, ctx: string, params: unknown) {
  const cacheKey = generateCacheKey('completion:prefix', { language: p.language, prefix: ctx, maxTokens: p.maxTokens });
  const cached = deps.cacheManager.get(cacheKey);
  if (cached) return cached;

  const suggestions = await generatePrefixSuggestions(deps, ctx, p.language, p.maxTokens);
  const result = {
    suggestions,
    metadata: {
      model: deps.config?.model || 'unknown',
      mode: 'prefix',
      processingTime: 0,
      confidence: suggestions.length ? 0.6 : 0,
    },
  };
  if (suggestions.length) deps.cacheManager.set(cacheKey, result, 300000);
  return result;
}

async function generatePrefixSuggestions(deps: ToolDependencies, ctx: string, language: string, maxTokens?: number): Promise<string[]> {
  try {
    const providerAny = deps.ollamaProvider as any;
    if (typeof providerAny.completeCode === 'function') {
      const out = await providerAny.completeCode({ prefix: ctx, language, maxTokens });
      return Array.isArray(out) ? out : [];
    }
    const lines = ctx.split('\n');
    const line = Math.max(0, lines.length - 1);
    const character = (lines[lines.length - 1]?.length) || 0;
    const res = await deps.ollamaProvider.generateCompletion({ code: ctx, language, position: { line, character } });
    return (res.suggestions || [])
      .map((s: any) => (typeof s === 'string' ? s : s?.text || s?.completion || ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeContext(context: Record<string, unknown>) {
  const result: { fileName?: string; projectPath?: string; imports?: string[]; functions?: string[]; variables?: string[] } = {};
  if (typeof context.fileName === 'string') result.fileName = context.fileName;
  if (typeof context.projectPath === 'string') result.projectPath = context.projectPath;
  if (Array.isArray(context.imports)) result.imports = context.imports;
  if (Array.isArray(context.functions)) result.functions = context.functions;
  if (Array.isArray(context.variables)) result.variables = context.variables;
  return result;
}

// ---------------------------------------------------------------------------
// code_generation
// ---------------------------------------------------------------------------
function createCodeGenerationTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'code_generation',
    'Generate code from descriptions',
    {
      prompt: { type: 'string', description: 'Code generation prompt' },
      language: { type: 'string', description: 'Target language' },
      context: { type: 'object', description: 'Additional context' },
    },
    ['prompt', 'language'],
    async (params: any) => {
      const { prompt, language, context } = params;
      if (!prompt || !language) throw new Error('Missing required parameters: prompt, language');

      let enhancedPrompt = prompt;
      if (context) {
        enhancedPrompt = `${prompt}\n\nContext: ${serializeContext(context)}`;
      }
      try {
        const generatedCode = await deps.ollamaProvider.generateCode(enhancedPrompt, language);
        return { code: generatedCode, language, metadata: { prompt, context, generatedAt: new Date().toISOString() } };
      } catch (error) {
        return { code: '', language, error: error instanceof Error ? error.message : String(error), metadata: { prompt, context, generatedAt: new Date().toISOString() } };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// chat_assistant
// ---------------------------------------------------------------------------
function createChatAssistantTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'chat_assistant',
    'AI chat assistant for coding questions',
    {
      query: { type: 'string', description: 'User query' },
      messages: { type: 'array', description: 'Conversation history' },
      context: { type: 'object', description: 'Additional context' },
      language: { type: 'string', description: 'Programming language' },
      model: { type: 'string', description: 'Model to use' },
      workspacePath: { type: 'string', description: 'Optional project workspace path' },
    },
    ['query'],
    async (params: any) => {
      return withErrorHandling(
        async () => {
          const { query, messages, context, language, model, workspacePath } = params;
          if (!query) throw new Error('Missing required parameter: query');

          if (query.toLowerCase().includes('who are you')) {
            return 'I am a coding assistant designed to help you with programming tasks, code analysis, debugging, and software development.';
          }

          const normalizedMessages = Array.isArray(messages)
            ? messages
                .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
                .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content!.trim() }))
                .slice(-20)
            : [];

          let semanticCodeContext = '';
          let codebaseOverview = '';
          const targetWorkspace = workspacePath || (context && typeof context === 'object' && context.workspacePath);
          if (targetWorkspace) {
            try {
              const { CodebaseIndexerRegistry } = await import('../indexing/CodebaseIndexerRegistry.js');
              const indexer = CodebaseIndexerRegistry.get(targetWorkspace);
              await indexer.load();
              if (indexer.getStatus().chunkCount === 0) {
                await indexer.indexWorkspace();
              }
              deps.enhancedContext.populateFromIndexer(indexer.getChunks());
              
              const isProjectQuery = 
                query.toLowerCase().includes('all files') ||
                query.toLowerCase().includes('read files') ||
                query.toLowerCase().includes('complete project') ||
                query.toLowerCase().includes('entire project') ||
                query.toLowerCase().includes('whole codebase') ||
                query.toLowerCase().includes('project structure') ||
                query.toLowerCase().includes('codebase overview');

              if (isProjectQuery) {
                const chunksMap = indexer['chunks'];
                const indexedFiles = Array.from(new Set(Array.from(chunksMap.values()).map((c: any) => c.filePath)));
                if (indexedFiles.length > 0) {
                  codebaseOverview = `### Codebase File Structure:\n${indexedFiles.map(f => `- ${f}`).join('\n')}\n\n`;
                  
                  const importantFiles = indexedFiles.filter(f => 
                    f === 'package.json' || 
                    f.includes('index.ts') || 
                    f.includes('index.js') ||
                    f.includes('main.py') || 
                    f.includes('server.ts')
                  ).slice(0, 3);
                  
                  const fsMod = await import('fs/promises');
                  const pathMod = await import('path');
                  for (const file of importantFiles) {
                    try {
                      const fullPath = pathMod.join(targetWorkspace, file);
                      const fileContent = await fsMod.readFile(fullPath, 'utf-8');
                      codebaseOverview += `### Content of ${file}:\n\`\`\`\n${fileContent.substring(0, 4000)}\n\`\`\`\n\n`;
                    } catch {}
                  }
                }
              }

              if (indexer.getStatus().chunkCount > 0 && !codebaseOverview) {
                const hits = await indexer.search(query, 5);
                if (hits && hits.length > 0) {
                  try {
                    const { SymbolResolver } = await import('../indexing/SymbolResolver.js');
                    const allChunks = indexer.getChunks();
                    const resolver = new SymbolResolver(allChunks);

                    const displayedKeys = new Set<string>(hits.map(h => `${h.filePath}:${h.symbolName}`));
                    const resolvedContexts: string[] = [];

                    const hitContexts = hits.map(hit => {
                      const hitChunk = (allChunks.find(c => c.id === hit.id) || {
                        id: hit.id,
                        filePath: hit.filePath,
                        language: (hit as any).language || language || 'typescript',
                        symbolName: hit.symbolName,
                        symbolType: hit.symbolType as any,
                        startLine: hit.startLine,
                        endLine: hit.endLine,
                        content: hit.code,
                        contentHash: '',
                        embedding: []
                      }) as any;

                      const references = resolver.resolveReferences(hitChunk, allChunks, 1);
                      for (const [key, ref] of references) {
                        if (!displayedKeys.has(key)) {
                          displayedKeys.add(key);
                          resolvedContexts.push(
                            `### Referenced Symbol: ${ref.symbolName} (defined in ${ref.definitionChunk.filePath} lines ${ref.definitionChunk.startLine}-${ref.definitionChunk.endLine})\n` +
                            `*Referenced in: ${ref.referencedBy}*\n` +
                            `\`\`\`${ref.definitionChunk.language || 'typescript'}\n${ref.definitionChunk.content}\n\`\`\``
                          );
                        }
                      }

                      return `### File: ${hit.filePath} (lines ${hit.startLine}-${hit.endLine})\n\`\`\`${language || (hit as any).language || 'typescript'}\n${hit.code}\n\`\`\``;
                    });

                    // Pull in symbols explicitly mentioned in the query
                    const queryWords = query.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
                    for (const qWord of queryWords) {
                      const potentialNames = SymbolResolver.getPotentialSymbolNames(qWord);
                      for (const name of potentialNames) {
                        const targetChunk = resolver.getSymbolChunk(name);
                        if (targetChunk) {
                          const key = `${targetChunk.filePath}:${targetChunk.symbolName}`;
                          if (!displayedKeys.has(key)) {
                            displayedKeys.add(key);
                            resolvedContexts.push(
                              `### Explicitly Mentioned Symbol: ${targetChunk.symbolName} (defined in ${targetChunk.filePath} lines ${targetChunk.startLine}-${targetChunk.endLine})\n` +
                              `\`\`\`${targetChunk.language || 'typescript'}\n${targetChunk.content}\n\`\`\``
                            );
                          }
                        }
                      }
                    }

                    semanticCodeContext = hitContexts.join('\n\n');
                    if (resolvedContexts.length > 0) {
                      semanticCodeContext += `\n\n## Cross-File Referenced Symbol Definitions:\n\n` + resolvedContexts.join('\n\n');
                    }
                  } catch (resolveErr) {
                    deps.logger.warn(`Symbol resolution failed: ${resolveErr}`);
                    semanticCodeContext = hits.map(hit => 
                      `### File: ${hit.filePath} (lines ${hit.startLine}-${hit.endLine})\n\`\`\`${language || 'typescript'}\n${hit.code}\n\`\`\``
                    ).join('\n\n');
                  }
                }
              }
            } catch (err) {
              deps.logger.warn(`Semantic codebase search in chat assistant failed: ${err}`);
            }
          }

          let activeFileGrounding = '';
          if (context && typeof context === 'object') {
            if (context.activeFilePath) {
              activeFileGrounding += `### Currently Active File in Editor:\n- Path: ${context.activeFilePath}\n`;
              if (context.code && typeof context.code === 'string' && context.code.trim().length > 0) {
                activeFileGrounding += `- Content/Selection:\n\`\`\`${context.language || 'typescript'}\n${context.code}\n\`\`\`\n\n`;
              }
            }
          }

          let enrichedQuery = query;
          if (activeFileGrounding) {
            enrichedQuery = `${activeFileGrounding}${enrichedQuery}`;
          }

          if (codebaseOverview) {
            enrichedQuery = `Here is the codebase structure and key files overview:\n\n${codebaseOverview}\n\nUser Request: ${enrichedQuery}`;
          } else if (semanticCodeContext) {
            enrichedQuery = `Here is some relevant context/code from the codebase:\n\n${semanticCodeContext}\n\nUser Question: ${enrichedQuery}`;
          }

          if (normalizedMessages.length > 0) {
            return await deps.ollamaProvider.handleChatRequest({ query: enrichedQuery, messages: normalizedMessages, context, language, model });
          }

          // Prepend project rules (AGENTS.md / .coding-ai/rules) if present
          let rulesSection = '';
          try {
            const { RulesLoader } = await import('../config/RulesLoader.js');
            const workspacePath = (context as any)?.workspacePath as string | undefined;
            const rules = RulesLoader.load(workspacePath || process.cwd());
            if (rules) rulesSection = `${rules}\n\n`;
          } catch { /* best-effort */ }

          let prompt = `${rulesSection}You are an expert coding assistant in a VS Code extension.\n\nUser request:\n${enrichedQuery}\n\nBehavior:\n- Answer directly and practically.\n- Prefer correct, minimal solutions over broad essays.\n- If code is requested, provide complete runnable snippets with brief notes.\n- If the request is ambiguous, state the assumption you are making.\n- Do not claim to have performed file edits, commands, tests, or network calls unless tool output proves it.\n- When diagnosing code, explain the cause, the fix, and any verification step.`;
          if (context) prompt += `\n\nContext:\n${typeof context === 'string' ? context : JSON.stringify(context)}`;
          if (language) prompt += `\n\nPrimary language: ${language}`;

          return await deps.ollamaProvider.generateText({ prompt, model: model || deps.config.model });
        },
        () => 'Coding assistant is currently unavailable.',
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
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

function serializeContext(context: Record<string, unknown>): string {
  try {
    const limitedContext: Record<string, string> = {};
    let charCount = 0;
    const maxChars = 2000;
    for (const [key, value] of Object.entries(context)) {
      if (charCount >= maxChars) break;
      let serializedValue: string;
      if (typeof value === 'string') {
        serializedValue = value.substring(0, 500);
      } else if (Array.isArray(value)) {
        serializedValue = JSON.stringify(value.slice(0, 10));
      } else {
        serializedValue = JSON.stringify(value);
      }
      limitedContext[key] = serializedValue;
      charCount += serializedValue.length;
    }
    return JSON.stringify(limitedContext);
  } catch {
    return '{"error": "Context serialization failed"}';
  }
}
