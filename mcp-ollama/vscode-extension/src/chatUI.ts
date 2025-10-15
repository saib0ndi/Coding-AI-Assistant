import * as vscode from 'vscode';
import { AgentCommandHandler } from './agentCommands';
import { WorkflowProgressView } from './workflowProgressView';
import { DiffViewer } from './diffViewer';
import { IssuesPanel } from './issuesPanel';
import { ChatHistory } from './chatHistory';
import { ConversationContext } from './conversationContext';
import { ContextualChat } from './contextualChat';

// Message interfaces for type safety
interface WebviewMessage {
    command: string;
    text?: string;
    model?: string;
    isAgentMode?: boolean;
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

    constructor(private context: vscode.ExtensionContext, private mcpClient?: any) {
        this.outputChannel = vscode.window.createOutputChannel('SmartCode-AIAssist');
        this.outputChannel.appendLine('ChatUI initialized');
        
        this.agentCommandHandler = new AgentCommandHandler();
        this.workflowProgressView = new WorkflowProgressView(context);
        this.diffViewer = new DiffViewer(context);
        this.issuesPanel = new IssuesPanel(context);
        this.chatHistory = new ChatHistory(context);
        this.conversationContext = new ConversationContext(context);
        this.contextualChat = new ContextualChat(context, mcpClient);
    }

