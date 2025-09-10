"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotUI = void 0;
const vscode = require("vscode");
class CopilotUI {
    constructor(mcpClient) {
        this.disposables = [];
        this.mcpClient = mcpClient;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.outputChannel = vscode.window.createOutputChannel('MCP-Ollama Copilot');
        this.setupStatusBar();
    }
    setupStatusBar() {
        this.statusBarItem.text = "$(robot) MCP-Ollama";
        this.statusBarItem.tooltip = "MCP-Ollama Copilot - Click to open chat";
        this.statusBarItem.command = 'mcp-ollama.openChat';
        this.statusBarItem.show();
    }
    updateStatus(status, message) {
        switch (status) {
            case 'ready':
                this.statusBarItem.text = "$(robot) MCP-Ollama";
                this.statusBarItem.color = undefined;
                break;
            case 'working':
                this.statusBarItem.text = "$(loading~spin) MCP-Ollama";
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
                break;
            case 'error':
                this.statusBarItem.text = "$(error) MCP-Ollama";
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
                break;
        }
        if (message) {
            this.statusBarItem.tooltip = message;
        }
    }
    showChatPanel() {
        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            return;
        }
        this.webviewPanel = vscode.window.createWebviewPanel('mcpOllamaChat', 'MCP-Ollama Copilot', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
        });
        this.webviewPanel.webview.html = this.getChatHTML();
        // Store disposables for proper cleanup
        this.disposables.push(this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined;
        }));
        // Handle messages from webview
        this.disposables.push(this.webviewPanel.webview.onDidReceiveMessage(message => this.handleWebviewMessage(message), undefined));
    }
    getChatHTML() {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>MCP-Ollama Copilot</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    margin: 0;
                    padding: 20px;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                }
                
                .header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .logo {
                    font-size: 24px;
                    margin-right: 10px;
                }
                
                .title {
                    font-size: 18px;
                    font-weight: bold;
                }
                
                .chat-container {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    min-height: 0;
                }
                
                .messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    margin-bottom: 10px;
                    min-height: 200px;
                }
                
                .message {
                    margin-bottom: 15px;
                    padding: 10px;
                    border-radius: 8px;
                    word-wrap: break-word;
                }
                
                .message.user {
                    background-color: var(--vscode-inputOption-activeBackground);
                    margin-left: 20px;
                }
                
                .message.assistant {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    margin-right: 20px;
                }
                
                .message-header {
                    font-weight: bold;
                    margin-bottom: 5px;
                    font-size: 12px;
                    opacity: 0.8;
                }
                
                .input-container {
                    display: flex;
                    gap: 10px;
                }
                
                .input-box {
                    flex: 1;
                    padding: 10px;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    color: var(--vscode-input-foreground);
                    font-family: inherit;
                    resize: vertical;
                    min-height: 40px;
                    outline: none;
                }
                
                .input-box:focus {
                    border-color: var(--vscode-focusBorder);
                }
                
                .send-button {
                    padding: 10px 20px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-family: inherit;
                    min-width: 80px;
                }
                
                .send-button:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .send-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .quick-actions {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 10px;
                    flex-wrap: wrap;
                }
                
                .quick-action {
                    padding: 5px 10px;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                
                .quick-action:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .code-block {
                    background-color: var(--vscode-textCodeBlock-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    overflow-x: auto;
                    white-space: pre-wrap;
                }
                
                .error-message {
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                }
                
                .loading {
                    opacity: 0.6;
                    pointer-events: none;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">🤖</div>
                <div class="title">MCP-Ollama Copilot</div>
            </div>
            
            <div class="chat-container">
                <div class="messages" id="messages">
                    <div class="message assistant">
                        <div class="message-header">MCP-Ollama Assistant</div>
                        <div>Hello! I'm your AI coding assistant. I can help you with:</div>
                        <ul>
                            <li>Code completion and suggestions</li>
                            <li>Code explanation and analysis</li>
                            <li>Bug fixes and error resolution</li>
                            <li>Code generation from descriptions</li>
                            <li>Documentation and tests</li>
                        </ul>
                        <div>Try typing <code>/explain</code>, <code>/fix</code>, <code>/tests</code>, or <code>/docs</code> followed by your request!</div>
                    </div>
                </div>
                
                <div class="quick-actions">
                    <button class="quick-action" onclick="insertCommand('/explain ')">📖 Explain Code</button>
                    <button class="quick-action" onclick="insertCommand('/fix ')">🔧 Fix Error</button>
                    <button class="quick-action" onclick="insertCommand('/tests ')">🧪 Generate Tests</button>
                    <button class="quick-action" onclick="insertCommand('/docs ')">📝 Write Docs</button>
                    <button class="quick-action" onclick="insertCommand('/optimize ')">⚡ Optimize</button>
                </div>
                
                <div class="input-container">
                    <textarea class="input-box" id="messageInput" placeholder="Ask me anything about your code..." rows="2"></textarea>
                    <button class="send-button" id="sendButton" onclick="sendMessage()">Send</button>
                </div>
            </div>
            
            <script>
                (function() {
                    'use strict';
                    
                    const vscode = acquireVsCodeApi();
                    
                    function insertCommand(command) {
                        const input = document.getElementById('messageInput');
                        if (input) {
                            input.value = command;
                            input.focus();
                        }
                    }
                    
                    function sendMessage() {
                        const input = document.getElementById('messageInput');
                        const sendButton = document.getElementById('sendButton');
                        
                        if (!input || !sendButton) {
                            console.error('Required elements not found');
                            return;
                        }
                        
                        const message = input.value.trim();
                        
                        if (!message) return;
                        
                        addMessage('user', message);
                        input.value = '';
                        
                        sendButton.disabled = true;
                        sendButton.textContent = 'Thinking...';
                        
                        // Add loading state to UI
                        document.body.classList.add('loading');
                        
                        try {
                            vscode.postMessage({
                                command: 'sendMessage',
                                text: message
                            });
                        } catch (error) {
                            console.error('Failed to send message:', error);
                            addMessage('assistant', 'Error: Failed to send message to extension');
                            resetSendButton();
                        }
                    }
                    
                    function resetSendButton() {
                        const sendButton = document.getElementById('sendButton');
                        if (sendButton) {
                            sendButton.disabled = false;
                            sendButton.textContent = 'Send';
                        }
                        document.body.classList.remove('loading');
                    }
                    
                    function addMessage(sender, text) {
                        const messages = document.getElementById('messages');
                        if (!messages) {
                            console.error('Messages container not found');
                            return;
                        }
                        
                        const messageDiv = document.createElement('div');
                        messageDiv.className = \`message \${sender}\`;
                        
                        const header = document.createElement('div');
                        header.className = 'message-header';
                        header.textContent = sender === 'user' ? 'You' : 'MCP-Ollama Assistant';
                        
                        const content = document.createElement('div');
                        content.innerHTML = formatMessage(text);
                        
                        messageDiv.appendChild(header);
                        messageDiv.appendChild(content);
                        messages.appendChild(messageDiv);
                        
                        // Scroll to bottom
                        messages.scrollTop = messages.scrollHeight;
                    }
                    
                    function formatMessage(text) {
                        if (typeof text !== 'string') {
                            text = String(text);
                        }
                        
                        // Basic markdown-like formatting with better escaping
                        return text
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<div class="code-block">$1</div>')
                            .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                            .replace(/\\n/g, '<br>');
                    }
                    
                    // Handle Enter key
                    const messageInput = document.getElementById('messageInput');
                    if (messageInput) {
                        messageInput.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        });
                    }
                    
                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        try {
                            const message = event.data;
                            
                            if (!message || typeof message !== 'object') {
                                console.warn('Invalid message format received:', message);
                                return;
                            }
                            
                            switch (message.command) {
                                case 'response':
                                    if (message.text !== undefined) {
                                        addMessage('assistant', message.text);
                                    } else {
                                        addMessage('assistant', 'Error: Empty response received');
                                    }
                                    resetSendButton();
                                    break;
                                case 'error':
                                    const errorText = message.text || 'Unknown error occurred';
                                    addMessage('assistant', \`<div class="error-message">Error: \${errorText}</div>\`);
                                    resetSendButton();
                                    break;
                                default:
                                    console.warn('Unknown message command:', message.command);
                            }
                        } catch (error) {
                            console.error('Error handling message from extension:', error);
                            addMessage('assistant', 'Error: Failed to process response');
                            resetSendButton();
                        }
                    });
                    
                    // Make functions globally available
                    window.insertCommand = insertCommand;
                    window.sendMessage = sendMessage;
                })();
            </script>
        </body>
        </html>`;
    }
    async handleWebviewMessage(message) {
        if (!message || typeof message !== 'object') {
            this.sendErrorToWebview('Invalid message format');
            return;
        }
        switch (message.command) {
            case 'sendMessage':
                try {
                    if (typeof message.text !== 'string') {
                        this.sendErrorToWebview('Invalid message text');
                        return;
                    }
                    this.updateStatus('working', 'Processing message...');
                    const response = await this.processMessage(message.text);
                    this.webviewPanel?.webview.postMessage({
                        command: 'response',
                        text: response
                    });
                    this.updateStatus('ready');
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                    this.outputChannel.appendLine(`Error processing message: ${errorMessage}`);
                    this.sendErrorToWebview(errorMessage);
                    this.updateStatus('error', 'Error processing message');
                }
                break;
            default:
                this.sendErrorToWebview(`Unknown command: ${message.command}`);
        }
    }
    sendErrorToWebview(errorMessage) {
        this.webviewPanel?.webview.postMessage({
            command: 'error',
            text: errorMessage
        });
    }
    async processMessage(text) {
        if (!text || typeof text !== 'string') {
            throw new Error('Invalid input text');
        }
        if (!this.mcpClient) {
            throw new Error('MCP client not available. Please check your configuration.');
        }
        try {
            const editor = vscode.window.activeTextEditor;
            let context = '';
            let language = 'text';
            if (editor) {
                const selection = editor.selection;
                if (selection.isEmpty) {
                    // Get entire document if no selection
                    context = editor.document.getText();
                }
                else {
                    // Get selected text
                    context = editor.document.getText(selection);
                }
                language = editor.document.languageId;
            }
            let result;
            if (text.startsWith('/')) {
                // Handle slash commands
                result = await this.mcpClient.handleSlashCommand(text, context, language);
            }
            else {
                // Handle regular chat
                result = await this.mcpClient.handleSlashCommand('chat', text, language);
            }
            return result || 'No response received from MCP client';
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.outputChannel.appendLine(`Error in processMessage: ${errorMessage}`);
            throw new Error(`Failed to process message: ${errorMessage}`);
        }
    }
    showInlineCompletion(completion, position) {
        // Show ghost text completion like GitHub Copilot
        // This would be implemented with VS Code's inline completion API
        // For now, just log the completion
        this.outputChannel.appendLine(`Inline completion at ${position.line}:${position.character}: ${completion}`);
    }
    logMessage(message) {
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
    showOutput() {
        this.outputChannel.show();
    }
    dispose() {
        try {
            // Dispose all stored disposables
            this.disposables.forEach(disposable => {
                try {
                    disposable.dispose();
                }
                catch (error) {
                    console.error('Error disposing disposable:', error);
                }
            });
            this.disposables = [];
            // Dispose main resources
            this.statusBarItem.dispose();
            this.outputChannel.dispose();
            this.webviewPanel?.dispose();
            this.webviewPanel = undefined;
        }
        catch (error) {
            console.error('Error during CopilotUI disposal:', error);
        }
    }
}
exports.CopilotUI = CopilotUI;
//# sourceMappingURL=copilotUI.js.map