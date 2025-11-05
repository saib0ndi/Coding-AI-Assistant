#!/bin/bash

# Start MCP-Ollama Server for VS Code Extension
echo "🚀 Starting MCP-Ollama Server..."
echo "=================================="

# Check if built
if [ ! -d "dist" ]; then
    echo "📦 Building project..."
    npm run build
fi

# Start server
echo "🔧 Starting server on port 3077..."
echo "💡 Use Ctrl+C to stop the server"
echo "🎯 VS Code extension will connect automatically"
echo ""

node dist/index.js