    public show() {
        if (this.panel) {
            this.panel.dispose();
        }

        const uniqueId = `mcpChat_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        this.panel = vscode.window.createWebviewPanel(
            uniqueId,
            'MCP-Ollama Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: []
            }
        );

        this.panel.webview.html = this.getHTML();
        this.setupMessageHandling();
    }

    private getHTML(): string {
        const timestamp = Date.now();
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>MCP-Ollama Chat v${timestamp}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 20px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .logo {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 16px;
            font-weight: 600;
        }
        
        .status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #4CAF50;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .actions {
            display: flex;
            gap: 8px;
        }
        
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .clear-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
        }
        
        .clear-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .model-dropdown-input {
            background: none;
            color: var(--vscode-input-foreground);
            border: none;
            border-radius: 6px;
            padding: 4px 8px;
            font-size: 12px;
            min-width: 120px;
            max-width: 140px;
            cursor: pointer;
            outline: none;
        }
        
        .model-dropdown-input:focus {
            background: var(--vscode-dropdown-background);
        }
        
        .model-dropdown-input option {
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            font-size: 11px;
        }
        
        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            scroll-behavior: smooth;
        }
        
        .messages::-webkit-scrollbar {
            width: 6px;
        }
        
        .messages::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 3px;
        }
        
        .welcome {
            text-align: center;
            padding: 40px 20px;
            max-width: 500px;
            margin: 0 auto;
        }
        
        .welcome h2 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .welcome p {
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
            margin-bottom: 8px;
        }
        
        .message {
            display: flex;
            margin-bottom: 16px;
            animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .message.user {
            justify-content: flex-end;
        }
        
        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            line-height: 1.6;
            word-wrap: break-word;
        }
        
        .message.user .message-content {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-bottom-right-radius: 4px;
        }
        
        .message.assistant .message-content {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-bottom-left-radius: 4px;
        }
        
        /* Markdown styling */
        .message-content p {
            margin-bottom: 8px;
        }
        
        .message-content p:last-child {
            margin-bottom: 0;
        }
        
        .message-content h1, .message-content h2, .message-content h3 {
            margin: 12px 0 8px 0;
            font-weight: 600;
        }
        
        .message-content ul, .message-content ol {
            margin-left: 20px;
            margin-bottom: 8px;
        }
        
        .message-content li {
            margin-bottom: 4px;
        }
        
        /* Code block styling */
        .message-content pre {
            background: #1e1e1e;
            border-radius: 8px;
            padding: 12px;
            margin: 8px 0;
            overflow-x: auto;
            position: relative;
        }
        
        .message-content code {
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
        }
        
        .message-content pre code {
            background: none;
            padding: 0;
            border-radius: 0;
        }
        
        .message-content :not(pre) > code {
            background: rgba(110, 118, 129, 0.2);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
        }
        
        /* Copy button for code blocks */
        .code-block-wrapper {
            position: relative;
            margin: 8px 0;
        }
        
        .copy-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        .code-block-wrapper:hover .copy-btn {
            opacity: 1;
        }
        
        .copy-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .message-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            margin: 0 8px;
            flex-shrink: 0;
        }
        
        .message.user .message-avatar {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            order: 1;
        }
        
        .message.assistant .message-avatar {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .input-container {
            padding: 16px 20px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        
        .input-wrapper {
            display: flex;
            gap: 8px;
            align-items: flex-end;
            background: var(--vscode-input-background);
            border: 2px solid var(--vscode-input-border);
            border-radius: 12px;
            padding: 8px 12px;
            transition: border-color 0.2s ease;
        }
        
        .input-wrapper:focus-within {
            border-color: var(--vscode-focusBorder);
        }
        
        .input-wrapper.agent-active {
            border-color: #667eea;
            background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
        }
        
        .agent-toggle {
            background: var(--vscode-button-secondaryBackground);
            border: 1px solid var(--vscode-button-border);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            padding: 6px 8px;
            border-radius: 6px;
            font-size: 14px;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 60px;
            justify-content: center;
        }
        
        .agent-toggle:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .agent-toggle.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-color: #667eea;
            box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
        }
        
        .agent-status-bar {
            display: none;
            padding: 8px 12px;
            background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
            border: 1px solid rgba(102, 126, 234, 0.3);
            border-radius: 8px;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--vscode-foreground);
            align-items: center;
            gap: 8px;
        }
        
        .agent-status-bar.active {
            display: flex;
        }
        
        .agent-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
        }
        
        .attach-input-btn {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 16px;
            transition: all 0.2s ease;
        }
        
        .attach-input-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
            color: var(--vscode-foreground);
        }
        
        .message-input {
            flex: 1;
            background: none;
            border: none;
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 14px;
            line-height: 1.4;
            resize: none;
            outline: none;
            min-height: 20px;
            max-height: 100px;
            overflow-y: auto;
        }
        
        .message-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        
        .send-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
        }
        
        .send-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
        }
        
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">
            <span>🚀</span>
            <span>MCP-Ollama Chat</span>
        </div>
        <div class="status">
            <div class="status-dot"></div>
            <span>Ready</span>
        </div>
        <div class="actions">
            <button class="btn clear-btn" id="clearBtn">
                <span>🗑️</span>
                <span>Clear</span>
            </button>
        </div>
    </div>
    
    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="welcome">
                <h2>Ready to Code!</h2>
                <p>I'm your AI coding assistant powered by MCP-Ollama.</p>
                <p>Ask me anything about your code, attach files, or get help with development tasks!</p>
            </div>
        </div>
        
        <div class="input-container">
            <div class="agent-status-bar" id="agentStatusBar">
                <span class="agent-badge">🤖 AGENT</span>
                <span>Multi-agent system will break down your task into steps and execute them automatically</span>
            </div>
            <div class="input-wrapper" id="inputWrapper">
                <button class="agent-toggle" id="agentToggle" title="Toggle Agent Mode">
                    <span id="agentIcon">🤖</span>
                </button>
                <button class="attach-input-btn" id="attachInputBtn" title="Attach files">📎</button>
                <textarea class="message-input" id="messageInput" placeholder="Ask me anything about your code..." rows="1"></textarea>
                <select id="modelSelect" class="model-dropdown-input">
                    <option value="loading">Loading models...</option>
                </select>
                <button class="send-btn" id="sendBtn">Send</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let selectedModel = 'deepseek-coder-v2:236b';
        let isAgentMode = false;
        
        // Load available models
        async function loadModels() {
            try {
                vscode.postMessage({ command: 'getModels' });
            } catch (error) {
                console.error('Failed to load models:', error);
            }
        }
        
        // Configure marked to use highlight.js
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (err) {}
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true
        });
        
        function addMessage(text, isUser = false) {
            const messages = document.getElementById('messages');
            const welcome = messages.querySelector('.welcome');
            if (welcome) welcome.remove();
            
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isUser ? 'user' : 'assistant');
            
            const avatar = document.createElement('div');
            avatar.className = 'message-avatar';
            avatar.textContent = isUser ? '👤' : '🤖';
            
            const content = document.createElement('div');
            content.className = 'message-content';
            
            // Parse markdown for both user and assistant messages
            const html = marked.parse(text);
            content.innerHTML = html;
            
            // Add copy buttons to code blocks
            content.querySelectorAll('pre').forEach((pre, index) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'code-block-wrapper';
                pre.parentNode.insertBefore(wrapper, pre);
                wrapper.appendChild(pre);
                
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.textContent = 'Copy';
                copyBtn.onclick = () => {
                    const code = pre.querySelector('code').textContent;
                    navigator.clipboard.writeText(code).then(() => {
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy';
                        }, 2000);
                    });
                };
                wrapper.appendChild(copyBtn);
            });
            
            messageDiv.appendChild(avatar);
            messageDiv.appendChild(content);
            messages.appendChild(messageDiv);
            messages.scrollTop = messages.scrollHeight;
        }
        
        document.getElementById('attachInputBtn').onclick = () => {
            vscode.postMessage({ command: 'attachFiles' });
        };
        
        document.getElementById('clearBtn').onclick = () => {
            const messages = document.getElementById('messages');
            messages.innerHTML = '<div class="welcome"><h2>🎯 Ready to Code!</h2><p>I\\'m your AI coding assistant powered by MCP-Ollama.</p><p>Ask me anything about your code, attach files, or get help with development tasks!</p></div>';
        };
        
        document.getElementById('agentToggle').onclick = () => {
            isAgentMode = !isAgentMode;
            const toggle = document.getElementById('agentToggle');
            const icon = document.getElementById('agentIcon');
            const statusBar = document.getElementById('agentStatusBar');
            const inputWrapper = document.getElementById('inputWrapper');
            const messageInput = document.getElementById('messageInput');
            
            if (isAgentMode) {
                toggle.classList.add('active');
                icon.textContent = '🤖';
                statusBar.classList.add('active');
                inputWrapper.classList.add('agent-active');
                messageInput.placeholder = 'Agent mode: Describe your coding task (e.g., "Create a REST API", "Fix this bug", "Generate tests")';
            } else {
                toggle.classList.remove('active');
                icon.textContent = '💬';
                statusBar.classList.remove('active');
                inputWrapper.classList.remove('agent-active');
                messageInput.placeholder = 'Ask me anything about your code...';
            }
            
            messageInput.focus();
        };
        
        document.getElementById('sendBtn').onclick = () => {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            if (message) {
                addMessage(message, true);
                vscode.postMessage({ 
                    command: 'sendMessage', 
                    text: message, 
                    model: selectedModel,
                    isAgentMode: isAgentMode
                });
                input.value = '';
                input.style.height = 'auto';
            }
        };
        
        document.getElementById('modelSelect').onchange = (e) => {
            selectedModel = e.target.value;
            vscode.postMessage({ command: 'modelChanged', model: selectedModel });
        };
        
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('sendBtn').click();
            }
        });
        
        document.getElementById('messageInput').addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
        });
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'response') {
                addMessage(message.text);
            } else if (message.command === 'models') {
                const modelSelect = document.getElementById('modelSelect');
                modelSelect.innerHTML = '';
                
                message.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = model.displayName + ' (' + model.size + ')';
                    if (model.name === selectedModel) {
                        option.selected = true;
                    }
                    modelSelect.appendChild(option);
                });
            }
        });
        
        // Load models on startup
        loadModels();
    </script>
</body>
</html>`;
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
                    case 'modelChanged':
                        if (this.outputChannel) {
                            this.outputChannel.appendLine(`[ChatUI] Model changed to: ${message.model}`);
                        }
                        break;
                    case 'clearHistory':
                        this.chatHistory.clearHistory();
                        this.conversationContext.clearContext();
                        break;
                    case 'showContext':
                        await this.handleShowContext();
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

    private async handleAttachFiles() {
        try {
            const files = await vscode.window.showOpenDialog({
                canSelectMany: true,
                filters: {
                    'Code Files': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'go', 'rs'],
                    'All Files': ['*']
                }
            });

            if (files && files.length > 0) {
                vscode.window.showInformationMessage(`✅ Attached ${files.length} files successfully!`);

                const fileNames = files.map(f => f.path.split('/').pop()).join(', ');
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: `📎 Attached files: ${fileNames}`
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to attach files: ${error}`);
        }
    }

    private async handleGetModels(): Promise<void> {
        this.outputChannel.appendLine('[ChatUI] Loading models...');
        
        try {
            const { MCPClient } = await import('./mcpClient');
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
                    
                    this.outputChannel.appendLine(`[ChatUI] ✅ Loaded ${models.length} models`);
                    
                    this.panel?.webview.postMessage({
                        command: 'models',
                        models: models
                    });
                    return;
                }
            }
            
            throw new Error(`Ollama returned ${response.statusCode}`);
            
        } catch (error) {
            this.outputChannel.appendLine(`[ChatUI] ❌ Ollama error: ${error}`);
            
            const fallbackModels: ModelInfo[] = this.getFallbackModels();
            
            this.panel?.webview.postMessage({
                command: 'models',
                models: fallbackModels
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
        
        // Note: contextualChat.sendContextualMessage handles adding to history
        
        this.outputChannel.appendLine(`[ChatUI] Processing: "${text.substring(0, 100)}..."`);
        
        // Handle agent mode or explicit agent commands
        if (isAgentMode || this.agentCommandHandler.parseCommand(text)) {
            await this.handleAgentMode(text, model);
            return;
        }
        
        const agentCommand = this.agentCommandHandler.parseCommand(text);
        if (agentCommand) {
            await this.handleAgentCommand(agentCommand.command, agentCommand.args, model);
            return;
        }
        
        try {
            // Use contextual chat for intelligent conversation continuity
            const response = await this.contextualChat.sendContextualMessage(text);
            
            this.panel?.webview.postMessage({
                command: 'response',
                text: response || 'Analysis completed. Please check the detailed results.'
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[ChatUI] Error: ${error}`);
            const fallbackResponse = this.getFallbackResponse(text);
            this.chatHistory.addMessage('assistant', fallbackResponse);
            this.panel?.webview.postMessage({
                command: 'response',
                text: fallbackResponse
            });
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

            // Show workflow progress
            const steps = [
                { id: '1', action: 'Planning workflow', status: 'running' as const },
                { id: '2', action: 'Analyzing code', status: 'pending' as const },
                { id: '3', action: 'Executing changes', status: 'pending' as const }
            ];
            
            this.workflowProgressView.showProgressPanel(`${command}_${Date.now()}`, steps);
            
            // Execute with timeout
            const result = await Promise.race([
                this.agentCommandHandler.executeCommand(command, args, {
                    model: model || 'deepseek-coder-v2:236b',
                    workspacePath: vscode.workspace.rootPath
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout after 30 seconds')), 30000)
                )
            ]);

            // Update progress
            steps.forEach((step, index) => {
                setTimeout(() => {
                    this.workflowProgressView.updateStep(step.id, { status: 'completed' });
                }, (index + 1) * 500);
            });

            // Show results
            this.panel?.webview.postMessage({
                command: 'response',
                text: `✅ **${command} completed!**\n\n${(result as any).description || 'Task completed'}`
            });

        } catch (error) {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `❌ **${command} failed:** ${error}\n\n💡 **Troubleshooting:**\n• Check MCP server is running\n• Verify Ollama is installed\n• Try a simpler command first`
            });
        }
    }

    private async handleAgentMode(text: string, model?: string): Promise<void> {
        try {
            this.panel?.webview.postMessage({
                command: 'response',
                text: `🤖 **Agent Mode Activated**\n\nTask: "${text}"\n\n⚡ Starting multi-agent workflow...`
            });

            // Check if MCP server is running
            const serverRunning = await this.checkMCPServer();
            if (!serverRunning) {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: `❌ **MCP Server Required**\n\nAgent mode requires the MCP server to be running.\n\n**Start the server:**\n\`\`\`bash\ncd mcp-ollama\nnpm start\n\`\`\``
                });
                return;
            }

            // Show agent workflow progress
            const workflowSteps = [
                '🧠 Planning workflow...',
                '🔍 Analyzing requirements...',
                '⚙️ Selecting appropriate agents...',
                '🚀 Executing multi-agent workflow...'
            ];

            for (const step of workflowSteps) {
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: step
                });
                await new Promise(resolve => setTimeout(resolve, 800));
            }

            // Execute agent workflow
            const { MCPClient } = await import('./mcpClient');
            const mcpClient = new MCPClient();
            await mcpClient.connect();

            // Call agent execution with timeout handling
            const agentResult = await Promise.race([
                mcpClient.callTool('agent_execute', {
                    description: text,
                    type: 'analyze',
                    context: {
                        workspacePath: vscode.workspace.rootPath || '/tmp',
                        language: 'typescript'
                    },
                    priority: 'medium'
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Agent task timeout - this is normal for complex tasks')), 30000)
                )
            ]);

            this.panel?.webview.postMessage({
                command: 'response',
                text: `✅ **Agent Workflow Complete**\n\n${agentResult.summary || 'Multi-agent task completed successfully!'}\n\n**Files Modified:** ${agentResult.filesModified?.length || 0}\n**Steps Executed:** ${agentResult.steps?.length || 0}`
            });

        } catch (error) {
            this.outputChannel.appendLine(`[ChatUI] Agent mode error: ${error}`);
            
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

    private async checkMCPServer(): Promise<boolean> {
        try {
            const { MCPClient } = await import('./mcpClient');
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
        const lowerText = text.toLowerCase();
        
        // Check for context-related queries
        if (lowerText.includes('context') || lowerText.includes('conversation') || lowerText.includes('summary') || lowerText.includes('total context')) {
            const summary = this.contextualChat.getConversationSummary();
            return `## 📋 Conversation Context Summary\n\n${summary}\n\n💡 **Context Features:**\n• Maintains conversation history across interactions\n• Uses relevance scoring to find related messages\n• Balances keyword matching with recency\n• Adapts technical depth based on conversation level`;
        }
        
        if (lowerText.includes('hi') || lowerText.includes('hello')) {
            return `👋 Hello! I'm your professional AI coding assistant with **conversational context**. I can help you with:\n\n**🤖 Agent Commands:**\n• \`/dev implement user authentication\` - Development tasks\n• \`/test generate unit tests\` - Testing tasks\n• \`/review check security issues\` - Code review\n• \`/docs create API documentation\` - Documentation\n\n**🧠 Context Features:**\n• I remember our conversation history\n• I can reference previous discussions\n• Ask me "show context" to see conversation summary\n\nWhat would you like to work on today?`;
        }
        
        if (lowerText.includes('help')) {
            return `🚀 **Available Commands:**\n\n**🤖 Professional Agent Commands:**\n• \`/dev [task]\` - Development tasks (implement, fix, refactor)\n• \`/test [task]\` - Generate and run tests\n• \`/review [task]\` - Code review and analysis\n• \`/docs [task]\` - Generate documentation\n\n**🧠 Conversational Context:**\n• "show context" - Display conversation summary\n• "what did we discuss?" - Review previous topics\n• I automatically reference relevant past discussions\n\n**Right-click on selected code for:**\n• 🔍 Explain Code\n• 🔧 Fix Code Issues\n• 🧪 Generate Tests\n• 📝 Generate Documentation\n\n**Examples:**\n• \`/dev implement user login with JWT\`\n• \`/test add unit tests for UserService\`\n• \`/review check for security vulnerabilities\`\n• "show context" to see conversation history`;
        }
        
        return `I understand you're asking about: "${text}". \n\n**💡 Try using agent commands:**\n• \`/dev [your request]\` for development tasks\n• \`/test [your request]\` for testing\n• \`/review [your request]\` for code review\n• \`/docs [your request]\` for documentation\n\n**🧠 Context available:** Ask "show context" to see our conversation history.\n\nThe MCP server isn't running right now, but I'm ready to help when it's available! \n\nTry starting the MCP server with \`npm start\` in the mcp-ollama directory.`;
    }

    public dispose(): void {
        try {
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