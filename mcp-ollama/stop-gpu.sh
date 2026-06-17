#!/bin/bash
# Stop all GPU-intensive processes for MCP-Ollama

echo "Stopping MCP-Ollama GPU processes..."

if [ "${CONFIRM_STOP_ALL:-}" != "true" ]; then
    echo "This script stops Ollama, MCP-related Node processes, and common MCP ports."
    echo "Run with CONFIRM_STOP_ALL=true ./stop-gpu.sh to continue."
    exit 1
fi

# Stop Ollama service if running
pkill -f ollama 2>/dev/null || true

# Stop any Node.js processes related to MCP
pkill -f "node.*mcp" 2>/dev/null || true

# Stop processes on common MCP ports
for port in 3000 8080 11434; do
    lsof -ti:$port | xargs kill -9 2>/dev/null || true
done

echo "GPU processes stopped. Extension remains installed."
echo "To restart: npm start in the mcp-ollama directory"
