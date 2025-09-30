#!/bin/bash

set -e

echo "🚀 Updating and Installing MCP-Ollama AI Assistant..."
echo "=================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Update dependencies for MCP server
echo "📦 Updating MCP server dependencies..."
npm update
npm audit fix --force 2>/dev/null || true

# Clean and rebuild MCP server
echo "🔨 Building MCP server..."
npm run clean 2>/dev/null || rm -rf dist
npm run build

# Update VS Code extension dependencies
echo "📦 Updating VS Code extension dependencies..."
cd vscode-extension
npm update
npm audit fix --force 2>/dev/null || true

# Clean and rebuild extension
echo "🔨 Building VS Code extension..."
rm -rf out 2>/dev/null || true
npm run compile

# Package the extension
echo "📦 Packaging extension..."
npx vsce package --out smartcode-aiassist-2.7.3.vsix

# Install the extension
echo "🔧 Installing VS Code extension..."
if command -v code &> /dev/null; then
    code --install-extension smartcode-aiassist-2.7.3.vsix --force
    echo "✅ Extension installed successfully!"
else
    echo "⚠️  VS Code CLI not found. Please install manually:"
    echo "   code --install-extension smartcode-aiassist-2.7.3.vsix"
fi

cd "$SCRIPT_DIR"

echo ""
echo "✅ Update and installation complete!"
echo "=================================="
echo ""
echo "🎯 Next steps:"
echo "1. Start the MCP server: npm start"
echo "2. Open VS Code and configure settings:"
echo "   - MCP Server URL: http://localhost:3077"
echo "   - Ollama Host: http://10.10.110.25:11434"
echo "   - Model: codellama:7b-instruct"
echo ""
echo "🔧 Available commands:"
echo "   Ctrl+Shift+M - Open AI Chat"
echo "   Ctrl+Shift+E - Explain selected code"
echo "   Tab - Accept suggestions"
echo ""