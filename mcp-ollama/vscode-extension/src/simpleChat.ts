import * as vscode from 'vscode';

export function createSimpleChat() {
    const panel = vscode.window.createWebviewPanel(
        'mcpChat',
        'MCP-Ollama Chat',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>MCP-Ollama Chat</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1e1e1e;
            color: #ffffff;
            margin: 0;
            padding: 20px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .logo {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 8px;
        }
        
        .status {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
            padding: 6px 12px;
            border-radius: 16px;
            font-size: 12px;
            display: inline-block;
        }
        
        .messages {
            flex: 1;
            background: #2d2d2d;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            overflow-y: auto;
        }
        
        .welcome {
            text-align: center;
            color: #888;
        }
        
        .welcome h2 {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 16px;
        }
        
        .input-area {
            display: flex;
            gap: 12px;
            background: #2d2d2d;
            padding: 16px;
            border-radius: 12px;
        }
        
        .input {
            flex: 1;
            background: #1e1e1e;
            border: 1px solid #444;
            color: white;
            padding: 12px;
            border-radius: 8px;
            font-size: 14px;
        }
        
        .send-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        }
        
        .send-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        .message {
            margin: 12px 0;
            padding: 12px;
            border-radius: 8px;
            animation: slideIn 0.3s ease;
        }
        
        .user {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin-left: 20%;
        }
        
        .assistant {
            background: #333;
            margin-right: 20%;
        }
        
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🚀 MCP-Ollama Copilot</div>
        <div class="status">🟢 Ready</div>
    </div>
    
    <div class="messages" id="messages">
        <div class="welcome">
            <h2>🎯 Ready to Code!</h2>
            <p>I'm your AI coding assistant. Ask me anything about your code!</p>
        </div>
    </div>
    
    <div class="input-area">
        <input class="input" id="input" placeholder="Ask me anything about your code..." />
        <button class="send-btn" id="send">Send ➤</button>
    </div>
    
    <script>
        const input = document.getElementById('input');
        const send = document.getElementById('send');
        const messages = document.getElementById('messages');
        
        function addMessage(text, isUser) {
            const welcome = messages.querySelector('.welcome');
            if (welcome) welcome.remove();
            
            const msg = document.createElement('div');
            msg.className = 'message ' + (isUser ? 'user' : 'assistant');
            msg.textContent = text;
            messages.appendChild(msg);
            messages.scrollTop = messages.scrollHeight;
        }
        
        function sendMessage() {
            const text = input.value.trim();
            if (!text) return;
            
            addMessage(text, true);
            input.value = '';
            
            // Echo response
            setTimeout(() => {
                addMessage('Echo: ' + text + ' (This is a working demo!)', false);
            }, 1000);
        }
        
        send.onclick = sendMessage;
        input.onkeypress = (e) => {
            if (e.key === 'Enter') sendMessage();
        };
    </script>
</body>
</html>`;
}