import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { ChatHistory } from './chatHistory';
import { RetryManager } from './retryManager';
import { RateLimiter } from './rateLimiter';

export class CopilotUI {
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;
    private webviewPanel: vscode.WebviewPanel | undefined;
    private mcpClient?: any;
    private disposables: vscode.Disposable[] = [];
    private chatHistory: ChatHistory;
    private rateLimiter: RateLimiter;
    private config = ConfigManager.getConfig();

    constructor(mcpClient?: any, context?: vscode.ExtensionContext) {
        this.mcpClient = mcpClient;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.outputChannel = vscode.window.createOutputChannel('MCP-Ollama Copilot');
        this.chatHistory = new ChatHistory(context!, this.config.chatHistoryLimit);
        this.rateLimiter = new RateLimiter(this.config.rateLimitDelay);
        this.setupStatusBar();
        this.setupConfigWatcher();
    }

    private setupStatusBar() {
        this.statusBarItem.text = "$(robot) MCP-Ollama";
        this.statusBarItem.tooltip = "MCP-Ollama Copilot - Click to open chat";
        this.statusBarItem.command = 'mcp-ollama.openChat';
        this.statusBarItem.show();
    }

    public updateStatus(status: 'ready' | 'working' | 'error', message?: string) {
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

    public showChatPanel() {
        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'mcpOllamaChat',
            'MCP-Ollama Copilot',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        this.webviewPanel.webview.html = this.getChatHTML();
        this.loadChatHistory();
        
        this.disposables.push(
            this.webviewPanel.onDidDispose(() => {
                this.webviewPanel = undefined;
            })
        );

        this.disposables.push(
            this.webviewPanel.webview.onDidReceiveMessage(
                message => this.handleWebviewMessage(message),
                undefined
            )
        );
    }

    private getChatHTML(): string {
        return `<!DOCTYPE html>
<html><head><title>MCP-Ollama</title>
<style>
body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 20px; }
.messages { height: 400px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); padding: 10px; margin-bottom: 10px; }
.message { margin-bottom: 10px; padding: 8px; border-radius: 4px; }
.message.user { background: var(--vscode-inputOption-activeBackground); margin-left: 20px; }
.message.assistant { background: var(--vscode-editor-inactiveSelectionBackground); margin-right: 20px; }
.input-wrapper { display: flex; gap: 8px; }
.input-box { flex: 1; padding: 8px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); }
.send-button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
.send-button:disabled { opacity: 0.5; }
</style>
</head>
<body>
<div class="messages" id="messages">
<div class="message assistant">Hello! I'm your AI coding assistant. How can I help you today?</div>
</div>
<div class="input-wrapper">
<input class="input-box" id="messageInput" placeholder="Ask me anything..." />
<button class="send-button" id="sendButton" onclick="sendMessage()" disabled>Send</button>
</div>
<script>
const vscode = acquireVsCodeApi();
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;
    addMessage('user', message);
    input.value = '';
    updateSendButton();
    vscode.postMessage({command: 'sendMessage', text: message});
}
function addMessage(sender, text) {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message ' + sender;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}
function updateSendButton() {
    const input = document.getElementById('messageInput');
    const button = document.getElementById('sendButton');
    button.disabled = !input.value.trim();
}
document.getElementById('messageInput').addEventListener('input', updateSendButton);
document.getElementById('messageInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
});
window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'response') {
        addMessage('assistant', message.text || 'No response');
    }
});
</script>
</body></html>`;
    }

    private setupConfigWatcher(): void {
        this.disposables.push(
            ConfigManager.onConfigChange(() => {
                this.config = ConfigManager.getConfig();
                this.rateLimiter = new RateLimiter(this.config.rateLimitDelay);
            })
        );
    }

    private loadChatHistory(): void {
        const history = this.chatHistory.getRecentMessages(20);
        this.webviewPanel?.webview.postMessage({
            command: 'loadHistory',
            history
        });
    }

    private async handleWebviewMessage(message: any): Promise<void> {
        try {
            switch (message.command) {
                case 'sendMessage':
                    await this.handleSendMessage(message.text);
                    break;
                case 'saveMessage':
                    this.chatHistory.addMessage(message.sender, message.text);
                    break;
                case 'clearHistory':
                    this.chatHistory.clearHistory();
                    break;
                case 'exportHistory':
                    await this.handleExportHistory();
                    break;
                case 'requestHistory':
                    this.loadChatHistory();
                    break;
                case 'showSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'mcp-ollama');
                    break;
            }
        } catch (error) {
            console.error('Error handling webview message:', error);
        }
    }

    private async handleSendMessage(text: string): Promise<void> {
        this.updateStatus('working', 'Processing message...');
        
        try {
            const response = await this.rateLimiter.throttle(async () => {
                return await RetryManager.withRetry(
                    () => this.processMessage(text),
                    this.config.maxRetries,
                    this.config.retryDelay
                );
            });
            
            this.chatHistory.addMessage('user', text);
            this.chatHistory.addMessage('assistant', response);
            
            this.webviewPanel?.webview.postMessage({
                command: 'response',
                text: response
            });
            
            this.updateStatus('ready');
        } catch (error) {
            this.webviewPanel?.webview.postMessage({
                command: 'error',
                text: error instanceof Error ? error.message : 'Unknown error'
            });
            
            this.updateStatus('error', 'Failed to process message');
        }
    }

    private async processMessage(text: string): Promise<string> {
        if (!this.mcpClient) {
            throw new Error('MCP client not available');
        }
        
        return 'Message processed successfully';
    }

    private async handleExportHistory(): Promise<void> {
        try {
            const history = this.chatHistory.exportHistory();
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('chat-history.json'),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });
            
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(history, 'utf8'));
                vscode.window.showInformationMessage('Chat history exported successfully!');
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to export chat history');
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.webviewPanel?.dispose();
    }
}