/**
 * Copilot tools: explain_code, refactor_code, generate_tests, generate_docs, security_scan, optimize_performance, translate_code, suggest_imports, slash_command
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling, sharedExplainCode, sharedRefactorCode } from './toolHelper.js';
import { DEFAULT_OLLAMA_MODEL } from '../config/AppConfig.js';

export function createCopilotTools(deps: ToolDependencies): MCPTool[] {
  return [
    createExplainCodeTool(deps),
    createRefactorCodeTool(deps),
    createGenerateTestsTool(deps),
    createGenerateDocsTool(deps),
    createSecurityScanTool(deps),
    createOptimizePerformanceTool(deps),
    createTranslateCodeTool(deps),
    createSuggestImportsTool(deps),
    createSlashCommandTool(deps),
  ];
}

// ---------------------------------------------------------------------------
// explain_code
// ---------------------------------------------------------------------------
function createExplainCodeTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'explain_code',
    'Explain code functionality and structure',
    {
      code: { type: 'string', description: 'Code to explain' },
      language: { type: 'string', description: 'Programming language' },
      detail: { type: 'string', enum: ['brief', 'detailed', 'comprehensive'], description: 'Level of explanation' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, detail = 'detailed', model } = params as {
            code?: string;
            language?: string;
            detail?: string;
            model?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const targetModel = model || deps.config.model || DEFAULT_OLLAMA_MODEL;
          const explanation = await sharedExplainCode(deps, code, language, targetModel, detail);

          return {
            explanation,
            code,
            language,
            detail,
            model: targetModel,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            explanation: 'Code explanation failed.',
            code: p?.code || '',
            language: p?.language || 'unknown',
            detail: p?.detail || 'detailed',
            model: p?.model || 'unknown',
            timestamp: new Date().toISOString(),
            error: 'Explanation processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// refactor_code
// ---------------------------------------------------------------------------
function createRefactorCodeTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'refactor_code',
    'Suggest code refactoring improvements',
    {
      code: { type: 'string', description: 'Code to refactor' },
      language: { type: 'string', description: 'Programming language' },
      focus: { type: 'string', enum: ['readability', 'performance', 'maintainability', 'all'], description: 'Refactoring focus' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, focus = 'all' } = params as {
            code?: string;
            language?: string;
            focus?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const refactoredCode = await sharedRefactorCode(deps, code, language, focus);

          return {
            originalCode: code,
            refactoredCode,
            language,
            focus,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            originalCode: p?.code || '',
            refactoredCode: 'Refactoring failed.',
            language: p?.language || 'unknown',
            focus: p?.focus || 'all',
            timestamp: new Date().toISOString(),
            error: 'Refactoring processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// generate_tests
// ---------------------------------------------------------------------------
function createGenerateTestsTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'generate_tests',
    'Generate unit tests for code',
    {
      code: { type: 'string', description: 'Code to test' },
      language: { type: 'string', description: 'Programming language' },
      framework: { type: 'string', description: 'Testing framework (jest, mocha, pytest, etc.)' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, framework } = params as {
            code?: string;
            language?: string;
            framework?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          let prompt = `Generate unit tests for this ${language} code:`;
          if (framework) prompt += ` using ${framework} framework`;
          prompt += `\n\n${code}\n\nProvide complete test cases:`;

          const tests = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          return {
            originalCode: code,
            tests,
            language,
            framework: framework || 'default',
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            originalCode: p?.code || '',
            tests: 'Test generation failed.',
            language: p?.language || 'unknown',
            framework: p?.framework || 'default',
            timestamp: new Date().toISOString(),
            error: 'Test generation processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// generate_docs
// ---------------------------------------------------------------------------
function createGenerateDocsTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'generate_docs',
    'Generate documentation for code',
    {
      code: { type: 'string', description: 'Code to document' },
      language: { type: 'string', description: 'Programming language' },
      style: { type: 'string', enum: ['jsdoc', 'sphinx', 'javadoc', 'markdown'], description: 'Documentation style' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, style = 'markdown' } = params as {
            code?: string;
            language?: string;
            style?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const prompt = `Generate ${style} documentation for this ${language} code:\n\n${code}\n\nProvide comprehensive documentation:`;
          const documentation = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          return {
            originalCode: code,
            documentation,
            language,
            style,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            originalCode: p?.code || '',
            documentation: 'Documentation generation failed.',
            language: p?.language || 'unknown',
            style: p?.style || 'markdown',
            timestamp: new Date().toISOString(),
            error: 'Documentation processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// security_scan
// ---------------------------------------------------------------------------
function createSecurityScanTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'security_scan',
    'Scan code for security vulnerabilities',
    {
      code: { type: 'string', description: 'Code to scan' },
      language: { type: 'string', description: 'Programming language' },
      severity: { type: 'string', enum: ['all', 'high', 'critical'], description: 'Minimum severity level' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, severity = 'all' } = params as {
            code?: string;
            language?: string;
            severity?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const prompt = `Scan this ${language} code for security vulnerabilities (${severity} severity):\n\n${code}\n\nList vulnerabilities with severity levels and fixes:`;
          const scanResult = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          const vulnerabilities = parseSecurityScan(scanResult);

          return {
            code,
            language,
            severity,
            vulnerabilities,
            scanResult,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            code: p?.code || '',
            language: p?.language || 'unknown',
            severity: p?.severity || 'all',
            vulnerabilities: [],
            scanResult: 'Security scan failed.',
            timestamp: new Date().toISOString(),
            error: 'Security scan failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// optimize_performance
// ---------------------------------------------------------------------------
function createOptimizePerformanceTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'optimize_performance',
    'Suggest performance optimizations',
    {
      code: { type: 'string', description: 'Code to optimize' },
      language: { type: 'string', description: 'Programming language' },
      target: { type: 'string', enum: ['speed', 'memory', 'both'], description: 'Optimization target' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, target = 'both' } = params as {
            code?: string;
            language?: string;
            target?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          const prompt = `Optimize this ${language} code for ${target}:\n\n${code}\n\nProvide optimized code with performance improvements:`;
          const optimizedCode = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          return {
            originalCode: code,
            optimizedCode,
            language,
            target,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            originalCode: p?.code || '',
            optimizedCode: 'Performance optimization failed.',
            language: p?.language || 'unknown',
            target: p?.target || 'both',
            timestamp: new Date().toISOString(),
            error: 'Optimization processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// translate_code
// ---------------------------------------------------------------------------
function createTranslateCodeTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'translate_code',
    'Convert code between programming languages',
    {
      code: { type: 'string', description: 'Code to translate' },
      fromLanguage: { type: 'string', description: 'Source language' },
      toLanguage: { type: 'string', description: 'Target language' },
      preserveComments: { type: 'boolean', description: 'Keep original comments' }
    },
    ['code', 'fromLanguage', 'toLanguage'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, fromLanguage, toLanguage, preserveComments = true } = params as {
            code?: string;
            fromLanguage?: string;
            toLanguage?: string;
            preserveComments?: boolean;
          };

          if (!code || !fromLanguage || !toLanguage) {
            throw new Error('Missing required parameters: code, fromLanguage, toLanguage');
          }

          let prompt = `Convert this ${fromLanguage} code to ${toLanguage}:`;
          if (preserveComments) prompt += ' (preserve comments)';
          prompt += `\n\n${code}\n\nProvide equivalent code:`;

          const translatedCode = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          return {
            originalCode: code,
            translatedCode,
            fromLanguage,
            toLanguage,
            preserveComments,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            originalCode: p?.code || '',
            translatedCode: 'Code translation failed.',
            fromLanguage: p?.fromLanguage || 'unknown',
            toLanguage: p?.toLanguage || 'unknown',
            preserveComments: p?.preserveComments || true,
            timestamp: new Date().toISOString(),
            error: 'Translation processing failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// suggest_imports
// ---------------------------------------------------------------------------
function createSuggestImportsTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'suggest_imports',
    'Suggest import statements and dependencies',
    {
      code: { type: 'string', description: 'Code needing imports' },
      language: { type: 'string', description: 'Programming language' },
      framework: { type: 'string', description: 'Framework context (react, vue, express, etc.)' }
    },
    ['code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { code, language, framework } = params as {
            code?: string;
            language?: string;
            framework?: string;
          };

          if (!code || !language) {
            throw new Error('Missing required parameters: code, language');
          }

          let prompt = `Suggest import statements for this ${language} code:`;
          if (framework) prompt += ` (${framework} framework)`;
          prompt += `\n\n${code}\n\nProvide necessary imports:`;

          const suggestions = await deps.ollamaProvider.generateText({
            prompt,
            model: deps.config.model
          });

          const imports = parseImportSuggestions(suggestions, language);

          return {
            code,
            language,
            framework: framework || null,
            imports,
            suggestions,
            timestamp: new Date().toISOString()
          };
        },
        () => {
          const p = params as any;
          return {
            code: p?.code || '',
            language: p?.language || 'unknown',
            framework: null,
            imports: [],
            suggestions: 'Import suggestion failed.',
            timestamp: new Date().toISOString(),
            error: 'Import suggestion failed'
          };
        },
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// slash_command
// ---------------------------------------------------------------------------
function createSlashCommandTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'slash_command',
    'Handle Copilot-style slash commands (/fix, /explain, /tests, /doc, /optimize, /refactor, /generate, etc.)',
    {
      command: { type: 'string', enum: ['/fix', '/explain', '/tests', '/doc', '/optimize', '/refactor', '/generate'], description: 'Slash command' },
      code: { type: 'string', description: 'Selected code' },
      language: { type: 'string', description: 'Programming language' },
      context: { type: 'string', description: 'Additional context' }
    },
    ['command', 'code', 'language'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { command, code, language, context, model } = params as {
            command?: string; code?: string; language?: string; context?: string; model?: string;
          };

          if (!command) {
            throw new Error('Missing required parameter: command');
          }

          const targetModel = model || deps.config.model || DEFAULT_OLLAMA_MODEL;

          if (command === 'chat' || command === '/chat') {
            const query = code || context || 'Hello';
            
            if (query.toLowerCase().includes('who are you')) {
              return 'I am a coding assistant designed to help you with programming tasks, code analysis, debugging, and software development.';
            }
            
            try {
              const response = await Promise.race([
                deps.ollamaProvider.generateText({
                  prompt: `You are a helpful coding assistant. User query: ${query}`,
                  model: targetModel
                }),
                new Promise<string>((_, reject) => 
                  setTimeout(() => reject(new Error('AI response timeout')), 25000)
                )
              ]);
              return response;
            } catch (error) {
              return 'Request timed out. Please try again with a shorter query.';
            }
          }

          if (!code || !language) {
            return `Available commands:\n- /chat - General chat (no code required)\n- /fix - Fix code issues\n- /explain - Explain code\n- /tests - Generate tests\n- /doc - Generate documentation\n- /optimize - Optimize performance\n- /refactor - Refactor code\n- /security - Security scan\n- /translate [language] - Translate code\n- /generate - Generate complete functions/classes\n\nNote: Most commands require code and language parameters.`;
          }

          let result: string;
          try {
            result = await executeSlashCommandWithTimeout(deps, command, code, language, context);
          } catch (error) {
            result = `Command failed: ${command}. Please try again with shorter code.`;
          }

          return result;
        },
        () => 'Slash command failed or timed out. Please try again with shorter code.',
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function executeSlashCommandWithTimeout(deps: ToolDependencies, command: string, code: string, language: string, context?: string): Promise<string> {
  const providerAny = deps.ollamaProvider as any;
  switch (command) {
    case '/fix':
      return await executeSlashFix(deps, code, language);
    case '/explain':
      if (typeof providerAny.explainCodeWithModel === 'function') {
        return await providerAny.explainCodeWithModel(code, language, deps.config.model || DEFAULT_OLLAMA_MODEL);
      }
      return await deps.ollamaProvider.explainCode(code, language);
    case '/tests':
      return await executeSlashTests(deps, code, language);
    case '/doc':
      return await executeSlashDoc(deps, code, language);
    case '/optimize':
      return await executeSlashOptimize(deps, code, language);
    case '/refactor':
      return await executeSlashRefactor(deps, code, language);
    case '/security':
      return await executeSlashSecurity(deps, code, language);
    case '/translate':
      const targetLang = context || 'python';
      return await executeSlashTranslate(deps, code, language, targetLang);
    case '/generate':
      return await executeSlashGenerate(deps, code, language, context);
    case '/review':
      return await executeSlashReview(deps, code, language);
    default:
      return `Unknown command: ${command}\n\nAvailable commands:\n- /fix - Fix code issues\n- /explain - Explain code\n- /tests - Generate tests\n- /doc - Generate documentation\n- /optimize - Optimize performance\n- /refactor - Refactor code\n- /security - Security scan\n- /translate [language] - Translate code\n- /generate - Generate complete functions/classes\n- /review - Comprehensive code review`;
  }
}

async function executeSlashReview(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Perform a comprehensive code review of this ${language} code (keep response concise):\n${code.substring(0, 2000)}\n\nAnalyze: style, security, performance, maintainability, and best practices.`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashFix(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Fix any issues in this ${language} code (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashGenerate(deps: ToolDependencies, code: string, language: string, context?: string): Promise<string> {
  let prompt: string;
  const limitedCode = code.substring(0, 1000);
  
  if (context && context.includes('function')) {
    const signature = context.replace('/generate', '').trim();
    prompt = `Generate a complete ${language} function with this signature: ${signature}\nContext: ${limitedCode}\nKeep response concise.`;
  } else if (context && context.includes('class')) {
    const className = context.replace('/generate', '').replace('class', '').trim();
    prompt = `Generate a complete ${language} class named ${className}\nContext: ${limitedCode}\nKeep response concise.`;
  } else {
    prompt = `Generate ${language} code based on: ${context || limitedCode}\nKeep response concise.`;
  }
  
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashOptimize(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Optimize this ${language} code for performance (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashRefactor(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Refactor this ${language} code for better readability (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashSecurity(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Scan this ${language} code for security vulnerabilities and provide fixes (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashTests(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Generate unit tests for this ${language} code (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashTranslate(deps: ToolDependencies, code: string, fromLanguage: string, toLanguage: string): Promise<string> {
  const prompt = `Translate this ${fromLanguage} code to ${toLanguage} (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

async function executeSlashDoc(deps: ToolDependencies, code: string, language: string): Promise<string> {
  const prompt = `Generate documentation for this ${language} code (keep response concise):\n${code.substring(0, 2000)}`;
  return await deps.ollamaProvider.generateText({ prompt, model: deps.config.model });
}

function parseSecurityScan(scanResult: string): Array<{ type: string; severity: string; description: string; fix: string }> {
  const vulnerabilities: Array<{ type: string; severity: string; description: string; fix: string }> = [];
  const lines = scanResult.split('\n');
  
  for (const line of lines) {
    if (line.toLowerCase().includes('vulnerability') || line.toLowerCase().includes('security')) {
      vulnerabilities.push({
        type: 'security_issue',
        severity: line.toLowerCase().includes('critical') ? 'critical' : 
                 line.toLowerCase().includes('high') ? 'high' : 'medium',
        description: line.trim(),
        fix: 'Review and apply security best practices'
      });
    }
  }
  
  return vulnerabilities;
}

function parseImportSuggestions(suggestions: string, language: string): string[] {
  const imports: string[] = [];
  const lines = suggestions.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (language === 'javascript' || language === 'typescript') {
      if (trimmed.startsWith('import ') || trimmed.startsWith('const ') && trimmed.includes('require(')) {
        imports.push(trimmed);
      }
    } else if (language === 'python') {
      if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
        imports.push(trimmed);
      }
    } else if (language === 'java') {
      if (trimmed.startsWith('import ')) {
        imports.push(trimmed);
      }
    }
  }
  
  return imports;
}
