#!/bin/bash

echo "🔍 MCP-Ollama Status Check"
echo "========================="

# Check if MCP server is built
if [ -d "dist" ] && [ -f "dist/index.js" ]; then
    echo "✅ MCP Server: Built and ready"
else
    echo "❌ MCP Server: Not built (run 'npm run build')"
fi

# Check if VS Code extension is compiled
if [ -d "vscode-extension/out" ] && [ -f "vscode-extension/out/extension.js" ]; then
    echo "✅ VS Code Extension: Compiled"
else
    echo "❌ VS Code Extension: Not compiled (run 'cd vscode-extension && npm run compile')"
fi

# Check if VSIX exists
if [ -f "vscode-extension/smartcode-aiassist-2.7.3.vsix" ]; then
    echo "✅ Extension Package: Available"
else
    echo "❌ Extension Package: Not found"
fi

# Check if extension is installed
if code --list-extensions | grep -q "saibondi.smartcode-aiassist"; then
    echo "✅ Extension Installation: Installed in VS Code"
else
    echo "❌ Extension Installation: Not installed in VS Code"
fi

# Check Ollama connection
echo ""
echo "🔗 Testing Ollama Connection..."
OLLAMA_HOST=${OLLAMA_HOST:-"http://10.10.110.25:11434"}
if curl -s "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; then
    echo "✅ Ollama Server: Connected ($OLLAMA_HOST)"
    echo "📋 Available Models:"
    curl -s "$OLLAMA_HOST/api/tags" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | head -5
else
    echo "❌ Ollama Server: Not accessible ($OLLAMA_HOST)"
fi

echo ""
echo "🚀 Quick Start Commands:"
echo "  Start MCP Server: npm start"
echo "  Open VS Code: code ."
echo "  Test Chat: Ctrl+Shift+M"