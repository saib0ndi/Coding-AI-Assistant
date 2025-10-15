# 🚀 MCP-Ollama Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Check Prerequisites
```bash
node --version    # Should be 18+
ollama --version  # Should be installed
code --version    # VSCode installed
```

### 2. Start Services
```bash
# Start Ollama (if not running)
ollama serve

# Pull AI model
ollama pull deepseek-coder-v2:236b

# Start MCP server
cd /home/sb57213v/Coding-AI-Assistant/mcp-ollama
npm start
```

### 3. Install VSCode Extension
```bash
cd vscode-extension
code --install-extension smartcode-aiassist-3.1.1.vsix --force
```

### 4. Configure VSCode
Open VSCode Settings (Ctrl+,) and set:
```json
{
  "mcp-ollama.enabled": true,
  "mcp-ollama.host": "http://10.10.110.25:11434",
  "mcp-ollama.serverUrl": "http://localhost:3077"
}
```

### 5. Test It Works
1. Open any code file in VSCode
2. Press `Ctrl+Shift+M` to open AI chat
3. Type: "Explain this code" and select some code
4. You should get an AI response!

## 🎯 Key Features

### Agent Commands
- `/dev` - Development workflow
- `/test` - Generate tests  
- `/review` - Code review
- `/docs` - Documentation

### Keyboard Shortcuts
- `Ctrl+Shift+M` - Open AI Chat
- `Ctrl+Shift+E` - Explain selected code
- `Tab` - Accept AI suggestions

### Current Capacity
- **Single Server**: 35 concurrent users
- **Available Infrastructure**: Can scale to 175 users
- **Response Time**: 15-32 seconds average

## 🔧 Quick Commands

```bash
# Check status
./check-status.sh

# Test capacity
node test-available-servers.js

# Restart server
./restart-server.sh

# View logs
tail -f server.log
```

## ✅ You're Ready!
Your MCP-Ollama server is now running and ready to assist with AI-powered coding!