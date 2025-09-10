#!/bin/bash

echo "Installing MCP-Ollama AI Assistant..."

# Build the MCP server
echo "Building MCP server..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
npm install
npm run build

# Build the VS Code extension
echo "Building VS Code extension..."
cd vscode-extension
npm install
npm run compile

# Package the extension
echo "Packaging extension..."
npx vsce package

echo "Installation complete!"
echo ""
echo "To use:"
echo "1. Start the MCP server: npm start"
echo "2. Install the extension: code --install-extension smartcode-aiassist-1.0.2.vsix"
echo "3. Configure server URL in VS Code settings: http://localhost:3077"