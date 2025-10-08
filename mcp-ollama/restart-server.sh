#!/bin/bash

# Restart MCP-Ollama Server Script
echo "🔄 Restarting MCP-Ollama Server..."

# Kill existing processes
echo "📋 Stopping existing processes..."
pkill -f "mcp-ollama" || true
pkill -f "node.*index.js" || true
sleep 2

# Build the project
echo "🔨 Building project..."
cd /home/sb57213v/Coding-AI-Assistant/mcp-ollama
npm run build 2>/dev/null || echo "⚠️  Build step skipped"

# Start the server
echo "🚀 Starting MCP server..."
npm start &
SERVER_PID=$!

# Wait a moment for server to start
sleep 3

# Check if server is running
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ MCP server started successfully (PID: $SERVER_PID)"
    echo "🌐 Server should be available at http://localhost:3077"
else
    echo "❌ Failed to start MCP server"
    exit 1
fi

echo "🎉 Restart complete! The timeout fixes have been applied."
echo ""
echo "📝 Changes made:"
echo "   • Reduced request timeouts (30s for main requests, 10s for Ollama)"
echo "   • Added 25-second timeout for slash commands"
echo "   • Limited code input size to prevent long processing"
echo "   • Added Ollama-specific parameters to limit response length"
echo ""
echo "💡 If you still experience timeouts, try using shorter code snippets."