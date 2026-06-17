import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

import { AgentOllamaRegistry } from '../providers/AgentOllamaRegistry.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { ContextManager } from '../utils/ContextManager.js';
import { CacheManager } from '../utils/CacheManager.js';
import { Logger } from '../utils/Logger.js';
import { ErrorAnalyzer } from '../utils/ErrorAnalyzer.js';
import { AgentManager } from '../agents/AgentManager.js';
import { ProjectVerifier } from '../verify/ProjectVerifier.js';
import { RequestRouter } from './RequestRouter.js';
import { LSPClient } from '../lsp/LSPClient.js';
import { CodeFormatter } from '../formatters/CodeFormatter.js';
import { QualityFilter } from '../quality/QualityFilter.js';
import { VectorStore } from '../semantic/VectorStore.js';
import { SecurityScanner } from '../security/SecurityScanner.js';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import { CodebaseIndexerRegistry } from '../indexing/CodebaseIndexerRegistry.js';
import { GitHubService } from '../services/GitHubService.js';
import { GitHubRepositoryAnalyzer } from '../services/GitHubRepositoryAnalyzer.js';
import { DEFAULT_OLLAMA_MODEL, loadAppConfig, parsePositiveInteger } from '../config/AppConfig.js';
import { getMcpClientManager } from '../mcp/McpClientManager.js';

import {
  MCPTool,
  MCPResource,
  OllamaConfig,
} from '../types/index.js';

import {
  createCoreTools,
  createErrorFixingTools,
  createAnalysisTools,
  createCopilotTools,
  createAgentTools,
  createIndexingTools,
  createGitHubIntegrationTools,
  createInlineTools,
  createIDETools,
  createSearchTools,
  createExecutionTools,
  ToolDependencies
} from '../tools/index.js';
import { resolveToolName, normalizeAliasParams } from '../tools/toolAliases.js';

interface Conversation {
  id: string;
  userId: string;
  query: string;
  response: string;
  timestamp: number;
  context?: string;
}

interface User {
  id: string;
  name: string;
  cursor?: { line: number; character: number };
  selection?: { start: { line: number; character: number }; end: { line: number; character: number } };
  color: string;
}

interface CodeChange {
  id: string;
  userId: string;
  type: 'insert' | 'delete' | 'replace';
  position: { line: number; character: number };
  content: string;
  timestamp: number;
}

/**
 * Enhanced MCP Server with comprehensive AI-powered code assistance capabilities
 * Provides tools for code completion, analysis, error fixing, and various development tasks
 */
export class MCPServer {
  private readonly server: Server;
  private readonly ollamaRegistry: AgentOllamaRegistry;
  private readonly ollamaProvider: OllamaProvider;
  private readonly contextManager: ContextManager;
  private readonly cacheManager: CacheManager;
  private readonly logger: Logger;
  private readonly errorAnalyzer: ErrorAnalyzer;
  private readonly agentManager: AgentManager;
  private readonly requestRouter: RequestRouter;
  private readonly lspClient: LSPClient;
  private readonly codeFormatter: CodeFormatter;
  private readonly qualityFilter: QualityFilter;
  private readonly vectorStore: VectorStore;
  private readonly securityScanner: SecurityScanner;
  private readonly enhancedContext: EnhancedContextManager;
  private readonly gitHubService: GitHubService;
  private readonly repoAnalyzer: GitHubRepositoryAnalyzer;
  private readonly projectVerifier: ProjectVerifier;
  private readonly tools = new Map<string, MCPTool>();
  private readonly resources = new Map<string, MCPResource>();
  private readonly config: OllamaConfig;
  private readonly conversationMemory = new VectorStore({ scope: 'memory' });
  private readonly conversations = new Map<string, Conversation>();
  private readonly activeUsers = new Map<string, User>();
  private readonly codeChanges: CodeChange[] = [];
  private static readonly DEFAULT_MODEL = DEFAULT_OLLAMA_MODEL;
  private static readonly TELEMETRY_CACHE_TTL_MS = parsePositiveInteger(process.env.TELEMETRY_TTL_HOURS, 24) * 60 * 60 * 1000;
  private transport?: StdioServerTransport;
  private isRunning = false;
  private persistentCache: CacheManager;
  private streams = new Map<string, any>();
  private requestCount = 0;
  private cacheHits = 0;
  private startTime = Date.now();

