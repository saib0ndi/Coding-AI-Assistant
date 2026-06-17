#!/bin/bash

echo "🔄 Updating MCP-Ollama Extension..."

# Navigate to project root
cd "$(dirname "$0")"

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
VERSION="$(node -p "require('./package.json').version")"
code --install-extension "smartcode-aiassist-${VERSION}.vsix" --force

echo "✅ Extension updated successfully!"
echo "🔄 Please reload VS Code to use the updated extension."
