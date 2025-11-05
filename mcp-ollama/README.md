# MCP-Ollama v2.0.0

Enhanced MCP server for Ollama with conversation context and 12 AI tools.

## Features

✅ **12 Working Tools:**
1. NER (Named Entity Recognition)
2. Health Check
3. Get Available Models
4. Generate Text
5. Code Completion
6. Code Analysis
7. Generate Code
8. Explain Code
9. Generate Error Fixes
10. Generate Quick Fixes
11. Validate Code Fix
12. Memory Management

✅ **Enhanced Features:**
- Conversation context management
- Session-based memory
- Graceful offline handling
- Dynamic timeout calculation
- Streaming support for large responses
- Memory monitoring and cleanup

## Installation

```bash
# Clone and build
git clone <repository>
cd mcp-ollama
npm install
npm run build

# Test all tools
npm test
```

## Usage

### Option 1: Use Hosted Docker Server (Recommended)
The extension is pre-configured to use our hosted server:
- **Server URL**: `http://10.10.110.22:15267`
- **All 12 tools available instantly**
- **No setup required**

### Option 2: Run Your Own Server
```bash
# Quick Docker setup
./docker-setup.sh

# Or manual setup
npm install
npm run build
npm start
```

## Configuration

- **Hosted Server**: `http://10.10.110.22:15267` (default)
- **Local Server**: `http://localhost:3077`
- **Ollama Backend**: `http://10.10.110.25:11434`

## Test Results

- **Success Rate:** 100% (12/12 tools)
- **Error Handling:** Graceful fallbacks when Ollama offline
- **Memory Management:** Active monitoring and cleanup
- **Conversation Context:** Session-based history storage

## Version History

- **v2.0.0:** Fixed TypeScript errors, added conversation context, 100% test pass rate
- **v1.0.0:** Initial release