# Autonomous Agent Usage

Your MCP Ollama server includes autonomous execution capabilities with planning, validation, and self-correction.

## 🚀 Key Features

### 1. **Intent Analysis & Context Fusion**
- Automatically understands what you want to accomplish
- Analyzes complexity and risk levels
- Identifies required tools and dependencies

### 2. **Autonomous Planning**
- Creates detailed execution plans
- Assesses risks and safety
- Estimates time and complexity

### 3. **Self-Executing Engine**
- Runs planned actions autonomously
- Validates each step before proceeding
- Adapts execution based on results

### 4. **Self-Correction Loop**
- Detects failures automatically
- Analyzes root causes
- Generates corrections and retries
- Learns from mistakes

## 📋 Available Tools

### Core Autonomous Tools

```json
{
  "autonomous_execute": {
    "description": "Execute tasks autonomously with planning and self-correction",
    "parameters": {
      "description": "What you want to accomplish",
      "context": {
        "workspacePath": "/path/to/project",
        "language": "typescript",
        "files": ["src/index.ts"]
      }
    }
  }
}
```

### Smart Implementation
```json
{
  "smart_implement": {
    "description": "Autonomously implement features with planning",
    "parameters": {
      "feature": "Add user authentication",
      "workspacePath": "/path/to/project",
      "language": "typescript",
      "requirements": ["JWT tokens", "Password hashing"]
    }
  }
}
```

### Smart Debugging
```json
{
  "smart_debug": {
    "description": "Autonomously debug and fix issues",
    "parameters": {
      "issue": "TypeError: Cannot read property 'name' of undefined",
      "filePath": "/path/to/file.ts",
      "context": "Error occurs in user profile component"
    }
  }
}
```

## 🎯 Usage Examples

### Example 1: Implement a Feature
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "smart_implement",
      "arguments": {
        "feature": "Add REST API endpoints for user management",
        "workspacePath": "/home/user/my-project",
        "language": "typescript",
        "requirements": [
          "CRUD operations for users",
          "Input validation",
          "Error handling"
        ]
      }
    }
  }'
```

### Example 2: Debug an Issue
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "smart_debug",
      "arguments": {
        "issue": "Database connection timeout",
        "filePath": "/home/user/my-project/src/database.ts"
      }
    }
  }'
```

## 📊 Response Format

### Successful Execution
```json
{
  "taskId": "auto_1234567890",
  "success": true,
  "steps": [
    {
      "id": "step_1",
      "action": "Analyze requirements",
      "success": true
    }
  ],
  "summary": "Feature implemented successfully",
  "filesModified": [
    "/home/user/my-project/src/api/users.ts"
  ],
  "autonomous": true
}
```

## 🔧 Configuration

### Environment Variables
```bash
AUTONOMOUS_ENABLED=true
MAX_AUTONOMOUS_TASKS=5
DEFAULT_RISK_LEVEL=medium
```

## 🚨 Safety Features

1. **Risk Assessment**: All operations are risk-assessed
2. **Validation**: Each step is validated before proceeding
3. **Rollback**: Critical failures trigger automatic rollback
4. **User Control**: Pause, resume, or cancel tasks anytime

This autonomous agent system brings intelligent automation to your local development environment!