  /**
   * Initializes the MCP Server with Ollama configuration
   * @param ollamaConfig - Configuration for Ollama provider
   * @throws Error if initialization fails
   */
  constructor(ollamaConfig: OllamaConfig) {
    try {
      this.config = ollamaConfig;
      this.server = new Server(
        { name: 'mcp-ollama-server', version: loadAppConfig().server.version },
        { capabilities: { tools: {}, resources: {} } }
      );

      this.logger = new Logger();
      this.ollamaRegistry = new AgentOllamaRegistry(ollamaConfig);
      this.ollamaProvider = this.ollamaRegistry.getOrchestrator();
      this.contextManager = new ContextManager();
      this.cacheManager = new CacheManager();
      this.errorAnalyzer = new ErrorAnalyzer();
      this.agentManager = new AgentManager(this.ollamaRegistry);
      this.requestRouter = new RequestRouter(this.agentManager, this.ollamaProvider);
      this.lspClient = new LSPClient();
      this.codeFormatter = new CodeFormatter();
      this.qualityFilter = new QualityFilter();
      this.vectorStore = new VectorStore();
      this.securityScanner = new SecurityScanner();
      this.enhancedContext = new EnhancedContextManager();
      CodebaseIndexerRegistry.setEnhancedContext(this.enhancedContext);
      this.gitHubService = GitHubService.getInstance();
      this.repoAnalyzer = GitHubRepositoryAnalyzer.getInstance();
      this.projectVerifier = new ProjectVerifier();
      this.persistentCache = new CacheManager();
      
      this.initializeServer();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to initialize MCPServer: ${errorMessage}`);
    }
  }

  private initializeServer(): void {
    this.setupTools();
    this.setupResources();
    this.setupHandlers();
  }

  private static readonly HIDDEN_TOOLS_BY_DEFAULT = new Set([
    // Mock UI placeholders. The real VS Code UI lives in the extension.
    'ghost_text_ui',
    'inline_completion_ui',
    'copilot_chat_ui',
    'suggestion_panel_ui',
    'quick_actions_ui',
    'status_indicator_ui',
    'labs_sidebar_ui',

    // Enterprise/team features that are not core to the local assistant flow.
    'enterprise_tools',
    'collaboration',
    'analytics',

    // Experimental or overlapping capabilities kept available behind a flag.
    'ai_project_planner',
    'ai_pair_programming',
    'code_archaeology',
    'living_documentation',
    'multi_model_consensus',
    'persistent_cache',
    'context_window',
    'lsp_integration',
    'vscode_lsp_integration',
    'ghost_text',
    'streaming_suggestion',
    'multi_file_suggestion',
    'suggestion_filter',
    'keyboard_shortcut',
    'telemetry',
    'vscode_integration',
    'workflow_execution'
  ]);

  private setupTools(): void {
    // Register tool factories instead of creating all tools upfront
    this.registerToolFactories();
  }

  private registerToolFactories(): void {
    const deps: ToolDependencies = {
      ollamaProvider: this.ollamaProvider,
      cacheManager: this.cacheManager,
      persistentCache: this.persistentCache,
      logger: this.logger,
      errorAnalyzer: this.errorAnalyzer,
      contextManager: this.contextManager,
      agentManager: this.agentManager,
      projectVerifier: this.projectVerifier,
      securityScanner: this.securityScanner,
      enhancedContext: this.enhancedContext,
      gitHubService: this.gitHubService,
      repoAnalyzer: this.repoAnalyzer,
      conversationMemory: this.conversationMemory,
      config: this.config,
      lspClient: this.lspClient,
      conversations: this.conversations
    };

    // Decomposed tool modules
    const allTools = [
      ...createCoreTools(deps),
      ...createErrorFixingTools(deps),
      ...createAnalysisTools(deps),
      ...createCopilotTools(deps),
      ...createAgentTools(deps),
      ...createIndexingTools(deps),
      ...createGitHubIntegrationTools(deps),
      ...createInlineTools(deps),
      ...createIDETools(deps),
      ...createSearchTools(deps),
      ...createExecutionTools(deps)
    ].filter(tool => this.shouldExposeTool(tool.name));
    
    allTools.forEach(tool => this.tools.set(tool.name, tool));
  }

  private shouldExposeTool(name: string): boolean {
    const exposeExperimental = this.isExperimentalToolsEnabled();
    return exposeExperimental || !MCPServer.HIDDEN_TOOLS_BY_DEFAULT.has(name);
  }

  private isExperimentalToolsEnabled(): boolean {
    return ['1', 'true', 'yes', 'on'].includes((process.env.MCP_OLLAMA_EXPERIMENTAL_TOOLS || '').toLowerCase());
  }

  private setupResources(): void {
    const resources = [
      { id: 'project_context', uri: 'context://project', name: 'Project Context', description: 'Current project context and metadata', handler: this.getProjectContext.bind(this) },
      { id: 'code_patterns', uri: 'patterns://common', name: 'Common Code Patterns', description: 'Library of common code patterns and best practices', handler: this.getCodePatterns.bind(this) },
      { id: 'model_status', uri: 'status://ollama', name: 'Ollama Model Status', description: 'Current status and capabilities of the Ollama model', handler: this.getModelStatus.bind(this) },
      { id: 'error_database', uri: 'errors://database', name: 'Error Solutions Database', description: 'Database of known errors and their solutions', handler: this.getErrorDatabase.bind(this) },
      { id: 'fix_templates', uri: 'templates://fixes', name: 'Fix Templates', description: 'Templates for common error fixes by language', handler: this.getFixTemplates.bind(this) }
    ];

    resources.forEach(({ id, uri, name, description, handler }) => {
      this.resources.set(id, {
        uri,
        name,
        description,
        mimeType: 'application/json',
        handler
      });
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, this.handleListTools.bind(this));
    this.server.setRequestHandler(CallToolRequestSchema, this.handleCallTool.bind(this));
    this.server.setRequestHandler(ListResourcesRequestSchema, this.handleListResources.bind(this));
    this.server.setRequestHandler(ReadResourceRequestSchema, this.handleReadResource.bind(this));
  }

  private async handleListTools() {
    try {
      const local = Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }));

      const federated = getMcpClientManager().getFederatedTools().map(t => ({
        name: t.federatedName,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      return { tools: [...local, ...federated] };
    } catch (error) {
      this.logger.error(`Error listing tools: ${this.getErrorMessage(error)}`);
      throw new McpError(ErrorCode.InternalError, 'Failed to retrieve tools list');
    }
  }

  private async handleCallTool(request: any) {
    const { name, arguments: args } = request.params;
    const sanitizedName = this.sanitizeString(name);

    try {
      this.logger.info(`Routing request: ${sanitizedName}`);

      // Check federated tools first (name contains a slash: "server/tool")
      if (name.includes('/')) {
        const fedTools = getMcpClientManager().getFederatedTools();
        const fedTool = fedTools.find(t => t.federatedName === name);
        if (fedTool) {
          const result = await fedTool.invoke(args);
          return {
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result),
            }],
          };
        }
      }

      // Use RequestRouter for intelligent routing
      const result = await this.requestRouter.routeRequest(name, args);
      
      this.logger.info(`Request ${sanitizedName} completed successfully`);

      // Normalise result to a string for the MCP content response
      let responseText: string;
      if (typeof result === 'string') {
        responseText = result;
      } else if (result !== null && typeof result === 'object') {
        responseText =
          (result as any).response ??
          (result as any).result ??
          (result as any).explanation ??
          (result as any).text ??
          JSON.stringify(result);
      } else {
        responseText = String(result ?? '');
      }

      return {
        content: [{
          type: 'text',
          text: responseText
        }]
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Tool ${sanitizedName} failed: ${this.sanitizeString(errorMessage)}`);

      if (error instanceof McpError) {
        throw error;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: true,
            message: `Error executing tool '${sanitizedName}': ${this.sanitizeString(errorMessage)}`
          })
        }],
        isError: true
      };
    }
  }

  private async handleListResources() {
    try {
      return {
        resources: Array.from(this.resources.values()).map(({ uri, name, description, mimeType }) => ({
          uri,
          name,
          description,
          mimeType
        }))
      };
    } catch (error) {
      this.logger.error(`Error listing resources: ${this.getErrorMessage(error)}`);
      throw new McpError(ErrorCode.InternalError, 'Failed to retrieve resources list');
    }
  }

  private async handleReadResource(request: any) {
    const { uri } = request.params;
    
    try {
      const resource = Array.from(this.resources.values()).find(r => r.uri === uri);
      if (!resource) {
        throw new McpError(ErrorCode.InvalidRequest, `Resource ${uri} not found`);
      }

      const content = await resource.handler();
      return {
        contents: [{
          uri,
          mimeType: resource.mimeType,
          text: JSON.stringify(content)
        }]
      };
    } catch (error) {
      this.logger.error(`Error reading resource ${uri}: ${this.getErrorMessage(error)}`);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(ErrorCode.InternalError, `Failed to read resource: ${uri}`);
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  private sanitizeString(str: string): string {
    return str.replace(/[\r\n\t]/g, '_');
  }

  // RESOURCE HANDLERS

  private async getProjectContext(): Promise<unknown> {
    try {
      return await this.contextManager.getCurrentContext();
    } catch (error) {
      this.logger.error('Failed to get project context:', error);
      return {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }

  private static readonly CODE_PATTERNS = {
    patterns: [
      {
        name: 'Singleton Pattern',
        language: 'typescript',
        description: 'Ensure a class has only one instance',
        example: 'class Singleton { private static instance: Singleton; }',
      },
      {
        name: 'Factory Pattern',
        language: 'typescript',
        description: 'Create objects without specifying exact classes',
        example: 'interface Factory { create(): Product; }',
      }
    ],
  };
  
  private async getCodePatterns(): Promise<unknown> {
    return MCPServer.CODE_PATTERNS;
  }

  private async getModelStatus(): Promise<unknown> {
    try {
      const [isHealthy, availableModels] = await Promise.all([
        this.ollamaProvider.healthCheck(),
        this.ollamaProvider.getAvailableModels()
      ]);

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        availableModels,
        currentModel: MCPServer.DEFAULT_MODEL,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        availableModels: [],
        currentModel: MCPServer.DEFAULT_MODEL,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getErrorDatabase(): Promise<unknown> {
    return {
      commonErrors: [
        {
          pattern: "Cannot find module",
          language: "javascript",
          category: "import_error",
          solutions: ["Install the missing package using npm/yarn"]
        }
      ]
    };
  }

  private async getFixTemplates(): Promise<unknown> {
    return {
      javascript: {
        import_error: {
          template: "import { ${symbol} } from '${package}';",
          description: "Fix import statement",
          variables: ["symbol", "package"]
        }
      }
    };
  }

  /**
   * Starts the MCP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Server is already running');
      return;
    }

    try { 
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);
      this.isRunning = true;
      this.logger.info('Enhanced MCP Server started successfully (stdio transport)');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to start MCP Server: ${errorMessage}`);
      throw new Error(`Server startup failed: ${errorMessage}`);
    }
  }

  /**
   * Stops the MCP server and closes connections
   */
  async stop(): Promise<void> {
    try {
      this.ollamaProvider.stopResourceMonitoring();
      await this.server.close();
      this.isRunning = false;
      this.logger.info('MCP Server stopped');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to stop MCP Server: ${errorMessage}`);
      throw new Error(`Server shutdown failed: ${errorMessage}`);
    }
  }

  getAgentManager(): AgentManager {
    return this.agentManager;
  }

  getOllamaProvider(): OllamaProvider {
    return this.ollamaProvider;
  }

  async callTool(name: string, args: any): Promise<any> {
    const { canonical, alias } = resolveToolName(name);
    const tool = this.tools.get(canonical);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }
    const normalizedArgs = alias ? normalizeAliasParams(alias, args ?? {}) : args;
    return await tool.handler(normalizedArgs);
  }
}
