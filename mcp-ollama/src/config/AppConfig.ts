export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b-instruct-q4_K_M';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
export const DEFAULT_HTTP_PORT = 3078;
export const DEFAULT_SERVER_HOST = 'localhost';
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
export const DEFAULT_EMBED_TIMEOUT_MS = 60_000;
export const DEFAULT_CORS_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:3078'];
export const DEFAULT_OLLAMA_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'];

export interface AppConfig {
  ollama: {
    host: string;
    embedHost: string;
    model: string;
    codeModel: string | undefined;
    testModel: string | undefined;
    projectModel: string | undefined;
    autonomousModel: string | undefined;
    fastModel: string | undefined;
    embedModel: string;
    timeoutMs: number;
    embedTimeoutMs: number;
    allowedHosts: string[];
    authToken: string | undefined;
  };
  server: {
    host: string;
    port: number;
    version: string;
    requestTimeoutMs: number;
    corsAllowedOrigins: string[];
  };
  workflow: {
    maxConcurrentSteps: number;
    stepTimeoutMs: number;
  };
  largeCodebase: {
    coreFileLimit: number;
    businessFileLimit: number;
    filePreviewLimit: number;
    componentLimit: number;
    recommendationLimit: number;
    coreTimeoutMs: number;
    businessTimeoutMs: number;
    supportingTimeoutMs: number;
  };
}

export function parsePositiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseStringList(value: string | undefined, fallback: string[]): string[] {
  const parsed = value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : fallback;
}

export function normalizeUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '');
}

function optionalEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

export function loadAppConfig(): AppConfig {
  const defaultTimeout = parsePositiveInteger(process.env.DEFAULT_TIMEOUT, DEFAULT_OLLAMA_TIMEOUT_MS);
  const ollamaTimeout = parsePositiveInteger(
    process.env.OLLAMA_TIMEOUT_MS || process.env.COMPLETION_TIMEOUT,
    defaultTimeout
  );

  const ollamaHost = normalizeUrl(process.env.OLLAMA_HOST, DEFAULT_OLLAMA_HOST);

  return {
    ollama: {
      host: ollamaHost,
      // Embeddings can target a separate Ollama instance (e.g. one pinned to a
      // free GPU) so a busy/OOM main host doesn't silently force hash fallback.
      // Defaults to the main host when OLLAMA_EMBED_HOST is unset.
      embedHost: normalizeUrl(process.env.OLLAMA_EMBED_HOST, ollamaHost),
      model: optionalEnv('OLLAMA_MODEL') || DEFAULT_OLLAMA_MODEL,
      codeModel: optionalEnv('OLLAMA_CODE_MODEL'),
      testModel: optionalEnv('OLLAMA_TEST_MODEL'),
      projectModel: optionalEnv('OLLAMA_PROJECT_MODEL'),
      autonomousModel: optionalEnv('OLLAMA_AUTONOMOUS_MODEL'),
      fastModel: optionalEnv('OLLAMA_FAST_MODEL'),
      embedModel: optionalEnv('OLLAMA_EMBED_MODEL') || DEFAULT_EMBED_MODEL,
      timeoutMs: ollamaTimeout,
      embedTimeoutMs: parsePositiveInteger(process.env.OLLAMA_EMBED_TIMEOUT_MS, DEFAULT_EMBED_TIMEOUT_MS),
      allowedHosts: parseStringList(process.env.OLLAMA_ALLOWED_HOSTS, DEFAULT_OLLAMA_ALLOWED_HOSTS),
      authToken: optionalEnv('OLLAMA_AUTH_TOKEN'),
    },
    server: {
      host: optionalEnv('SERVER_HOST') || DEFAULT_SERVER_HOST,
      port: parsePositiveInteger(process.env.PORT || process.env.MCP_SERVER_PORT, DEFAULT_HTTP_PORT),
      version: optionalEnv('SERVER_VERSION') || '2.0.0',
      requestTimeoutMs: parsePositiveInteger(process.env.HTTP_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
      corsAllowedOrigins: parseStringList(process.env.CORS_ALLOWED_ORIGINS, DEFAULT_CORS_ALLOWED_ORIGINS),
    },
    workflow: {
      maxConcurrentSteps: parsePositiveInteger(process.env.WORKFLOW_MAX_CONCURRENT_STEPS, 4),
      stepTimeoutMs: parsePositiveInteger(process.env.WORKFLOW_STEP_TIMEOUT_MS, 120_000),
    },
    largeCodebase: {
      coreFileLimit: parsePositiveInteger(process.env.LARGE_CODEBASE_CORE_FILE_LIMIT, 20),
      businessFileLimit: parsePositiveInteger(process.env.LARGE_CODEBASE_BUSINESS_FILE_LIMIT, 80),
      filePreviewLimit: parsePositiveInteger(process.env.LARGE_CODEBASE_FILE_PREVIEW_LIMIT, 10),
      componentLimit: parsePositiveInteger(process.env.LARGE_CODEBASE_COMPONENT_LIMIT, 5),
      recommendationLimit: parsePositiveInteger(process.env.LARGE_CODEBASE_RECOMMENDATION_LIMIT, 3),
      coreTimeoutMs: parsePositiveInteger(process.env.LARGE_CODEBASE_CORE_TIMEOUT_MS, 120_000),
      businessTimeoutMs: parsePositiveInteger(process.env.LARGE_CODEBASE_BUSINESS_TIMEOUT_MS, 60_000),
      supportingTimeoutMs: parsePositiveInteger(process.env.LARGE_CODEBASE_SUPPORTING_TIMEOUT_MS, 30_000),
    },
  };
}
