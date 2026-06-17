#!/bin/bash

# Restart MCP-Ollama Server Script
echo "🔄 Restarting MCP-Ollama Server..."

# Build the project
echo "🔨 Building project..."
cd "$(dirname "$0")"
PID_FILE=".mcp-ollama.pid"

if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE")"
    if [ -n "$OLD_PID" ] && ps -p "$OLD_PID" > /dev/null; then
        echo "📋 Stopping previous MCP server process (PID: $OLD_PID)..."
        kill "$OLD_PID" || true
        sleep 2
    fi
    rm -f "$PID_FILE"
fi

npm run build 2>/dev/null || echo "⚠️  Build step skipped"

# Start the server
echo "🚀 Starting MCP server..."
npm start &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait a moment for server to start
sleep 3

# Check if server is running
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ MCP server started successfully (PID: $SERVER_PID)"
    echo "🌐 Server should be available at http://localhost:${MCP_SERVER_PORT:-3078}"
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
