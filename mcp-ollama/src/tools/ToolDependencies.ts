/**
 * Shared dependency interface for all tool modules.
 * MCPServer creates a single instance and passes it to each tool group factory.
 */

import { OllamaProvider } from '../providers/OllamaProvider.js';
import { CacheManager } from '../utils/CacheManager.js';
import { Logger } from '../utils/Logger.js';
import { ErrorAnalyzer } from '../utils/ErrorAnalyzer.js';
import { ContextManager } from '../utils/ContextManager.js';
import { AgentManager } from '../agents/AgentManager.js';
import { ProjectVerifier } from '../verify/ProjectVerifier.js';
import { SecurityScanner } from '../security/SecurityScanner.js';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import { GitHubService } from '../services/GitHubService.js';
import { GitHubRepositoryAnalyzer } from '../services/GitHubRepositoryAnalyzer.js';
import { VectorStore } from '../semantic/VectorStore.js';
import { OllamaConfig } from '../types/index.js';
import { LSPClient } from '../lsp/LSPClient.js';

export interface ToolDependencies {
  ollamaProvider: OllamaProvider;
  cacheManager: CacheManager;
  persistentCache: CacheManager;
  logger: Logger;
  errorAnalyzer: ErrorAnalyzer;
  contextManager: ContextManager;
  agentManager: AgentManager;
  projectVerifier: ProjectVerifier;
  securityScanner: SecurityScanner;
  enhancedContext: EnhancedContextManager;
  gitHubService: GitHubService;
  repoAnalyzer: GitHubRepositoryAnalyzer;
  conversationMemory: VectorStore;
  config: OllamaConfig;
  lspClient: LSPClient;
  conversations: Map<string, any>;
}

/**
 * MCPTool shape re-exported for convenience.
 * Identical to the one in types/index.ts.
 */
export type { MCPTool } from '../types/index.js';
