# MCP Ollama VS Code Extension - Installation Guide

## 🚀 Quick Setup

### Prerequisites
1. **MCP-Ollama Server Running**
   ```bash
   cd /path/to/mcp-ollama
   npm start
   ```

2. **Ollama with CodeLlama Model**
   ```bash
   ollama pull codellama:7b-instruct
   ollama serve
   ```

### Install Extension

#### Method 1: From Source (Development)
```bash
# Navigate to extension directory
cd mcp-ollama/vscode-extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Open in VS Code for testing
code .
```

#### Method 2: Package and Install
```bash
# Install vsce (VS Code Extension Manager)
npm install -g vsce

# Package extension
vsce package

# Install the generated .vsix file
code --install-extension mcp-ollama-assistant-1.0.0.vsix
```

## 🔧 Configuration

### VS Code Settings
Open VS Code settings (`Ctrl+,`) and configure:

```json
{
    "mcpOllama.serverUrl": "http://localhost:3003",
    "mcpOllama.autoFix": true,
    "mcpOllama.showDiagnostics": true
}
```

### Server Configuration
Ensure MCP-Ollama server is configured in `.env`:
```env
OLLAMA_HOST=http://10.10.110.25:11434
OLLAMA_MODEL=deepseek-coder-v2:236b
MCP_SERVER_PORT=3003
ENABLE_REST_API=true
```

## 🎯 Usage Examples

### 1. Fix JavaScript Error
```javascript
// Select this buggy code
const user = getUser();
console.log(user.name); // Potential null reference

// Right-click → "Fix Error with AI"
// Extension will suggest null checks
```

### 2. Explain Complex Code
```python
# Select this code
def fibonacci(n):
    return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)

# Right-click → "Explain Code"
# Get detailed explanation in side panel
```

### 3. Generate Code
```
Command Palette → "MCP Ollama: Generate Code from Description"
Input: "Create a REST API endpoint for user authentication"
```

### 4. Refactor Code
```javascript
// Select this code
var x = 1;
var y = 2;
if (x == null) {
    console.log("x is null");
}

// Right-click → "Suggest Refactoring"
// Get modern JavaScript suggestions
```

## 🔍 Available Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Fix Error with AI | Right-click menu | Auto-fix selected code |
| Explain Code | Right-click menu | Detailed code explanation |
| Generate Code | `Ctrl+Shift+P` | Generate from description |
| Diagnose Code | `Ctrl+Shift+P` | Analyze current file |
| Suggest Refactoring | Right-click menu | Refactoring suggestions |

## 🛠️ Troubleshooting

### Extension Not Working
1. **Check MCP Server Status**
   ```bash
   curl http://localhost:3002/api/health
   ```

2. **Verify Ollama Running**
   ```bash
   ollama list
   ollama ps
   ```

3. **Check VS Code Developer Console**
   - `Help` → `Toggle Developer Tools`
   - Look for error messages

### Common Issues

**"Server not responding"**
- Ensure MCP-Ollama server is running on port 3002
- Check firewall settings
- Verify server URL in VS Code settings

**"Slow responses"**
- Increase system resources for Ollama
- Use smaller model if needed: `ollama pull codellama:7b`
- Check server timeout settings

**"No fixes found"**
- Try selecting more context around the error
- Ensure code language is supported
- Check server logs for errors

## 🔧 Development Setup

### For Extension Development
```bash
# Clone and setup
git clone <repository>
cd mcp-ollama/vscode-extension

# Install dependencies
npm install

# Start development
npm run watch

# Test in VS Code
F5 (opens Extension Development Host)
```

### Debug Extension
1. Open `vscode-extension` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Test commands in the new VS Code window
4. Check Debug Console for logs

## 📊 Performance Tips

### Optimize for Speed
- Use local Ollama installation
- Ensure sufficient RAM (8GB+ recommended)
- Use SSD for better model loading
- Close unnecessary applications

### Model Selection
- **Fast**: `codellama:7b` (4GB RAM)
- **Balanced**: `codellama:7b-instruct` (4GB RAM)
- **Quality**: `codellama:13b-instruct` (8GB RAM)

## 🎉 Success Verification

After installation, test these features:

1. **✅ Basic Functionality**
   - Open a JavaScript file
   - Select some code
   - Right-click → see MCP Ollama options

2. **✅ Error Fixing**
   - Create intentional error: `console.log(undefinedVar)`
   - Select and fix with AI

3. **✅ Code Generation**
   - Use Command Palette
   - Generate simple function

4. **✅ Server Connection**
   - Check status bar for connection indicator
   - Verify no error messages in console

## 🚀 Ready to Use!

Your MCP-Ollama VS Code extension is now ready! Start coding with AI-powered assistance for error fixing, code explanation, and intelligent suggestions.

**Next Steps:**
- Explore all available commands
- Customize settings for your workflow
- Share feedback and suggestions
- Contribute to the project