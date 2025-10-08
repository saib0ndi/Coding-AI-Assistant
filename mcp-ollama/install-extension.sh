#!/bin/bash

# SmartCode AI Assistant Extension Installer
echo "🚀 Installing SmartCode AI Assistant Extension v3.1.0"

cd vscode-extension

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Compile TypeScript
echo "🔨 Compiling TypeScript..."
npm run compile

# Package extension
echo "📦 Packaging extension..."
npm run package

# Install extension
echo "🔧 Installing extension in VS Code..."
code --install-extension smartcode-aiassist-3.1.0.vsix --force

echo "✅ SmartCode AI Assistant v3.1.0 installed successfully!"
echo ""
echo "🎯 Features Available:"
echo "   • 30+ AI-powered tools for coding assistance"
echo "   • Real-time code completion and suggestions"
echo "   • Automatic error detection and fixing"
echo "   • Security vulnerability scanning"
echo "   • Code generation from natural language"
echo "   • Autonomous agent system (/dev, /test, /review)"
echo "   • GitHub Copilot-like functionality"
echo "   • 100% local and private (uses Ollama)"
echo ""
echo "🔧 Usage:"
echo "   • Press Ctrl+Shift+M (Cmd+Shift+M on Mac) to open AI chat"
echo "   • Right-click on code for context menu options"
echo "   • Use slash commands: /fix, /explain, /tests, /docs"
echo "   • Configure Ollama host in VS Code settings"
echo ""
echo "⚙️  Configuration:"
echo "   • Open VS Code Settings"
echo "   • Search for 'SmartCode AI Assistant'"
echo "   • Set your Ollama host URL (default: http://localhost:11434)"
echo ""
echo "🎉 Ready to use! Restart VS Code if needed."