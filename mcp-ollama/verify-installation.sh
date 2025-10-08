#!/bin/bash

echo "🔍 Verifying SmartCode AI Assistant Installation"
echo "=============================================="

# Check if VS Code is installed
if command -v code &> /dev/null; then
    echo "✅ VS Code is installed"
else
    echo "❌ VS Code not found. Please install VS Code first."
    exit 1
fi

# Check if extension is installed
if code --list-extensions | grep -q "saibondi.smartcode-aiassist"; then
    echo "✅ SmartCode AI Assistant extension is installed"
    
    # Get extension version
    EXTENSION_VERSION=$(code --list-extensions --show-versions | grep "saibondi.smartcode-aiassist" | cut -d'@' -f2)
    echo "📦 Extension version: $EXTENSION_VERSION"
else
    echo "❌ SmartCode AI Assistant extension not found"
    echo "💡 Run ./install-extension.sh to install it"
    exit 1
fi

# Check if Ollama is running
if curl -s http://10.10.110.25:11434/api/tags &> /dev/null; then
    echo "✅ Ollama server is running on 10.10.110.25:11434"
    
    # List available models
    echo "🤖 Available Ollama models:"
    curl -s http://10.10.110.25:11434/api/tags | jq -r '.models[].name' 2>/dev/null || echo "   (Unable to fetch model list)"
else
    echo "⚠️  Ollama server not running on 10.10.110.25:11434"
    echo "💡 Make sure Ollama is running on the remote server"
fi

# Check if MCP server files exist
if [ -f "src/server/MCPServer.ts" ]; then
    echo "✅ MCP server files found"
else
    echo "❌ MCP server files not found"
fi

# Check Node.js version
NODE_VERSION=$(node --version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Node.js version: $NODE_VERSION"
    
    # Check if version is 18+
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$MAJOR_VERSION" -ge 18 ]; then
        echo "✅ Node.js version is compatible (18+)"
    else
        echo "⚠️  Node.js version should be 18+ for best compatibility"
    fi
else
    echo "❌ Node.js not found"
fi

echo ""
echo "🎯 Next Steps:"
echo "1. Open VS Code"
echo "2. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)"
echo "3. Type 'SmartCode' to see available commands"
echo "4. Or press Ctrl+Shift+M (Cmd+Shift+M on Mac) to open AI chat"
echo ""
echo "⚙️  Configuration:"
echo "• Open VS Code Settings"
echo "• Search for 'SmartCode AI Assistant'"
echo "• Ollama host is configured for 10.10.110.25:11434"
echo ""
echo "🎉 Installation verification complete!"