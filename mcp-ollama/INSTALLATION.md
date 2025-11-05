# MCP-Ollama Installation Guide

## Quick Start for Users

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd mcp-ollama
```

### 2. Install VSCode Extension
```bash
cd vscode-extension
code --install-extension smartcode-aiassist-3.10.2.vsix
```

### 3. Configure Extension
The extension is pre-configured to use our hosted Docker server at:
- **Server URL**: `http://10.10.110.22:15267`
- **All 12 MCP tools** are available instantly

### 4. Start Using
1. Open any code file in VSCode
2. Press `Ctrl+Shift+M` to open AI Chat
3. Use commands like:
   - `/dev` - Development assistance
   - `/test` - Generate tests
   - `/review` - Code review
   - `/docs` - Generate documentation

## Available Features

✅ **12 AI Tools Ready to Use:**
1. Code Completion (`Ctrl+Space`)
2. Code Analysis (Right-click → Analyze)
3. Text Generation
4. Code Generation
5. Code Explanation
6. Error Fixing
7. Quick Fixes
8. Code Validation
9. Named Entity Recognition
10. Health Monitoring
11. Model Management
12. Memory Management

## API Endpoints

All tools are accessible via REST API at `http://10.10.110.22:15267`:

```bash
# Health Check
curl http://10.10.110.22:15267/health

# Generate Code
curl -X POST http://10.10.110.22:15267/generate-code \
  -H "Content-Type: application/json" \
  -d '{"description": "Create a REST API", "language": "python"}'

# Code Analysis
curl -X POST http://10.10.110.22:15267/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "your code here", "language": "javascript"}'
```

## For Developers

### Run Your Own Docker Server
```bash
# Build and run locally
docker build -t mcp-ollama .
docker run -p 8080:8080 mcp-ollama

# Or use docker-compose
docker-compose up --build
```

### Environment Variables
Copy `.env.example` to `.env` and modify:
```bash
MCP_SERVER_URL=http://your-server:port
OLLAMA_HOST=http://your-ollama:11434
```

## Troubleshooting

1. **Extension not working?**
   - Check VSCode settings for "mcp-ollama.serverUrl"
   - Ensure it's set to `http://10.10.110.22:15267`

2. **Server not responding?**
   - Test with: `curl http://10.10.110.22:15267/health`
   - Check network connectivity

3. **Need local server?**
   - Follow "Run Your Own Docker Server" section above

## Support

- 🐛 Issues: Create GitHub issue
- 📖 Docs: See README.md
- 💬 Chat: Use the extension's built-in AI chat