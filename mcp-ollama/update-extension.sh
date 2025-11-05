#!/bin/bash

echo "🔄 Updating MCP-Ollama Extension..."

# Navigate to project root
cd /home/sb57213v/Coding-AI-Assistant/mcp-ollama

# Build the main project
echo "📦 Building MCP server..."
npm run build

# Install MCP server globally
echo "🌐 Installing MCP server globally..."
sudo npm install -g .

# Navigate to extension directory
cd vscode-extension

# Install extension dependencies
echo "📦 Installing extension dependencies..."
npm install

# Build the extension
echo "🔨 Building extension..."
npm run compile

# Package the extension
echo "📦 Packaging extension..."
npm run package

# Install the extension
echo "🚀 Installing extension in VS Code..."
code --install-extension smartcode-aiassist-3.6.0.vsix --force

echo "✅ Extension updated successfully!"
echo "🔄 Please reload VS Code to use the updated extension."