import * as vscode from 'vscode';
import { AgentCommandHandler } from './agentCommands';
import { WorkflowProgressView, WorkflowStep } from './workflowProgressView';
import { DiffViewer, FileDiff } from './diffViewer';
import { formatAgentResultSummary, formatVerificationMarkdown, extractVerification } from './verificationDisplay';
import { IssuesPanel } from './issuesPanel';
import { ChatHistory } from './chatHistory';
import { ConversationContext } from './conversationContext';
import { ContextualChat } from './contextualChat';
import { resolveAgentFiles } from './resolveAgentFiles';
import { formatChangeSummaryMarkdown, summarizeFileChange } from './changeSummary';
import { extractProposedChanges as extractAgentProposedChanges, storePendingChanges } from './agentReview';
import { getChatHtml } from './chat/chatHtml';
import { StreamingClient } from './streamingClient';

// Message interfaces for type safety
interface WebviewMessage {
    command: string;
    text?: string;
    model?: string;
    isAgentMode?: boolean;
    query?: string;
    apiKey?: string;
    baseUrl?: string;
    filePath?: string;
    groupId?: string;
    sessionId?: string;
    title?: string;
}

interface ModelInfo {
    name: string;
    displayName: string;
    size: string;
}

interface OllamaModel {
    name: string;
    size: number;
}

export class ChatUI {
    private panel: vscode.WebviewPanel | undefined;
    private outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    private agentCommandHandler: AgentCommandHandler;
    private workflowProgressView: WorkflowProgressView;
    private diffViewer: DiffViewer;
    private issuesPanel: IssuesPanel;
    private chatHistory: ChatHistory;
    private conversationContext: ConversationContext;
    private contextualChat: ContextualChat;
    private lastAgentResult: any;
    private pendingAttachments: Array<{ name: string; language: string; content: string }> = [];
    private selectedModel: string = '';
    private pendingDiffCallbacks = new Map<string, { accept: () => Promise<void>; reject: () => void }>();
    private activePollInterval?: NodeJS.Timeout;
    private activeWorkflowTaskId?: string;
    private streamingClient?: StreamingClient;

    setStreamingClient(client: StreamingClient): void {
        this.streamingClient = client;
    }

    private postWorkflowProgress(taskId: string, steps: WorkflowStep[]) {
        const isNew = this.activeWorkflowTaskId !== taskId;
        if (isNew) {
            this.activeWorkflowTaskId = taskId;
            this.panel?.webview.postMessage({ command: 'showWorkflowSteps', taskId, steps });
        } else {
            this.panel?.webview.postMessage({ command: 'updateWorkflowSteps', taskId, steps });
        }
    }

    constructor(
        private context: vscode.ExtensionContext,
        private mcpClient?: any,
        workflowProgressView?: WorkflowProgressView
    ) {
        this.outputChannel = vscode.window.createOutputChannel('SmartCode-AIAssist');
        this.outputChannel.appendLine('ChatUI initialized');
        
        this.agentCommandHandler = new AgentCommandHandler(mcpClient);
        this.workflowProgressView = workflowProgressView ?? new WorkflowProgressView(context);
        this.diffViewer = new DiffViewer(context);
        this.issuesPanel = new IssuesPanel(context);
        this.chatHistory = new ChatHistory(context);
        this.conversationContext = new ConversationContext(context);
        this.contextualChat = new ContextualChat(context, mcpClient);

        // Default to cloud model if one is configured, otherwise leave blank (server picks the default)
        const cfg = vscode.workspace.getConfiguration('mcp-ollama');
        const configuredCloudModel = cfg.get<string>('cloudModel', '');
        if (configuredCloudModel) {
            this.selectedModel = configuredCloudModel;
        }

        if (mcpClient) {
            mcpClient.selectedModel = this.selectedModel;
        }

        const treeView = vscode.window.createTreeView('mcpOllamaWorkflow', {
            treeDataProvider: this.workflowProgressView
        });
        context.subscriptions.push(treeView);
    }

    public async handleEditorAction(text: string): Promise<void> {
        const wasCreated = !this.panel;
        this.show();
        
        if (wasCreated) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        await this.handleSendMessage(text, this.selectedModel, false);
    }

