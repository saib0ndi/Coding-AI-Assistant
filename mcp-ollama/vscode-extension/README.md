# MCP Ollama AI Assistant - VS Code Extension

AI-powered code completion and error fixing extension that integrates with the MCP-Ollama server.

## Features

- **🔧 Auto Error Fixing**: Select problematic code and get AI-powered fixes
- **📝 Code Explanation**: Get detailed explanations of selected code
- **🚀 Code Generation**: Generate code from natural language descriptions
- **🔍 Code Diagnosis**: Analyze code for potential issues and bugs
- **♻️ Refactoring Suggestions**: Get intelligent refactoring recommendations

## Requirements

- MCP-Ollama server running on `http://localhost:3002`
- Ollama with CodeLlama model installed

## Installation

1. Install the extension from VS Code marketplace
2. Ensure MCP-Ollama server is running
3. Configure server URL in settings if different from default

## Usage

### Fix Errors
1. Select code with errors
2. Right-click → "Fix Error with AI"
3. Review and apply suggested fixes

### Explain Code
1. Select code to understand
2. Right-click → "Explain Code"
3. View detailed explanation in side panel

### Generate Code
1. Use Command Palette: "MCP Ollama: Generate Code from Description"
2. Enter description of desired code
3. Insert generated code at cursor

### Diagnose Issues
1. Use Command Palette: "MCP Ollama: Diagnose Code Issues"
2. Get analysis of potential problems in current file

### Refactor Code
1. Select code to refactor
2. Right-click → "Suggest Refactoring"
3. View suggestions in side panel

## Configuration

```json
{
    "mcpOllama.serverUrl": "http://localhost:3002",
    "mcpOllama.autoFix": true,
    "mcpOllama.showDiagnostics": true
}
```

## Commands

- `mcpOllama.fixError` - Fix Error with AI
- `mcpOllama.explainCode` - Explain Code
- `mcpOllama.generateCode` - Generate Code from Description
- `mcpOllama.diagnoseCode` - Diagnose Code Issues
- `mcpOllama.refactorCode` - Suggest Refactoring

## Supported Languages

- JavaScript/TypeScript
- Python
- Java
- C/C++
- Go
- Rust
- And more...

## Troubleshooting

**Extension not working?**
1. Check MCP-Ollama server is running: `curl http://localhost:3002/api/health`
2. Verify Ollama is running: `ollama list`
3. Check VS Code Developer Console for errors

**Slow responses?**
- Ensure sufficient system resources for Ollama
- Check server configuration and timeout settings

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
vsce package
```