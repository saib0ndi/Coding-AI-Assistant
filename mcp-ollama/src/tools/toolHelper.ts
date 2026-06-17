/**
 * Standalone helper to create an MCPTool object.
 * Previously a private method on MCPServer — now shared by all tool modules.
 */
import { MCPTool } from '../types/index.js';
import { ToolDependencies } from './ToolDependencies.js';
import { DEFAULT_OLLAMA_MODEL } from '../config/AppConfig.js';

export function createTool(
  name: string,
  description: string,
  properties: Record<string, any>,
  required: string[],
  handler: (params: any) => Promise<any>,
): MCPTool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
    handler,
  };
}

/**
 * Wraps an async operation with a fallback value on error.
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  fallback: () => T,
  logger?: { error: (...args: any[]) => void },
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger?.error(`Operation failed: ${msg.replace(/[\r\n\t]/g, '_')}`);
    return fallback();
  }
}

/** Sanitise a string for safe logging (strip newlines/tabs). */
export function sanitizeString(str: string): string {
  return str.replace(/[\r\n\t]/g, '_');
}

/** Validate parameters shape. */
export function validateParams(params: unknown, expectedType: string): void {
  if (!params || typeof params !== expectedType) {
    throw new Error(`Invalid parameters: expected ${expectedType}`);
  }
}

const DETAIL_PROMPTS: Record<string, string> = {
  brief: 'Give a concise overview in 2-3 sentences.',
  detailed: 'Explain clearly with key concepts and logic flow.',
  comprehensive: 'Provide an in-depth explanation covering architecture, edge cases, and design decisions.',
};

/**
 * Shared helper for code explanation tools.
 */
export async function sharedExplainCode(
  deps: ToolDependencies,
  code: string,
  language: string,
  model?: string,
  detail: string = 'detailed'
): Promise<string> {
  const targetModel = model || deps.config.model || DEFAULT_OLLAMA_MODEL;
  const detailHint = DETAIL_PROMPTS[detail] ?? DETAIL_PROMPTS.detailed;
  const providerAny = deps.ollamaProvider as any;

  // Non-default detail levels use an explicit prompt
  if (detail !== 'detailed') {
    return await deps.ollamaProvider.generateText({
      prompt: `Explain this ${language} code. ${detailHint}\n\n${code}`,
      model: targetModel,
    });
  }

  if (typeof providerAny.explainCodeWithModel === 'function') {
    return await providerAny.explainCodeWithModel(code, language, targetModel);
  }
  return await deps.ollamaProvider.explainCode(code, language);
}

/**
 * Shared helper for refactoring tools.
 */
export async function sharedRefactorCode(
  deps: ToolDependencies,
  code: string,
  language: string,
  focusOrFocusAreas: string | string[]
): Promise<string> {
  const focus = Array.isArray(focusOrFocusAreas) ? focusOrFocusAreas.join(', ') : focusOrFocusAreas;
  const prompt = `Refactor this ${language} code focusing on ${focus}:\n\n${code}\n\nProvide improved code with explanations:`;
  return await deps.ollamaProvider.generateText({
    prompt,
    model: deps.config.model
  });
}


