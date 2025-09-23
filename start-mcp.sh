#!/bin/bash

echo "Starting MCP-Ollama Integration..."

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "Starting Ollama..."
    ollama serve &
    sleep 3
fi

# Ensure model is available
echo "Checking codellama model..."
ollama pull codellama:7b-instruct

# Start MCP server
echo "Starting MCP server..."
cd /home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama
npm start

echo "MCP-Ollama integration ready!"