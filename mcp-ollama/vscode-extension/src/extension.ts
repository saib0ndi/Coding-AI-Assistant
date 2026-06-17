import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { InlineSuggestionProvider } from './inlineSuggestionProvider';
import { InlineCompletionProvider } from './inlineCompletionProvider';
import { CopilotChatProvider } from './copilotChatProvider';
import { WorkflowProgressView } from './workflowProgressView';
import { openAgentReviewPanel, getPendingAgentChanges } from './agentReview';
import { StreamingClient } from './streamingClient';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { ChatUI } from './chatUI';
import { TelemetryManager } from './telemetryManager';
import { ContextAnalyzer } from './contextAnalyzer';
import { MultiLineGenerator } from './multiLineGenerator';
import { ASTParser } from './astParser';
import { ServerManager } from './serverManager';
import { LSPIntegration } from './lsp/LSPIntegration';
import { ResponseValidator } from './quality/ResponseValidator';
import { SemanticProvider } from './semantic/SemanticProvider';
import { registerAllCommands } from './commands';

// Global variables for extension services
let mcpClient: MCPClient | undefined;
let suggestionProvider: InlineSuggestionProvider | undefined;
let inlineCompletionProvider: InlineCompletionProvider | undefined;
let chatProvider: CopilotChatProvider | undefined;
let streamingClient: StreamingClient | undefined;
let workspaceAnalyzer: WorkspaceAnalyzer | undefined;
let chatUI: ChatUI | undefined;
let telemetryManager: TelemetryManager | undefined;
let contextAnalyzer: ContextAnalyzer | undefined;
let multiLineGenerator: MultiLineGenerator | undefined;
let astParser: ASTParser | undefined;
let serverManager: ServerManager | undefined;
let lspIntegration: LSPIntegration | undefined;
let responseValidator: ResponseValidator | undefined;
let semanticProvider: SemanticProvider | undefined;

