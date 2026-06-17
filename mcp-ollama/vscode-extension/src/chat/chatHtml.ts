export interface ChatVendorUris {
    /** highlight.js github-dark theme stylesheet */
    hlCss: string;
    /** highlight.js library */
    hljs: string;
    /** marked markdown parser */
    marked: string;
}

export function getChatHtml(
    timestamp: number,
    cssUri: string,
    jsUri: string,
    cspSource: string,
    vendor: ChatVendorUris
): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; img-src ${cspSource} https: data:;">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <title>SmartCode AI v${timestamp}</title>
    <link rel="stylesheet" href="${vendor.hlCss}">
    <script src="${vendor.hljs}"></script>
    <script src="${vendor.marked}"></script>
    <link rel="stylesheet" href="${cssUri}">
</head>
<body>
    <!-- Header -->
    <div class="header">
        <div class="logo">
            <span>✦</span>
            <span>SmartCode AI</span>
        </div>
        <div class="status">
            <div class="status-dot"></div>
            <span>Ready</span>
        </div>
        <div class="actions">
            <button class="btn" id="newChatBtn" title="New chat">
                <span>+ New</span>
            </button>
            <button class="btn" id="historyBtn" title="Chat history">
                <span>History</span>
            </button>
            <button class="btn" id="apiSettingsBtn" title="Cloud API Settings">
                <span>API Key</span>
            </button>
            <button class="btn" id="clearBtn" title="Clear conversation">
                <span>Clear</span>
            </button>
        </div>
    </div>

    <!-- Chat history drawer -->
    <div class="history-drawer" id="historyDrawer">
        <div class="history-drawer-header">
            <span>Chat history</span>
            <button class="history-close" id="historyCloseBtn" title="Close">&times;</button>
        </div>
        <div class="history-list" id="historyList"></div>
    </div>

    <!-- Chat body -->
    <div class="chat-container">
        <div class="messages" id="messages">
            <!-- Welcome screen -->
            <div class="welcome">
                <div class="welcome-icon">✦</div>
                <h2>How can I help?</h2>
                <p class="welcome-sub">Ask anything about your code, or pick a quick action below.</p>
                <div class="quick-actions">
                    <button class="quick-chip" data-cmd="Explain this code">Explain code</button>
                    <button class="quick-chip" data-cmd="Review this code for issues">Review code</button>
                    <button class="quick-chip" data-cmd="Generate unit tests">Generate tests</button>
                    <button class="quick-chip" data-cmd="Fix any bugs or issues">Fix bugs</button>
                    <button class="quick-chip" data-cmd="Optimize this code">Optimize</button>
                </div>
            </div>
        </div>

        <!-- Input area -->
        <div class="input-container">
            <!-- Agent mode banner -->
            <div class="agent-status-bar" id="agentStatusBar">
                <span class="agent-badge">AGENT</span>
                <span>Agent mode — will plan and execute tasks automatically</span>
            </div>

            <!-- File mention suggestions -->
            <div class="mention-suggestions" id="mentionSuggestions"></div>

            <!-- Attachment chips -->
            <div class="attachment-chips" id="attachmentChips" style="display:none;"></div>

            <!-- Input row -->
            <div class="input-wrapper" id="inputWrapper">
                <button class="attach-input-btn" id="attachInputBtn" title="Attach files">📎</button>
                <textarea
                    class="message-input"
                    id="messageInput"
                    placeholder="Ask me anything…"
                    rows="1"
                ></textarea>
                <select id="modelSelect" class="model-dropdown-input">
                    <option value="loading">Loading…</option>
                </select>
                <button class="agent-toggle" id="agentToggle" title="Toggle Agent Mode">
                    <span id="agentIcon">⚡</span>
                </button>
                <button class="send-btn" id="sendBtn">Send</button>
            </div>
        </div>
    </div>

    <!-- API Settings Modal -->
    <div class="modal" id="apiModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Cloud API Configuration</h3>
                <button class="close-modal" id="closeModalBtn">&times;</button>
            </div>
            <div class="modal-body">
                <p class="modal-desc">Configure an OpenAI-compatible cloud provider (e.g., DeepSeek, Groq, OpenRouter, OpenAI, Hugging Face) to run models in the cloud.</p>
                <div class="form-group">
                    <label for="apiUrlInput">API Base URL</label>
                    <input type="text" id="apiUrlInput" placeholder="https://api.openai.com/v1" value="https://api.openai.com/v1">
                    <span class="input-hint">The base URL of the OpenAI-compatible endpoint.</span>
                </div>
                <div class="form-group">
                    <label for="apiKeyInput">API Key</label>
                    <input type="password" id="apiKeyInput" placeholder="Paste your API key here">
                    <span class="input-hint">Stored securely using VS Code's native secrets store.</span>
                </div>
                <div class="form-group">
                    <label for="apiModelInput">Model Name</label>
                    <input type="text" id="apiModelInput" placeholder="gpt-4o" value="gpt-4o">
                    <span class="input-hint">The model identifier (e.g., gpt-4o, deepseek-chat).</span>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="cancelModalBtn">Cancel</button>
                <button class="btn btn-primary" id="saveModalBtn">Save Settings</button>
            </div>
        </div>
    </div>

    <script src="${jsUri}"></script>
</body>
</html>`;
}