    public show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const uniqueId = `mcpChat_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        this.panel = vscode.window.createWebviewPanel(
            uniqueId,
            'MCP-Ollama Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                ],
            }
        );

        this.panel.webview.html = this.getHTML(this.panel.webview);
        this.setupMessageHandling();
    }

    private getHTML(webview: vscode.Webview): string {
        const timestamp = Date.now();
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.css')
        ).toString();
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.js')
        ).toString();
        const vendorUri = (file: string) => webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', file)
        ).toString();
        return getChatHtml(timestamp, cssUri, jsUri, webview.cspSource, {
            hlCss: vendorUri('github-dark.min.css'),
            hljs: vendorUri('highlight.min.js'),
            marked: vendorUri('marked.min.js'),
        });
    }

    private setupMessageHandling() {
        if (!this.panel) return;
        
        const messageDisposable = this.panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            try {
                if (!this.panel) return;
                
                switch (message.command) {
                    case 'attachFiles':
                        await this.handleAttachFiles();
                        break;
                    case 'sendMessage':
                        if (message.text) {
                            await this.handleSendMessage(message.text, message.model, message.isAgentMode);
                        }
                        break;
                    case 'getModels':
                        await this.handleGetModels();
                        break;
                    case 'searchFileMentions':
                        await this.handleFileMentionSearch(message.query || '');
                        break;
                    case 'modelChanged':
                        if (message.model) {
                            this.selectedModel = message.model;
                            if (this.mcpClient) {
                                this.mcpClient.selectedModel = message.model;
                            }
                        }
                        if (this.outputChannel) {
                            this.outputChannel.appendLine(`[ChatUI] Model changed to: ${message.model}`);
                        }
                        break;
                    case 'clearHistory':
                        this.chatHistory.clearHistory();
                        this.conversationContext.clearContext();
                        this.postSessionsList();
                        break;
                    case 'getSessions':
                        this.postSessionsList();
                        break;
                    case 'restoreActive':
                        this.postLoadSession();
                        this.postSessionsList();
                        break;
                    case 'newChat':
                        this.chatHistory.newSession();
                        this.conversationContext.clearContext();
                        this.postLoadSession();
                        this.postSessionsList();
                        break;
                    case 'loadSession':
                        if (message.sessionId && this.chatHistory.switchSession(message.sessionId)) {
                            this.conversationContext.clearContext();
                            this.postLoadSession();
                            this.postSessionsList();
                        }
                        break;
                    case 'renameSession':
                        if (message.sessionId) {
                            this.chatHistory.renameSession(message.sessionId, message.title || '');
                            this.postSessionsList();
                        }
                        break;
                    case 'deleteSession':
                        if (message.sessionId) {
                            const wasActive = message.sessionId === this.chatHistory.getActiveSessionId();
                            this.chatHistory.deleteSession(message.sessionId);
                            if (wasActive) {
                                this.conversationContext.clearContext();
                                this.postLoadSession();
                            }
                            this.postSessionsList();
                        }
                        break;
                    case 'showContext':
                        await this.handleShowContext();
                        break;
                    case 'saveApiSettings': {
                        if (message.apiKey !== undefined) {
                            if (message.apiKey === '********') {
                                // Untouched, do nothing
                            } else if (message.apiKey.trim() === '') {
                                await this.context.secrets.delete('mcp-ollama.apiKey');
                            } else {
                                await this.context.secrets.store('mcp-ollama.apiKey', message.apiKey.trim());
                            }
                        }
                        const config = vscode.workspace.getConfiguration('mcp-ollama');
                        if (message.baseUrl !== undefined) {
                            const val = message.baseUrl.trim();
                            await config.update('cloudBaseUrl', val !== '' ? val : undefined, vscode.ConfigurationTarget.Global);
                        }
                        if (message.model !== undefined) {
                            const val = message.model.trim();
                            await config.update('cloudModel', val !== '' ? val : undefined, vscode.ConfigurationTarget.Global);
                            // Auto-switch to the newly saved cloud model so the next message uses it
                            if (val) {
                                this.selectedModel = val;
                                if (this.mcpClient) {
                                    this.mcpClient.selectedModel = val;
                                }
                            }
                        }
                        // Confirm to webview that settings were saved and which model is now active
                        this.panel?.webview.postMessage({
                            command: 'apiSettingsSaved',
                            model: message.model?.trim() || ''
                        });
                        break;
                    }
                    case 'acceptDiff': {
                        const cb = this.pendingDiffCallbacks.get(message.filePath || '');
                        if (cb) { await cb.accept(); }
                        break;
                    }
                    case 'rejectDiff': {
                        const cb = this.pendingDiffCallbacks.get(message.filePath || '');
                        if (cb) { cb.reject(); }
                        break;
                    }
                    case 'getApiSettings':
                        const savedKey = await this.context.secrets.get('mcp-ollama.apiKey');
                        const configGet = vscode.workspace.getConfiguration('mcp-ollama');
                        const baseUrl = configGet.get<string>('cloudBaseUrl', 'https://api.openai.com/v1');
                        const cloudModel = configGet.get<string>('cloudModel', 'gpt-4o');
                        this.panel?.webview.postMessage({
                            command: 'apiSettings',
                            hasKey: !!savedKey,
                            baseUrl,
                            model: cloudModel
                        });
                        break;
                }
            } catch (error) {
                if (this.outputChannel) {
                    this.outputChannel.appendLine(`[ChatUI] Error: ${error}`);
                }
            }
        });
        
        const disposeListener = this.panel.onDidDispose(() => {
            this.dispose();
        });
        
        this.disposables.push(messageDisposable, disposeListener);
    }

    /** Sends the list of saved chats (plus the active id) to the webview. */
    private postSessionsList(): void {
        this.panel?.webview.postMessage({
            command: 'sessionsList',
            sessions: this.chatHistory.listSessions(),
            activeId: this.chatHistory.getActiveSessionId(),
        });
    }

    /** Renders the active session's messages into the webview. */
    private postLoadSession(): void {
        const messages = this.chatHistory.getMessages().map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
        }));
        this.panel?.webview.postMessage({
            command: 'loadSession',
            activeId: this.chatHistory.getActiveSessionId(),
            messages,
        });
    }

    private async handleAttachFiles() {
        try {
            const files = await vscode.window.showOpenDialog({
                canSelectMany: true,
                filters: {
                    'Code Files': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'tsx', 'jsx', 'json', 'md'],
                    'All Files': ['*']
                }
            });

            if (!files || files.length === 0) return;

            const attached: Array<{ name: string; language: string; content: string }> = [];
            for (const fileUri of files) {
                try {
                    const bytes = await vscode.workspace.fs.readFile(fileUri);
                    const content = Buffer.from(bytes).toString('utf8');
                    const name = fileUri.path.split('/').pop() || fileUri.path;
                    const ext = name.split('.').pop()?.toLowerCase() || '';
                    const langMap: Record<string, string> = {
                        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
                        py: 'python', java: 'java', go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
                        json: 'json', md: 'markdown'
                    };
                    attached.push({ name, language: langMap[ext] || 'text', content });
                } catch (readErr) {
                    this.outputChannel.appendLine(`[ChatUI] Failed to read ${fileUri.path}: ${readErr}`);
                }
            }

            if (attached.length === 0) {
                vscode.window.showWarningMessage('Could not read any of the selected files.');
                return;
            }

            // Store for next message send
            this.pendingAttachments.push(...attached);

            // Inform webview so it can show chips
            this.panel?.webview.postMessage({
                command: 'attachedFiles',
                files: attached.map(f => ({ name: f.name, language: f.language, size: f.content.length }))
            });

            vscode.window.showInformationMessage(`✅ Attached ${attached.length} file(s) — they will be included in your next message.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to attach files: ${error}`);
        }
    }

    private async handleFileMentionSearch(query: string): Promise<void> {
        const normalizedQuery = query.trim().toLowerCase();
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        if (!this.panel || workspaceFolders.length === 0) {
            return;
        }

        const items = new Map<string, { path: string; kind: 'file' | 'folder' }>();

        for (const folder of workspaceFolders) {
            const rootRelativePath = vscode.workspace.asRelativePath(folder.uri, false);
            if (!normalizedQuery || rootRelativePath.toLowerCase().includes(normalizedQuery)) {
                items.set(rootRelativePath, { path: rootRelativePath, kind: 'folder' });
            }
        }

        const files = await this.findMentionCandidateFiles(normalizedQuery, 600);

        for (const file of files) {
            const relativePath = vscode.workspace.asRelativePath(file, false);
            const lowerPath = relativePath.toLowerCase();

            if (normalizedQuery && !lowerPath.includes(normalizedQuery)) {
                continue;
            }

            items.set(relativePath, { path: relativePath, kind: 'file' });

            const parts = relativePath.split('/');
            for (let index = 1; index < parts.length; index++) {
                const dirPath = parts.slice(0, index).join('/');
                if (!normalizedQuery || dirPath.toLowerCase().includes(normalizedQuery)) {
                    items.set(dirPath, { path: dirPath, kind: 'folder' });
                }
            }
        }

        const rankedItems = [...items.values()]
            .sort((a, b) => {
                const aName = a.path.split('/').pop()?.toLowerCase() || a.path.toLowerCase();
                const bName = b.path.split('/').pop()?.toLowerCase() || b.path.toLowerCase();
                const aExact = normalizedQuery && aName.startsWith(normalizedQuery) ? 0 : 1;
                const bExact = normalizedQuery && bName.startsWith(normalizedQuery) ? 0 : 1;
                return aExact - bExact || a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path);
            })
            .slice(0, 12);

        this.panel.webview.postMessage({
            command: 'fileMentionSuggestions',
            items: rankedItems
        });
    }

    private async findMentionCandidateFiles(query: string, limit: number): Promise<vscode.Uri[]> {
        const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/coverage/**,**/*.vsix,**/*.tgz}';
        const escapedQuery = this.escapeGlob(query.trim());

        if (escapedQuery) {
            const basenameMatches = await vscode.workspace.findFiles(`**/*${escapedQuery}*`, exclude, limit);
            if (basenameMatches.length > 0) {
                return basenameMatches;
            }
        }

        return await vscode.workspace.findFiles('**/*', exclude, limit);
    }

    private escapeGlob(value: string): string {
        return value.replace(/[{}[\]*?\\]/g, match => `\\${match}`);
    }

    private async expandFileMentions(text: string): Promise<string> {
        const mentionPattern = /@([^\s@]+)/g;
        const replacements = new Map<string, string>();

        for (const match of text.matchAll(mentionPattern)) {
            const mention = match[1];
            if (!mention || mention.includes('/')) {
                continue;
            }

            const resolved = await this.resolveFileMention(mention);
            if (resolved) {
                replacements.set(match[0], resolved);
            }
        }

        let expanded = text;
        for (const [mention, replacement] of replacements) {
            expanded = expanded.replaceAll(mention, replacement);
        }

        return expanded;
    }

    private async resolveFileMention(mention: string): Promise<string | null> {
        const normalizedMention = mention.toLowerCase();
        const files = await this.findMentionCandidateFiles(normalizedMention, 100);
        const matches = files
            .map(file => vscode.workspace.asRelativePath(file, false))
            .filter(relativePath => {
                const lowerPath = relativePath.toLowerCase();
                const basename = lowerPath.split('/').pop() || lowerPath;
                return basename === normalizedMention || basename.includes(normalizedMention) || lowerPath.includes(normalizedMention);
            })
            .sort((a, b) => {
                const aName = a.split('/').pop()?.toLowerCase() || a.toLowerCase();
                const bName = b.split('/').pop()?.toLowerCase() || b.toLowerCase();
                const aExact = aName === normalizedMention ? 0 : 1;
                const bExact = bName === normalizedMention ? 0 : 1;
                return aExact - bExact || a.length - b.length || a.localeCompare(b);
            });

        return matches[0] || null;
    }

    private async handleGetModels(): Promise<void> {
        this.outputChannel.appendLine('[ChatUI] Loading models...');
        
        let apiKey: string | undefined;
        try {
            apiKey = await this.context.secrets.get('mcp-ollama.apiKey');
        } catch (e) {
            apiKey = undefined;
        }
        const configGet = vscode.workspace.getConfiguration('mcp-ollama');
        const cloudModel = configGet.get<string>('cloudModel', '');
        // Show cloud model if configured — API key may be on the server side via CLOUD_API_KEY env var
        const cloudModels: ModelInfo[] = cloudModel ? [{
            name: cloudModel,
            displayName: `☁️ Cloud: ${cloudModel}`,
            size: 'Cloud'
        }] : [];

        try {
            const { MCPClient } = await import('./mcpClient.js');
            const mcpClient = new MCPClient();
            
            const response = await mcpClient.makeOllamaRequest('/api/tags');
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.body);
                
                if (data.models && Array.isArray(data.models)) {
                    const models: ModelInfo[] = data.models.map((model: OllamaModel) => ({
                        name: model.name,
                        displayName: this.formatModelName(model.name),
                        size: this.formatSize(model.size || 0)
                    }));
                    
                    const combinedModels = [...cloudModels, ...models];
                    this.outputChannel.appendLine(`[ChatUI] ✅ Loaded ${combinedModels.length} models`);
                    
                    this.panel?.webview.postMessage({
                        command: 'models',
                        models: combinedModels
                    });
                    return;
                }
            }
            
            throw new Error(`Ollama returned ${response.statusCode}`);
            
        } catch (error) {
            this.outputChannel.appendLine(`[ChatUI] ❌ Ollama error: ${error}`);
            
            const fallbackModels: ModelInfo[] = this.getFallbackModels();
            const combinedModels = [...cloudModels, ...fallbackModels];
            
            this.panel?.webview.postMessage({
                command: 'models',
                models: combinedModels
            });
        }
    }
    
    private getFallbackModels(): ModelInfo[] {
        return [
            { name: 'deepseek-coder-v2:236b', displayName: 'DeepSeek Coder V2', size: '236B' },
            { name: 'deepseek-r1:70b', displayName: 'DeepSeek R1', size: '70B' },
            { name: 'llama3.3:70b', displayName: 'Llama 3.3', size: '70B' },
            { name: 'phi4:latest', displayName: 'Phi-4', size: '14B' },
            { name: 'qwen3:32b', displayName: 'Qwen 3', size: '32B' },
            { name: 'llama3.1:8b', displayName: 'Llama 3.1', size: '8B' },
            { name: 'gemma3:27b', displayName: 'Gemma 3', size: '27B' }
        ];
    }
    
    private formatModelName(name: string): string {
        return name.split(':')[0].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    private formatSize(bytes: number): string {
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb > 1) {
            return `${Math.round(gb)}GB`;
        }
        const mb = bytes / (1024 * 1024);
        return `${Math.round(mb)}MB`;
    }

    private async handleSendMessage(text: string, model?: string, isAgentMode?: boolean): Promise<void> {
        if (!text.trim()) return;
        let expandedText = await this.expandFileMentions(text.trim());

        // Prepend any pending file attachments as context
        if (this.pendingAttachments.length > 0) {
            const fileContext = this.pendingAttachments.map(f =>
                `### Attached file: ${f.name} (${f.language})\n\`\`\`${f.language}\n${f.content.slice(0, 20000)}\n\`\`\``
            ).join('\n\n');
            expandedText = `${fileContext}\n\n${expandedText}`;
            this.pendingAttachments = []; // Clear after consuming
            // Notify webview to clear attachment chips
            this.panel?.webview.postMessage({ command: 'clearAttachments' });
        }

        this.panel?.webview.postMessage({
            command: 'userMessage',
            text: expandedText
        });
        
        // Note: contextualChat.sendContextualMessage handles adding to history
        
        this.outputChannel.appendLine(`[ChatUI] Processing: "${expandedText.substring(0, 100)}..."`);
        
        const agentCommand = this.agentCommandHandler.parseCommand(expandedText);
        if (agentCommand) {
            await this.handleAgentCommand(agentCommand.command, agentCommand.args, model);
            return;
        }

        if (isAgentMode && this.isAgentFollowUpQuestion(expandedText)) {
            this.handleAgentFollowUpQuestion(expandedText);
            return;
        }

        if (isAgentMode && !this.isChatOnlyQuestion(expandedText, { explicitAgent: true })) {
            await this.handleAgentMode(expandedText, model);
            return;
        }
        
        if (this.streamingClient) {
            // Stream tokens progressively so the user sees output immediately.
            const activeModel = model || this.selectedModel;
            // Snapshot prior history BEFORE recording the current user turn so we
            // don't duplicate the current message in the context window.
            const history = this.chatHistory.getRecentMessages(10)
                .map(m => ({ role: m.role, content: m.content }));
            // Record the user turn ourselves — we are bypassing contextualChat,
            // which used to be responsible for persisting it.
            this.chatHistory.addMessage('user', expandedText);
            let streamed = false;
            try {
                await this.streamingClient.streamChat(
                    expandedText,
                    undefined,
                    (token) => {
                        streamed = true;
                        this.panel?.webview.postMessage({ command: 'response-chunk', text: token });
                    },
                    (fullText) => {
                        this.outputChannel.appendLine(`[ChatUI] Streamed ${fullText.length} chars`);
                        // If the stream produced nothing usable, fall back.
                        const text = (streamed && fullText.trim().length > 0)
                            ? fullText
                            : this.getFallbackResponse(expandedText);
                        this.chatHistory.addMessage('assistant', text);
                        this.panel?.webview.postMessage({ command: 'response-done', text });
                    },
                    (error) => {
                        this.outputChannel.appendLine(`[ChatUI] Stream error: ${error.message}`);
                        const fallback = this.getFallbackResponse(expandedText);
                        this.chatHistory.addMessage('assistant', fallback);
                        this.panel?.webview.postMessage({ command: 'response', text: fallback });
                    },
                    { model: activeModel, messages: history, language: 'typescript' }
                );
            } catch (error) {
                this.outputChannel.appendLine(`[ChatUI] Stream setup error: ${error}`);
                const fallback = this.getFallbackResponse(expandedText);
                this.chatHistory.addMessage('assistant', fallback);
                this.panel?.webview.postMessage({ command: 'response', text: fallback });
            }
        } else {
            try {
                // Non-streaming fallback (contextual chat with conversation continuity).
                const response = await this.contextualChat.sendContextualMessage(expandedText, model || this.selectedModel);
                this.outputChannel.appendLine(`[ChatUI] Got response (${response.length} chars): ${response.substring(0, 80)}`);
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: response || this.getFallbackResponse(expandedText)
                });
            } catch (error) {
                this.outputChannel.appendLine(`[ChatUI] Error: ${error}`);
                const fallbackResponse = this.getFallbackResponse(expandedText);
                this.chatHistory.addMessage('assistant', fallbackResponse);
                this.panel?.webview.postMessage({ command: 'response', text: fallbackResponse });
            }
        }
    }
    
    private isLargeCodebaseQuery(text: string): boolean {
        const largeCodebaseKeywords = [
            'analyze entire', 'whole project', 'complete codebase', 'all files',
            'million lines', 'large project', 'enterprise', 'architecture overview'
        ];
        return largeCodebaseKeywords.some(keyword => text.toLowerCase().includes(keyword));
    }
    
    private async handleLargeCodebaseAnalysis(text: string, model: string, mcpClient: any): Promise<string> {
        // For enterprise codebases, use progressive analysis
        const analysisSteps = [
            '📊 **Phase 1**: Analyzing project structure...',
            '🔍 **Phase 2**: Examining core components...',
            '⚡ **Phase 3**: Identifying key patterns...',
            '📋 **Phase 4**: Generating comprehensive report...'
        ];
        
        for (const step of analysisSteps) {
            this.panel?.webview.postMessage({
                command: 'response',
                text: step
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Use workspace analysis for large codebases
        const result = await mcpClient.callTool('workspace_analysis', {
            workspaceRoot: process.cwd(),
            analysisDepth: 'comprehensive',
            includePatterns: ['**/*.{js,ts,py,java,cpp,go,rs}'],
            maxFiles: 1000 // Handle up to 1000 files
        });
        
        return `✅ **Enterprise Codebase Analysis Complete**\n\n${result.analysis || 'Comprehensive analysis completed for large codebase.'}`;
    }
    
    private isCodeRelated(text: string): boolean {
        const codeKeywords = [
            'function', 'class', 'const', 'let', 'var', 'if', 'for', 'while',
            'import', 'export', 'return', 'console.log', 'print', 'def',
            'public', 'private', 'static', 'async', 'await', '{', '}', '()', '=>',
            'explain this code', 'what does this do', 'how does this work',
            'analyze code', 'review code', 'understand code', 'code structure'
        ];
        
        const lowerText = text.toLowerCase();
        return codeKeywords.some(keyword => lowerText.includes(keyword)) || 
               /[{}();\[\]<>]/.test(text) || 
               text.split('\n').length > 2 ||
               text.length > 500; // Large text likely contains code
    }
    
    private async handleAgentCommand(command: string, args: string, model?: string): Promise<void> {
        let pollInterval: NodeJS.Timeout | undefined;
        const taskId = `auto_cmd_${command}_${Date.now()}`;
        
        try {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `🤖 Executing /${command} command: ${args}`
            });

            // Check MCP server status first
            const serverRunning = await this.checkMCPServer();
            if (!serverRunning) {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: `❌ **MCP Server not running**\n\nPlease start the server:\n\`\`\`bash\ncd mcp-ollama\nnpm start\n\`\`\``
                });
                return;
            }

            // Start real-time status polling
            pollInterval = this.startAgentStatusPolling(taskId);
            
            // Execute with timeout
            const result = await Promise.race([
                this.agentCommandHandler.executeCommand(command, args, {
                    model: model || 'deepseek-coder-v2:236b',
                    workspacePath: vscode.workspace.rootPath,
                    taskId: taskId
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout after 300 seconds')), 300000)
                )
            ]);
            this.lastAgentResult = result;

            this.finalizeAgentProgress(taskId, pollInterval, true);

            // Show results
            if (this.showProposedChangesIfPresent(result as any)) {
                return;
            }

            this.panel?.webview.postMessage({
                command: 'response',
                text: `✅ **/${command} completed**\n\n${formatAgentResultSummary(result)}`
            });

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.finalizeAgentProgress(taskId, pollInterval, false, errorMsg);
            
            this.panel?.webview.postMessage({
                command: 'response',
                text: `❌ **${command} failed:** ${error}\n\n💡 **Troubleshooting:**\n• Check MCP server is running\n• Verify Ollama is installed\n• Try a simpler command first`
            });
        }
    }

    private async handleAgentMode(text: string, model?: string): Promise<void> {
        let pollInterval: NodeJS.Timeout | undefined;
        const taskId = `auto_agent_${Date.now()}`;

        try {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `🤖 **Agent Mode Activated**\n\nTask: "${text}"\n\n⚡ Working...`
            });

            const mcpClient = this.mcpClient;
            if (!mcpClient) {
                throw new Error('MCP client not initialized');
            }

            const serverRunning = await this.checkMCPServer();
            if (!serverRunning) {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: `❌ **MCP Server Required**\n\nAgent mode requires the MCP server to be running.\n\n**Start the server:**\n\`\`\`bash\ncd mcp-ollama\nnpm start\n\`\`\``
                });
                return;
            }

            await mcpClient.connect();

            const workspacePath = this.getWorkspacePath();
            const files = await resolveAgentFiles(text, workspacePath);
            const language = vscode.window.activeTextEditor?.document.languageId || 'typescript';

            // Start real-time status polling
            pollInterval = this.startAgentStatusPolling(taskId);

            // Call agent execution with timeout handling
            const agentResult = await Promise.race([
                mcpClient.callTool('agent_execute', {
                    taskId,
                    description: text,
                    context: {
                        workspacePath,
                        language,
                        ...(files.length > 0 ? { files } : {}),
                        previewChanges: true,
                        verify: true,
                        useNlpRouting: true,
                    },
                    priority: 'medium'
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Agent task timeout - this is normal for complex tasks')), 300000)
                )
            ]);
            this.lastAgentResult = agentResult;

            this.finalizeAgentProgress(taskId, pollInterval, true);

            if (this.showProposedChangesIfPresent(agentResult as any)) {
                return;
            }

            this.panel?.webview.postMessage({
                command: 'response',
                text: `✅ **Agent workflow complete**\n\n${formatAgentResultSummary(agentResult)}`
            });

        } catch (error) {
            this.outputChannel.appendLine(`[ChatUI] Agent mode error: ${error}`);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.finalizeAgentProgress(taskId, pollInterval, false, errorMsg);
            
            if (error instanceof Error && error.message?.includes('timeout')) {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: `⏱️ **Agent Task In Progress**\n\nYour task "${text}" is being processed by the agent system.\n\nℹ️ **This is normal** - complex agent tasks can take 30-60 seconds.\n\n🔄 **The agent is working on:**\n• Breaking down your task into steps\n• Planning the implementation\n• Executing the workflow\n\n💡 **For faster results, try simpler tasks like:**\n• "Explain this code"\n• "Fix syntax errors"\n• "Generate a simple function"`
                });
            } else {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: `❌ **Agent Mode Error**\n\n${error instanceof Error ? error.message : String(error)}\n\n💡 **Try:**\n• Ensure MCP server is running\n• Use simpler task description\n• Check Ollama is available`
                });
            }
        }
    }

    private isChatOnlyQuestion(text: string, opts?: { explicitAgent?: boolean }): boolean {
        const lower = text.trim().toLowerCase();
        if (lower.length < 4) return true;
        if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/.test(lower)) return true;

        const questionLead =
            /^(what|why|how|when|who|where|explain|describe|tell me about|can you explain|are|is|can|do|should|would|will|could|may|am|have|has)\b/.test(lower);
        const actionVerbs = [
            'create', 'make', 'build', 'implement', 'add', 'fix', 'debug', 'refactor',
            'generate', 'write', 'delete', 'remove', 'rename', 'move', 'run', 'test',
            'update', 'modify', 'change', 'setup', 'install', 'convert', 'migrate', 'optimize',
            'list', 'show', 'find', 'search', 'inspect', 'execute', 'scan', 'report',
            'analyze', 'review', 'audit', 'check', 'summarize', 'explore', 'open',
        ];
        const hasAction = actionVerbs.some((verb) => new RegExp(`\\b${verb}\\b`).test(lower));

        // A leading question with no code action is conversational.
        if (questionLead && !hasAction) return true;

        // When the user EXPLICITLY enabled Agent mode, honor that intent: anything
        // that is not a greeting or a pure question should run the agent. Do NOT
        // second-guess it with the code-target heuristic below, which misfires on
        // perfectly valid tasks (e.g. "list all typescript files in workspace").
        if (opts?.explicitAgent) return false;

        // Knowledge/recommendation requests with no actionable code signal
        // (no action verb, no file path, no code-target noun) must be answered
        // conversationally — not pushed through the agent workflow, which would
        // have nothing to build (e.g. "suggest me the best ai agent papers").
        const hasFilePath = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|css|html|yml|yaml|sql)\b/i.test(lower);
        const codeTargets = [
            'file', 'folder', 'directory', 'component', 'function', 'class', 'method',
            'api', 'endpoint', 'test', 'bug', 'error', 'project', 'code', 'module',
            'service', 'page', 'route', 'script', 'variable', 'interface', 'config',
        ];
        const hasCodeTarget = codeTargets.some((t) => new RegExp(`\\b${t}\\b`).test(lower));
        if (!hasAction && !hasFilePath && !hasCodeTarget) return true;

        return false;
    }

    /** @deprecated Use isChatOnlyQuestion — kept for reference */
    private shouldRunAgentWorkflow(text: string): boolean {
        const lower = text.toLowerCase().trim();
        if (/^\/(dev|test|review|docs)\b/.test(lower)) {
            return false;
        }
        if (/(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java)\b/i.test(text)) {
            return true;
        }
        const agentVerbs = [
            'create', 'make', 'build', 'implement', 'add', 'update', 'modify',
            'change', 'fix', 'debug', 'refactor', 'generate', 'write', 'delete',
            'remove', 'rename', 'move', 'run', 'test', 'analyze', 'review',
            'optimize', 'setup', 'install', 'convert', 'migrate', 'comment'
        ];
        const codeTargets = [
            'file', 'folder', 'directory', 'component', 'function', 'class',
            'api', 'endpoint', 'test', 'bug', 'error', 'project', 'code',
            'module', 'service', 'page', 'route', 'script', 'embed', 'method'
        ];

        return agentVerbs.some(verb => lower.includes(verb)) &&
            codeTargets.some(target => lower.includes(target));
    }

    private isAgentFollowUpQuestion(text: string): boolean {
        const lower = text.toLowerCase();
        return Boolean(this.lastAgentResult) && (
            lower.includes('where') ||
            lower.includes('saved') ||
            lower.includes('which file') ||
            lower.includes('file path') ||
            lower.includes('what file') ||
            lower.includes('what did you change')
        );
    }

    private handleAgentFollowUpQuestion(text: string): void {
        const changedFiles = this.getLastAgentFiles();
        const proposedChanges = this.extractProposedChanges(this.lastAgentResult);

        if (changedFiles.length === 0 && proposedChanges.length === 0) {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `I do not see any saved file from the last agent result. It may have produced text only or timed out before returning file details.`
            });
            return;
        }

        const savedFiles = changedFiles.length > 0
            ? changedFiles.map(file => `- ${file}`).join('\n')
            : proposedChanges.map(change => `- ${change.filePath} (${change.status}, awaiting approval)`).join('\n');

        this.panel?.webview.postMessage({
            command: 'response',
            text: `The last agent result points to:\n\n${savedFiles}`
        });
    }

    private getLastAgentFiles(): string[] {
        const directFiles = Array.isArray(this.lastAgentResult?.filesModified)
            ? this.lastAgentResult.filesModified
            : [];
        const stepFiles = Array.isArray(this.lastAgentResult?.steps)
            ? this.lastAgentResult.steps.flatMap((step: any) => step?.result?.filesModified || [])
            : [];

        return [...new Set([...directFiles, ...stepFiles])]
            .filter((file): file is string => typeof file === 'string' && file.length > 0);
    }

    private async checkMCPServer(): Promise<boolean> {
        try {
            const { MCPClient } = await import('./mcpClient.js');
            const mcpClient = new MCPClient();
            await Promise.race([
                mcpClient.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
            ]);
            return true;
        } catch {
            return false;
        }
    }

    private getWorkspacePath(): string {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder?.uri.fsPath ?? vscode.workspace.rootPath ?? process.cwd();
    }

    private async runPostAcceptVerification(): Promise<void> {
        const workspacePath = this.getWorkspacePath();
        const shouldVerify = this.lastAgentResult?.verification !== undefined
            || this.lastAgentResult?.context?.verify !== false;

        if (!shouldVerify) return;

        try {
            const mcpClient = this.mcpClient;
            if (!mcpClient) return;

            await mcpClient.connect();
            const raw = await mcpClient.verifyWorkspace(workspacePath);
            const verification = extractVerification(raw);
            if (verification) {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: formatVerificationMarkdown(verification),
                });
            }
        } catch (error) {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `⚠️ **Post-accept verification could not run**\n\n${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private showProposedChangesIfPresent(result: any): boolean {
        const proposedChanges = extractAgentProposedChanges(result);
        if (proposedChanges.length === 0) {
            return false;
        }
        storePendingChanges(proposedChanges);

        const verification = extractVerification(result);
        const verifyNote = verification
            ? `\n\n${formatVerificationMarkdown(verification)}`
            : '\n\n_Build/test checks will run after you accept all changes._';

        const workspacePath = this.getWorkspacePath();
        const changeSummaries = proposedChanges.map((change) =>
            summarizeFileChange(change.filePath, change.original, change.modified, workspacePath)
        );
        const changeDetails = formatChangeSummaryMarkdown(changeSummaries);

        const groupId = `diff_${Date.now()}`;
        const pending = new Map(proposedChanges.map(change => [change.filePath, change]));
        const onPendingSettled = () => {
            if (pending.size === 0) {
                void this.runPostAcceptVerification();
            }
        };

        // Register callbacks so acceptDiff/rejectDiff messages can invoke them
        proposedChanges.forEach(change => {
            this.pendingDiffCallbacks.set(change.filePath, {
                accept: async () => {
                    if (!pending.has(change.filePath)) return;
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(change.filePath),
                        Buffer.from(change.modified, 'utf8')
                    );
                    pending.delete(change.filePath);
                    this.pendingDiffCallbacks.delete(change.filePath);
                    onPendingSettled();
                },
                reject: () => {
                    if (!pending.has(change.filePath)) return;
                    pending.delete(change.filePath);
                    this.pendingDiffCallbacks.delete(change.filePath);
                    onPendingSettled();
                }
            });
        });

        // Render diff cards inline in the chat panel — no separate panel
        this.panel?.webview.postMessage({
            command: 'showInlineDiffs',
            groupId,
            diffs: proposedChanges.map(c => ({
                filePath: c.filePath,
                original: c.original,
                modified: c.modified,
                status: c.status,
                changeSummary: c.changeSummary ?? ''
            }))
        });

        return true;
    }

    private extractProposedChanges(result: any): FileDiff[] {
        const directChanges = Array.isArray(result?.proposedChanges) ? result.proposedChanges : [];
        const stepChanges = Array.isArray(result?.steps)
            ? result.steps.flatMap((step: any) => step?.result?.proposedChanges || [])
            : [];

        return [...directChanges, ...stepChanges]
            .filter((change: any) =>
                typeof change?.filePath === 'string' &&
                typeof change?.original === 'string' &&
                typeof change?.modified === 'string' &&
                ['added', 'modified', 'deleted'].includes(change?.status)
            )
            .map((change: any) => ({
                filePath: change.filePath,
                original: change.original,
                modified: change.modified,
                status: change.status,
                changeSummary: change.changeSummary,
                additions: change.additions,
                anchorLine: change.anchorLine,
                anchorText: change.anchorText,
            }));
    }

    private async handleShowContext(): Promise<void> {
        try {
            const summary = this.contextualChat.getConversationSummary();
            this.panel?.webview.postMessage({
                command: 'response',
                text: `## 📋 Conversation Context Summary\n\n${summary}`
            });
        } catch (error) {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `❌ Failed to get conversation context: ${error}`
            });
        }
    }

    private getFallbackResponse(text: string): string {
        return `⚠️ **MCP server is not reachable.**

Your message was: "${text}"

To get a real AI response, start the server:
\`\`\`bash
cd ~/Coding-AI-Assistant/mcp-ollama
docker-compose up
# or without Docker:
npm start
\`\`\`

Then verify it's running:
\`\`\`bash
curl http://localhost:3078/health
\`\`\``;
    }

    private startAgentStatusPolling(taskId: string): NodeJS.Timeout {
        // Initial setup for progress panel
        this.postWorkflowProgress(taskId, [
            { id: 'init', action: 'Initializing agent task...', status: 'running' }
        ]);

        if (this.activePollInterval) {
            clearInterval(this.activePollInterval);
        }

        this.activePollInterval = setInterval(async () => {
            try {
                if (!this.mcpClient) return;

                const response = await this.mcpClient.callTool('agent_status', { taskId });
                if (!response) return;

                if (response.error === 'Task not found') {
                    // Task not registered on server yet, wait for next cycle
                    return;
                }

                // If task status is defined
                if (response.status) {
                    const planSteps = response.plan?.steps || [];
                    const uiSteps: WorkflowStep[] = [];

                    if (planSteps.length === 0) {
                        // If planning or analyzing phase
                        let planStatus: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
                        if (response.status === 'analyzing' || response.status === 'planning') {
                            planStatus = 'running';
                        } else if (response.status !== 'failed') {
                            planStatus = 'completed';
                        } else {
                            planStatus = 'failed';
                        }

                        uiSteps.push({
                            id: 'init',
                            action: 'Initializing agent task...',
                            status: planStatus === 'running' ? 'running' : 'completed'
                        });
                        uiSteps.push({
                            id: 'planning_phase',
                            action: `Analyzing and Planning (Status: ${response.status})`,
                            status: planStatus
                        });
                        uiSteps.push({
                            id: 'executing_phase',
                            action: 'Executing task steps',
                            status: 'pending'
                        });
                    } else {
                        // Real plan steps exist — init phase is done
                        uiSteps.push({
                            id: 'init',
                            action: 'Initializing agent task...',
                            status: 'completed'
                        });
                        // Map actual steps
                        const taskDone = response.status === 'completed' || response.status === 'failed';
                        planSteps.forEach((step: any) => {
                            let status: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
                            if (step.status === 'executing') {
                                // If the overall task is already done, don't leave steps stuck as running
                                status = taskDone ? 'completed' : 'running';
                            } else if (step.status === 'completed' || step.status === 'skipped') {
                                status = 'completed';
                            } else if (step.status === 'failed') {
                                status = 'failed';
                            }

                            uiSteps.push({
                                id: step.id,
                                action: `${step.action} [${step.tool}]`,
                                status,
                                error: step.error || undefined
                            });
                        });
                    }

                    // Append verification step if present or when running/finished
                    let verificationStatus: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
                    if (response.status === 'validating') {
                        verificationStatus = 'running';
                    } else if (response.status === 'completed') {
                        verificationStatus = 'completed';
                    } else if (response.status === 'failed' && response.progress === 100) {
                        verificationStatus = 'failed';
                    }

                    uiSteps.push({
                        id: 'verification_phase',
                        action: 'Post-implementation workspace verification',
                        status: verificationStatus
                    });

                    this.postWorkflowProgress(taskId, uiSteps);
                }
            } catch (err) {
                // Silently log or ignore poll network errors to avoid spamming the logs
                this.outputChannel.appendLine(`[ChatUI] Polling error: ${err}`);
            }
        }, 1500);

        return this.activePollInterval;
    }

    private finalizeAgentProgress(taskId: string, pollInterval: NodeJS.Timeout | undefined, success: boolean, errorMsg?: string) {
        if (this.activePollInterval) {
            clearInterval(this.activePollInterval);
            this.activePollInterval = undefined;
        }

        // Fetch final status one last time to make sure UI is fully synchronized
        setTimeout(async () => {
            try {
                if (!this.mcpClient) return;
                const response = await this.mcpClient.callTool('agent_status', { taskId });
                if (response && response.status) {
                    const planSteps = response.plan?.steps || [];
                    const uiSteps: WorkflowStep[] = [
                        { id: 'init', action: 'Initializing agent task...', status: 'completed' }
                    ];
                    planSteps.forEach((step: any) => {
                        // At finalization, treat any still-executing step as completed/failed per overall success
                        let status: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
                        if (step.status === 'executing') {
                            status = success ? 'completed' : 'failed';
                        } else if (step.status === 'completed' || step.status === 'skipped') {
                            status = 'completed';
                        } else if (step.status === 'failed') {
                            status = 'failed';
                        }

                        uiSteps.push({
                            id: step.id,
                            action: `${step.action} [${step.tool}]`,
                            status,
                            error: step.error || undefined
                        });
                    });

                    // Force validation check to reflect final outcome
                    uiSteps.push({
                        id: 'verification_phase',
                        action: 'Post-implementation workspace verification',
                        status: success ? 'completed' : 'failed',
                        error: errorMsg
                    });

                    this.postWorkflowProgress(taskId, uiSteps);
                } else {
                    // Fallback: mark last known step as final
                    const fallbackStep: WorkflowStep = {
                        id: 'verification_phase',
                        action: 'Post-implementation workspace verification',
                        status: success ? 'completed' : 'failed',
                        error: errorMsg
                    };
                    this.postWorkflowProgress(taskId, [fallbackStep]);
                }
            } catch {
                const fallbackStep: WorkflowStep = {
                    id: 'verification_phase',
                    action: 'Post-implementation workspace verification',
                    status: success ? 'completed' : 'failed',
                    error: errorMsg
                };
                this.postWorkflowProgress(taskId, [fallbackStep]);
            }
        }, 1000);
    }

    public dispose(): void {
        try {
            if (this.activePollInterval) {
                clearInterval(this.activePollInterval);
                this.activePollInterval = undefined;
            }
            // Dispose all event listeners first
            this.disposables.forEach(d => {
                try {
                    d.dispose();
                } catch (e) {
                    // Ignore disposal errors
                }
            });
            this.disposables = [];
            
            // Dispose components
            this.activeWorkflowTaskId = undefined;
            this.workflowProgressView.dispose();
            this.diffViewer.dispose();
            this.issuesPanel.dispose();
            
            // Dispose panel
            if (this.panel) {
                try {
                    this.panel.dispose();
                } catch (e) {
                    // Ignore
                }
                this.panel = undefined;
            }
        } catch (error) {
            // Silently handle disposal errors
        }
    }
}