// Output channel for logging
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    console.log('MCP-Ollama Copilot extension activated');

    // Check if extension is enabled
    const config = vscode.workspace.getConfiguration('mcp-ollama');
    if (!config.get('enabled', true)) {
        console.log('MCP-Ollama extension is disabled');
        return;
    }

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MCP-Ollama Copilot');
    outputChannel.appendLine('Extension activation started');

    try {
        // Initialize MCP client and services
        MCPClient.context = context;
        mcpClient = new MCPClient();
        telemetryManager = new TelemetryManager();
        contextAnalyzer = new ContextAnalyzer();
        astParser = new ASTParser();
        serverManager = new ServerManager();
        multiLineGenerator = new MultiLineGenerator(mcpClient, contextAnalyzer);
        lspIntegration = new LSPIntegration(mcpClient);
        responseValidator = new ResponseValidator();
        semanticProvider = new SemanticProvider(mcpClient);
        void mcpClient.connect()
            .then(() => semanticProvider?.indexWorkspace())
            .catch((err) => outputChannel.appendLine(`[Semantic] Background index skipped: ${err}`));
        suggestionProvider = new InlineSuggestionProvider(mcpClient);
        inlineCompletionProvider = new InlineCompletionProvider(mcpClient);
        chatProvider = new CopilotChatProvider(mcpClient, context);
        streamingClient = new StreamingClient(mcpClient);
        workspaceAnalyzer = new WorkspaceAnalyzer(mcpClient);
        const workflowProgressView = new WorkflowProgressView(context);
        chatUI = new ChatUI(context, mcpClient, workflowProgressView);
        chatUI.setStreamingClient(streamingClient);
        
        // Disable automatic document event handlers to prevent infinite loops
        outputChannel.appendLine('Document event handlers disabled to prevent crashes');
        
        // Prevent document event loops by not registering onDidOpenTextDocument
        // This fixes the "Aborted()" error spam in console

        // Register inline completion providers
        const completionProvider = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            suggestionProvider
        );
        
        const enhancedCompletionProvider = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineCompletionProvider
        );

        // Register chat provider with proper error handling
        let chatProviderRegistration: vscode.ChatParticipant | undefined;
        try {
            // Register chat participant
            chatProviderRegistration = vscode.chat.createChatParticipant(
                'smartcode-aiassist',
                chatProvider.handleChatRequest.bind(chatProvider)
            );
            
            // Set icon path if file exists
            const iconPath = context.asAbsolutePath('images/icon.png');
            if (await fileExists(iconPath)) {
                chatProviderRegistration.iconPath = vscode.Uri.file(iconPath);
            }
            
            chatProviderRegistration.followupProvider = {
                provideFollowups: () => [
                    { prompt: '/dev ', label: '🚀 Agent: Implement / Fix' },
                    { prompt: '/test ', label: '🧪 Agent: Generate Tests' },
                    { prompt: '/review ', label: '👀 Agent: Code Review' },
                    { prompt: '/fix', label: 'Fix Code Issues' },
                    { prompt: '/explain', label: 'Explain Code' },
                ]
            };
        } catch (error) {
            outputChannel.appendLine(`Warning: Failed to register chat provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Continue without chat provider
        }

        const workflowTree = vscode.window.createTreeView('mcpOllamaWorkflow', {
            treeDataProvider: workflowProgressView,
            showCollapseAll: true,
        });

        // Register commands using the extracted commands module
        const commands = registerAllCommands(context, {
            mcpClient,
            suggestionProvider,
            inlineCompletionProvider,
            chatProvider,
            streamingClient,
            workspaceAnalyzer,
            chatUI,
            telemetryManager,
            multiLineGenerator,
            astParser,
            serverManager,
            outputChannel
        });

        // Register chat commands with error handling
        try {
            if (chatProvider) {
                CopilotChatProvider.registerChatCommands(context, mcpClient);
            }
        } catch (error) {
            outputChannel.appendLine(`Warning: Failed to register chat commands: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Register file save event handler for incremental indexing
        const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
            try {
                const config = vscode.workspace.getConfiguration('mcp-ollama');
                if (config.get('enabled', true) && semanticProvider) {
                    const extIndex = document.fileName.lastIndexOf('.');
                    if (extIndex !== -1) {
                        const ext = document.fileName.substring(extIndex).toLowerCase();
                        const supportedExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
                        if (supportedExts.includes(ext)) {
                            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                            if (workspaceFolder) {
                                outputChannel.appendLine(`[SemanticWatcher] Triggering incremental index for saved file: ${document.fileName}`);
                                await semanticProvider.indexFile(document.uri.fsPath);
                            }
                        }
                    }
                }
            } catch (error) {
                outputChannel.appendLine(`[SemanticWatcher] Incremental indexing failed: ${error instanceof Error ? error.message : error}`);
            }
        });

        // Add all disposables to context
        const allDisposables = [
            completionProvider,
            enhancedCompletionProvider,
            outputChannel,
            onSaveDisposable,
            ...commands
        ];

        if (chatProviderRegistration) {
            allDisposables.push(chatProviderRegistration);
        }
        allDisposables.push(workflowTree);

        context.subscriptions.push(...allDisposables);

        // Connect to MCP server
        try {
            outputChannel.appendLine('Connecting to MCP server...');
            await mcpClient.connect();
            outputChannel.appendLine('Successfully connected to MCP server');
        } catch (error) {
            outputChannel.appendLine(`Warning: Failed to connect to MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
            outputChannel.appendLine('Extension will work with limited functionality');
        }
        
        outputChannel.appendLine('Extension activation completed successfully');

    } catch (error) {
        const errorMsg = `Failed to activate MCP-Ollama extension: ${error instanceof Error ? error.message : 'Unknown error'}`;
        outputChannel.appendLine(`Error: ${errorMsg}`);
        vscode.window.showErrorMessage(errorMsg);
        
        // Still try to initialize with limited functionality
        try {
            context.subscriptions.push(outputChannel);
        } catch (e) {
            console.error('Failed to add output channel to subscriptions:', e);
        }
    }
}

export async function deactivate() {
    console.log('MCP-Ollama Copilot extension deactivated');
    
    try {
        if (outputChannel) {
            outputChannel.appendLine('Extension deactivation started');
        }

        // Dispose all services that have dispose methods
        const disposableServices = [suggestionProvider, chatProvider, streamingClient, workspaceAnalyzer, chatUI];
        
        for (const service of disposableServices) {
            if (service && 'dispose' in service && typeof service.dispose === 'function') {
                try {
                    await service.dispose();
                } catch (error) {
                    console.error('Error disposing service:', error);
                    if (outputChannel) {
                        outputChannel.appendLine(`Error disposing service: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                }
            }
        }

        // Disconnect MCP client specifically
        if (mcpClient && typeof mcpClient.disconnect === 'function') {
            try {
                await mcpClient.disconnect();
            } catch (error) {
                console.error('Error disconnecting MCP client:', error);
            }
        }

        if (outputChannel) {
            outputChannel.appendLine('Extension deactivation completed');
        }

    } catch (error) {
        console.error('Error during deactivation:', error);
    } finally {
        // Dispose services
        if (telemetryManager) {
            telemetryManager.dispose();
        }
        if (inlineCompletionProvider) {
            inlineCompletionProvider.dispose();
        }
        
        // Clear references
        mcpClient = undefined;
        suggestionProvider = undefined;
        inlineCompletionProvider = undefined;
        chatProvider = undefined;
        streamingClient = undefined;
        workspaceAnalyzer = undefined;
        chatUI = undefined;
        telemetryManager = undefined;
        contextAnalyzer = undefined;
        multiLineGenerator = undefined;
        if (serverManager) {
            await serverManager.stopServer();
        }
        astParser = undefined;
        serverManager = undefined;
    }
}

// Helper functions
async function fileExists(path: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path));
        return true;
    } catch {
        return false;
    }
}