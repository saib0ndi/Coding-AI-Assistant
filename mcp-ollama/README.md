# MCP-Ollama AI Assistant

A complete AI-powered coding assistant that integrates Ollama models with VS Code through the Model Context Protocol (MCP). Features GitHub Copilot-like functionality with local AI models.

## 🚀 Features

### Core Capabilities
- **Real-time Code Completion** - Intelligent suggestions as you type
- **Auto Error Fixing** - Automatically detect and fix code errors
- **Code Explanation** - Detailed explanations of code functionality
- **Code Generation** - Generate code from natural language descriptions
- **Inline Suggestions** - Ghost text completions like GitHub Copilot
- **Chat Assistant** - Interactive coding help in sidebar

### Advanced Features
- **Multi-Model Support** - Switch between different Ollama models
- **Context-Aware Suggestions** - Uses workspace and file context
- **Streaming Responses** - Real-time streaming for better UX
- **Slash Commands** - `/fix`, `/explain`, `/tests`, `/docs`, `/optimize`
- **Security Scanning** - Detect security vulnerabilities
- **Performance Optimization** - Suggest performance improvements
- **Code Translation** - Convert between programming languages
- **Test Generation** - Automatically generate unit tests
- **Documentation Generation** - Create comprehensive docs

### Enterprise Features
- **Team Collaboration** - Shared settings and policies
- **Usage Analytics** - Track adoption and performance
- **Privacy-First** - All processing happens locally
- **Offline Support** - Works without internet connection

## 📋 Requirements

- **Node.js** 16+ 
- **VS Code** 1.74+
- **Ollama** with models installed
- **Git** (for installation)

## 🛠️ Installation

### Quick Install
```bash
git clone <repository-url>
cd mcp-ollama
chmod +x install.sh
./install.sh
```

### HTTPS Setup (Recommended)
```bash
# Generate SSL certificates
./generate-certs.sh

# Set environment variables
export USE_HTTPS=true
export SSL_CERT_PATH=./certs/cert.pem
export SSL_KEY_PATH=./certs/key.pem
```

### Manual Installation

1. **Install Dependencies**
```bash
cd mcp-ollama
npm install
npm run build
```

2. **Build Extension**
```bash
cd vscode-extension
npm install
npm run compile
npx vsce package
```

3. **Install Extension**
```bash
code --install-extension smartcode-aiassist-1.0.2.vsix
```

## 🚀 Usage

### 1. Start the Server
```bash
cd mcp-ollama
npm start
```
Server runs on `http://localhost:3077`

### 2. Configure VS Code
Open VS Code settings and configure:
```json
{
  "mcp-ollama.enabled": true,
  "mcp-ollama.serverUrl": "http://localhost:3077",
  "mcp-ollama.host": "http://localhost:11434",
  "mcp-ollama.model": "deepseek-coder-v2:236b"
}
```

### 3. Available Commands

#### Keyboard Shortcuts
- `Alt + ]` - Next suggestion
- `Alt + [` - Previous suggestion  
- `Ctrl + Enter` - Show alternatives
- `Tab` - Accept suggestion

#### Command Palette
- `SmartCode-AIAssist: Enable/Disable`
- `SmartCode-AIAssist: Explain Code`
- `SmartCode-AIAssist: Fix Code`
- `SmartCode-AIAssist: Generate Tests`
- `SmartCode-AIAssist: Generate Documentation`
- `SmartCode-AIAssist: Open Chat`

#### Slash Commands (in Chat)
- `/fix` - Fix code issues
- `/explain` - Explain selected code
- `/tests` - Generate unit tests
- `/docs` - Generate documentation
- `/optimize` - Optimize performance
- `/security` - Security scan
- `/translate [language]` - Translate code

## 🔧 Configuration

### Server Configuration (.env)
```bash
OLLAMA_HOST=https://localhost:11434
OLLAMA_MODEL=deepseek-coder-v2:236b
OLLAMA_TIMEOUT_MS=120000
USE_HTTPS=true
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
```

### VS Code Settings
```json
{
  "mcp-ollama.enabled": true,
  "mcp-ollama.serverUrl": "https://localhost:3077",
  "mcp-ollama.host": "https://localhost:11434",
  "mcp-ollama.model": "deepseek-coder-v2:236b",
  "mcp-ollama.useHttps": true,
  "mcp-ollama.suggestionDelay": 500,
  "mcp-ollama.maxSuggestions": 3
}
```

## 🤖 Supported Models

### Recommended Models
- **deepseek-coder-v2:236b** - Best for code completion
- **codellama:7b-instruct** - Good balance of speed/quality
- **llama3.1:8b** - General purpose coding
- **veda-coder-v2:latest** - Specialized for error fixing

### Install Models
```bash
ollama pull deepseek-coder-v2:236b
ollama pull codellama:7b-instruct
ollama pull llama3.1:8b
```

## 🌐 API Endpoints

### REST API
- `GET /health` - Server health check
- `POST /tools/{toolName}` - Execute MCP tool
- `POST /stream/completion` - Streaming completion
- `POST /stream/chat` - Streaming chat

### Available Tools (36 total)
- `code_completion` - Generate code completions
- `auto_error_fix` - Fix errors automatically
- `explain_code` - Explain code functionality
- `generate_tests` - Create unit tests
- `security_scan` - Security vulnerability scan
- `optimize_performance` - Performance optimization
- `translate_code` - Language translation
- `inline_suggestion` - Real-time suggestions
- `chat_assistant` - Interactive chat
- And 27 more specialized tools...

## 🎯 Use Cases

### For Developers
- **Code Completion** - Faster coding with intelligent suggestions
- **Error Fixing** - Automatic error detection and resolution
- **Code Review** - AI-powered code quality analysis
- **Documentation** - Auto-generate comprehensive docs
- **Testing** - Create comprehensive test suites

### For Teams
- **Consistency** - Enforce coding standards
- **Knowledge Sharing** - Learn from AI explanations
- **Productivity** - Reduce development time
- **Quality** - Improve code quality with AI review

### For Learning
- **Code Explanation** - Understand complex code
- **Best Practices** - Learn coding patterns
- **Language Learning** - Translate between languages
- **Debugging** - Learn error fixing techniques

## 🔒 Privacy & Security

- **Local Processing** - All AI runs on your machine
- **No Data Sharing** - Code never leaves your environment
- **Offline Capable** - Works without internet
- **Open Source** - Full transparency
- **Configurable** - Control what data is processed

## 🚨 Troubleshooting

### Common Issues

**Extension not working?**
1. Check server is running: `curl http://localhost:3077/health`
2. Verify Ollama is running: `ollama list`
3. Check VS Code Developer Console for errors

**Slow responses?**
1. Use smaller models (7B instead of 236B)
2. Increase timeout in settings
3. Check system resources

**Connection errors?**
1. Verify port 3077 is available
2. Check firewall settings
3. Ensure correct server URL in settings

### Debug Mode
Enable debug logging:
```json
{
  "mcp-ollama.debug": true
}
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **Ollama** - Local AI model runtime
- **Model Context Protocol** - AI integration standard
- **VS Code** - Extensible editor platform
- **GitHub Copilot** - Inspiration for features

## 📞 Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: Wiki
- **Community**: Discord Server

---

**Made with ❤️ for developers who value privacy and local AI**