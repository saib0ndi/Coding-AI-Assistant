# MCP-Ollama Enhanced Server

## 🎯 Project Motto
**"Intelligent Code Assistance with Automated Error Resolution"**

Empowering developers with AI-driven code completion, analysis, and automated error fixing capabilities through the Model Context Protocol (MCP) and Ollama integration.

## 🚀 Overview

The MCP-Ollama Enhanced Server is a comprehensive AI-powered development assistant that provides intelligent code completion, analysis, and automated error fixing capabilities. Built on the Model Context Protocol (MCP), it integrates seamlessly with Ollama to deliver local, privacy-focused AI assistance for developers.

## 🌟 Key Features

### 🔧 Core AI Capabilities
- **Intelligent Code Completion**: Context-aware code suggestions with multi-language support
- **Code Analysis & Explanation**: Deep code understanding with refactoring suggestions
- **Code Generation**: Natural language to code conversion
- **Multi-language Support**: JavaScript, TypeScript, Python, Java, C++, Rust, Go, and more

### 🛠️ Advanced Error Fixing (NEW)
- **Auto Error Fix**: Automatically analyze and fix compilation, runtime, and linting errors
- **Real-time Diagnostics**: Continuous code quality monitoring with syntax, semantic, style, security, and performance checks
- **Quick Fix Suggestions**: Instant solutions for common coding issues
- **Batch Error Processing**: Handle multiple errors simultaneously with intelligent prioritization
- **Error Pattern Recognition**: Learn from error history to prevent recurring issues
- **Smart Code Validation**: Verify that fixes actually resolve the original problems

### 🧠 Intelligence Features
- **Context Awareness**: Project-wide understanding with dependency analysis
- **Caching System**: Intelligent response caching for improved performance
- **Pattern Recognition**: Learn from coding patterns and error histories
- **Multi-file Analysis**: Understand relationships across project files

### 🔒 Security & Performance
- **Local Processing**: All AI processing happens locally via Ollama
- **Privacy-First**: No code sent to external services
- **Secure Path Handling**: Protection against path traversal attacks
- **Log Injection Prevention**: Sanitized logging to prevent security vulnerabilities
- **Performance Optimization**: Efficient caching and parallel processing

## 📁 Project Structure

```
mcp-ollama/
├── src/
│   ├── providers/
│   │   └── OllamaProvider.ts      # Core AI provider implementation
│   ├── server/
│   │   └── MCPServer.ts           # Main MCP server with all tools
│   ├── types/
│   │   └── index.ts               # TypeScript type definitions
│   └── utils/
│       ├── CacheManager.ts        # Intelligent caching system
│       ├── ContextManager.ts      # Project context analysis
│       ├── ErrorAnalyzer.ts       # Advanced error analysis engine
│       └── Logger.ts              # Secure logging utility
├── package.json                   # Project dependencies and scripts
├── tsconfig.json                  # TypeScript configuration
└── .env.example                   # Environment configuration template
```

## 🛠️ Available Tools

### 📝 Code Assistance Tools
1. **code_completion** - Intelligent code completions
2. **code_analysis** - Code explanation, refactoring, optimization, bug detection
3. **code_generation** - Generate code from natural language
4. **code_explanation** - Detailed code explanations
5. **refactoring_suggestions** - Smart refactoring recommendations

### 🔧 Error Fixing Tools (Enhanced)
6. **auto_error_fix** - Automatically fix errors with AI analysis
7. **diagnose_code** - Real-time code diagnostics
8. **quick_fix** - Instant solutions for specific issues
9. **batch_error_fix** - Process multiple errors efficiently
10. **error_pattern_analysis** - Analyze error patterns for prevention
11. **validate_fix** - Verify fix effectiveness

### 🔍 Analysis Tools
12. **context_analysis** - Project-wide context understanding

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18.0.0 or higher
- Ollama installed and running locally
- A compatible Ollama model (e.g., codellama:7b-instruct)

### Installation Steps

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd mcp-ollama
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Ollama configuration
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

4. **Start the Server**
   ```bash
   npm start
   ```

### Environment Configuration

