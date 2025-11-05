#!/bin/bash

# MCP-Ollama Docker Setup Script
echo "🚀 Setting up MCP-Ollama with Docker..."

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
    -e MCP_SERVER_URL=http://10.10.110.22:15267 \
    -e OLLAMA_HOST=http://10.10.110.25:11434 \
    -e PORT=8080 \
    mcp-ollama

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Test server
echo "🧪 Testing server..."
if curl -f http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ MCP-Ollama server is running!"
    echo "🌐 Server URL: http://10.10.110.22:15267"
    echo "📋 Available endpoints:"
    echo "   - Health: http://10.10.110.22:15267/health"
    echo "   - Models: http://10.10.110.22:15267/models"
    echo "   - Generate: http://10.10.110.22:15267/generate"
    echo ""
    echo "🎯 Next steps:"
    echo "1. Install VSCode extension: cd vscode-extension && code --install-extension smartcode-aiassist-3.10.2.vsix"
    echo "2. Open VSCode and press Ctrl+Shift+M to start using AI assistant"
else
    echo "❌ Server failed to start. Check Docker logs:"
    echo "docker logs mcp-ollama-server"
fi