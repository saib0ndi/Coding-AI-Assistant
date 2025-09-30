import * as vscode from 'vscode';

export class ChatUI {
    private panel: vscode.WebviewPanel | undefined;
    private outputChannel: vscode.OutputChannel;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('SmartCode-AIAssist');
        this.outputChannel.appendLine('ChatUI initialized');
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

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
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
                <h2>🎯 Ready to Code!</h2>
                <p>I'm your AI coding assistant powered by MCP-Ollama.</p>
                <p>Ask me anything about your code, attach files, or get help with development tasks!</p>
            </div>
        </div>
        
        <div class="input-container">
            <div class="input-wrapper">
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
            
            if (isUser) {
                content.textContent = text;
            } else {
                // Parse markdown and render
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
            }
            
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
        
        document.getElementById('sendBtn').onclick = () => {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            if (message) {
                addMessage(message, true);
                vscode.postMessage({ command: 'sendMessage', text: message, model: selectedModel });
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
        this.panel?.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'attachFiles':
                    await this.handleAttachFiles();
                    break;
                case 'sendMessage':
                    await this.handleSendMessage(message.text, message.model);
                    break;
                case 'getModels':
                    await this.handleGetModels();
                    break;
                case 'modelChanged':
                    // Store selected model for future use
                    break;
            }
        });
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

    private async handleGetModels() {
        try {
            const { MCPClient } = await import('./mcpClient');
            const mcpClient = new MCPClient();
            
            // Make HTTP request to Ollama API to get all 37 models
            const response = await mcpClient.makeOllamaRequest('/api/tags');
            const data = JSON.parse(response.body);
            
            const models = data.models.map((model: any) => ({
                name: model.name,
                displayName: this.formatModelName(model.name),
                size: this.formatSize(model.size)
            }));
            
            this.panel?.webview.postMessage({
                command: 'models',
                models: models
            });
        } catch (error) {
            // Fallback models if Ollama is not available
            const fallbackModels = [
                { name: 'deepseek-coder-v2:236b', displayName: 'DeepSeek Coder V2', size: '236B' },
                { name: 'llama3.3:70b', displayName: 'Llama 3.3', size: '70B' },
                { name: 'phi4:latest', displayName: 'Phi-4', size: '14B' },
                { name: 'qwen3:32b', displayName: 'Qwen 3', size: '32B' },
                { name: 'llama3.1:8b', displayName: 'Llama 3.1', size: '8B' },
                { name: 'gemma3:27b', displayName: 'Gemma 3', size: '27B' },
                { name: 'veda-coder-v2:latest', displayName: 'Veda Coder V2', size: '236B' }
            ];
            
            this.panel?.webview.postMessage({
                command: 'models',
                models: fallbackModels
            });
        }
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

    private async handleSendMessage(text: string, model?: string) {
        this.outputChannel.appendLine(`[ChatUI] Handling message: "${text}" with model: ${model || 'default'}`);
        
        try {
            const { MCPClient } = await import('./mcpClient');
            const mcpClient = new MCPClient();

            try {
                this.outputChannel.appendLine('[ChatUI] Connecting to MCP server...');
                await mcpClient.connect();
                this.outputChannel.appendLine('[ChatUI] Connected to MCP server successfully');
                
                // Use selected model or default
                const selectedModel = model || 'deepseek-coder-v2:236b';
                this.outputChannel.appendLine(`[ChatUI] Using model: ${selectedModel}`);
                
                // Check if it's a code-related query or general chat
                const isCodeQuery = this.isCodeRelated(text);
                this.outputChannel.appendLine(`[ChatUI] Query type: ${isCodeQuery ? 'code' : 'chat'}`);
                
                let response: string;
                
                if (isCodeQuery) {
                    this.outputChannel.appendLine('[ChatUI] Calling explainCodeWithModel...');
                    response = await mcpClient.explainCodeWithModel(text, 'general', selectedModel);
                } else {
                    this.outputChannel.appendLine('[ChatUI] Calling handleSlashCommandWithModel...');
                    response = await mcpClient.handleSlashCommandWithModel('/chat', text, 'general', selectedModel);
                }

                this.outputChannel.appendLine(`[ChatUI] Received response: ${response.substring(0, 100)}...`);
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: response
                });
            } catch (mcpError) {
                this.outputChannel.appendLine(`[ChatUI] MCP Error: ${mcpError}`);
                // Provide helpful fallback responses
                const fallbackResponse = this.getFallbackResponse(text);
                this.panel?.webview.postMessage({
                    command: 'response',
                    text: fallbackResponse
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`[ChatUI] General Error: ${error}`);
            this.panel?.webview.postMessage({
                command: 'response',
                text: `❌ Error: ${error}`
            });
        }
    }
    
    private isCodeRelated(text: string): boolean {
        const codeKeywords = [
            'function', 'class', 'const', 'let', 'var', 'if', 'for', 'while',
            'import', 'export', 'return', 'console.log', 'print', 'def',
            'public', 'private', 'static', 'async', 'await', '{', '}', '()', '=>',
            'explain this code', 'what does this do', 'how does this work'
        ];
        
        const lowerText = text.toLowerCase();
        return codeKeywords.some(keyword => lowerText.includes(keyword)) || 
               /[{}();\[\]<>]/.test(text) || // Contains code symbols
               text.split('\n').length > 2; // Multi-line (likely code)
    }
    
    private getFallbackResponse(text: string): string {
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('hi') || lowerText.includes('hello')) {
            return `👋 Hello! I'm your AI coding assistant powered by MCP-Ollama. I can help you with:\n\n• **Code explanation** - Paste any code and I'll explain it\n• **Bug fixing** - Right-click code → "Fix Code Issues"\n• **Generate tests** - Right-click code → "Generate Tests"\n• **Documentation** - Right-click code → "Generate Documentation"\n• **Code review** - Right-click code → "Code Review"\n\nWhat would you like to work on today?`;
        }
        
        if (lowerText.includes('help')) {
            return `🚀 **Available Commands:**\n\n**Right-click on selected code for:**\n• 🔍 Explain Code\n• 🔧 Fix Code Issues\n• 🧪 Generate Tests\n• 📝 Generate Documentation\n• ⚡ Optimize Performance\n• 🔒 Security Scan\n• 👀 Code Review\n• 🔄 Translate Language\n\n**Or just chat with me about coding questions!**`;
        }
        
        return `I understand you're asking about: "${text}". \n\nThe MCP server isn't running right now, but I'm ready to help when it's available! \n\nIn the meantime, you can:\n• Right-click on code for instant tools\n• Attach files using the 📎 button\n• Ask me coding questions\n\nTry starting the MCP server with \`npm start\` in the mcp-ollama directory.`;
    }

    public dispose() {
        this.panel?.dispose();
        this.panel = undefined;
    }
}