```env
# Ollama Configuration
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=codellama:7b-instruct

# MCP Server Configuration
MCP_SERVER_PORT=3001
MCP_SERVER_HOST=localhost

# Feature Toggles
ENABLE_CODE_COMPLETION=true
ENABLE_CODE_EXPLANATION=true
ENABLE_CODE_GENERATION=true
ENABLE_REFACTORING=true
ENABLE_CONTEXT_AWARENESS=true
ENABLE_MULTI_FILE_ANALYSIS=true

# Performance Settings
MAX_COMPLETION_LENGTH=500
COMPLETION_TIMEOUT=5000
CACHE_ENABLED=true
CACHE_TTL=300000

# Logging
LOG_LEVEL=info
LOG_FILE=logs/mcp-ollama.log
```

## 🎯 Usage Examples

### Auto Error Fix
```json
{
  "tool": "auto_error_fix",
  "params": {
    "errorMessage": "TypeError: Cannot read property 'name' of undefined",
    "code": "const user = getUser(); console.log(user.name);",
    "language": "javascript",
    "filePath": "src/user.js",
    "lineNumber": 2
  }
}
```

### Real-time Diagnostics
```json
{
  "tool": "diagnose_code",
  "params": {
    "code": "function example() { var x = 1; if (x == null) return; }",
    "language": "javascript",
    "checkTypes": ["syntax", "style", "security"]
  }
}
```

### Code Completion
```json
{
  "tool": "code_completion",
  "params": {
    "code": "function calculateTotal(items) {\n  return items.",
    "language": "javascript",
    "position": { "line": 1, "character": 15 }
  }
}
```

## 🔮 Future Roadmap

### Short-term (Next 3 months)
- **Enhanced Language Support**: Add support for more programming languages
- **IDE Integration**: Direct integration with popular IDEs (VS Code, IntelliJ)
- **Custom Error Patterns**: User-defined error pattern recognition
- **Performance Metrics**: Detailed analytics on fix success rates

### Medium-term (3-6 months)
- **Team Collaboration**: Shared error databases and fix templates
- **Machine Learning**: Improved error prediction and prevention
- **Code Quality Scoring**: Comprehensive code quality metrics
- **Integration APIs**: REST and GraphQL APIs for external integrations

### Long-term (6+ months)
- **Multi-model Support**: Support for different AI models beyond Ollama
- **Cloud Deployment**: Optional cloud-based processing for teams
- **Advanced Analytics**: Comprehensive development insights and reporting
- **Plugin Ecosystem**: Extensible plugin architecture for custom tools

## 🔒 Security Features

### Implemented Security Measures
- **Path Traversal Protection**: Validates all file paths to prevent unauthorized access
- **Log Injection Prevention**: Sanitizes all log inputs to prevent log manipulation
- **Input Validation**: Comprehensive validation of all user inputs
- **Secure Error Handling**: Safe error message handling without information leakage
- **Local Processing**: All AI processing happens locally for privacy

### Security Best Practices
- Regular security audits and vulnerability assessments
- Secure coding practices throughout the codebase
- Comprehensive error handling and logging
- Input sanitization and validation
- Principle of least privilege in file system access

## 🐛 Known Issues & Limitations

### Current Limitations
1. **Model Dependency**: Requires Ollama to be running locally
2. **Language Coverage**: Some advanced language features may not be fully supported
3. **Large File Handling**: Performance may degrade with very large files (>5MB)
4. **Complex Error Chains**: May struggle with deeply nested error dependencies

### Planned Improvements
- Enhanced error chain analysis
- Better handling of large codebases
- Improved model fallback mechanisms
- More granular configuration options

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines for:
- Code style and standards
- Testing requirements
- Pull request process
- Issue reporting guidelines

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **Ollama Team**: For providing the excellent local AI model infrastructure
- **MCP Community**: For the Model Context Protocol specification
- **Open Source Contributors**: For various libraries and tools used in this project

## 📞 Support

For support, please:
1. Check the documentation and examples
2. Search existing issues on GitHub
3. Create a new issue with detailed information
4. Join our community discussions

---

**Built with ❤️ for the developer community**