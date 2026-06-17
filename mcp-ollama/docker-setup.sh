#!/bin/bash

# MCP-Ollama Docker Setup Script
echo "🚀 Setting up MCP-Ollama with Docker..."

MCP_SERVER_URL="${MCP_SERVER_URL:-http://localhost:8080}"
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
PORT="${PORT:-8080}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "✅ Docker installed. Please logout and login again."
    exit 1
fi

# Build Docker image
echo "🔨 Building MCP-Ollama Docker image..."
docker build -t mcp-ollama .

# Run Docker container
echo "🚀 Starting MCP-Ollama server..."
docker run -d \
    --name mcp-ollama-server \
    --network=host \
    -e MCP_SERVER_URL="$MCP_SERVER_URL" \
    -e OLLAMA_HOST="$OLLAMA_HOST" \
    -e PORT="$PORT" \
    mcp-ollama

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Test server
echo "🧪 Testing server..."
if curl -f "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo "✅ MCP-Ollama server is running!"
    echo "🌐 Server URL: $MCP_SERVER_URL"
    echo "📋 Available endpoints:"
    echo "   - Health: $MCP_SERVER_URL/health"
    echo "   - Models: $MCP_SERVER_URL/models"
    echo "   - Generate: $MCP_SERVER_URL/generate"
    echo ""
    echo "🎯 Next steps:"
    echo "1. Install VSCode extension: cd vscode-extension && code --install-extension smartcode-aiassist-3.10.2.vsix"
    echo "2. Open VSCode and press Ctrl+Shift+M to start using AI assistant"
else
    echo "❌ Server failed to start. Check Docker logs:"
    echo "docker logs mcp-ollama-server"
fi
