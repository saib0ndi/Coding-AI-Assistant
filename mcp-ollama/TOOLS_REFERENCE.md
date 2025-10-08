# MCP Ollama Tools Reference Guide

Complete reference for all available tools in the MCP Ollama system with examples and expected outputs.

## 🔧 Core Tools

### 1. `code_completion`
**Purpose**: Generate intelligent code completions
**Parameters**:
```json
{
  "code": "function hello() {\n    console.log(\"",
  "language": "javascript",
  "position": { "line": 1, "character": 20 },
  "context": {
    "fileName": "main.js",
    "projectPath": "/project",
    "imports": ["lodash", "express"],
    "functions": ["helper", "utils"],
    "variables": ["config", "data"]
  }
}
```
**Expected Output**:
```json
{
  "suggestions": [
    { "text": "Hello World\");", "confidence": 0.9 },
    { "text": "Welcome\");", "confidence": 0.7 }
  ],
  "metadata": {
    "model": "llama3.1:8b-instruct-q4_K_M",
    "processingTime": 150,
    "confidence": 0.85
  }
}
```

### 2. `code_generation`
**Purpose**: Generate code from natural language prompts
**Parameters**:
```json
{
  "prompt": "Create a function that validates email addresses using regex",
  "language": "javascript",
  "context": {
    "projectType": "web",
    "dependencies": ["validator"],
    "style": "modern"
  }
}
```
**Expected Output**:
```json
{
  "code": "function validateEmail(email) {\n  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  return regex.test(email);\n}",
  "language": "javascript",
  "metadata": {
    "prompt": "Create a function that validates email addresses using regex",
    "generatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### 3. `code_explanation`
**Purpose**: Explain code functionality and concepts
**Parameters**:
```json
{
  "code": "function fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n-1) + fibonacci(n-2);\n}",
  "language": "javascript",
  "level": "intermediate"
}
```
**Expected Output**:
```json
{
  "explanation": "This is a recursive implementation of the Fibonacci sequence. The function calculates the nth Fibonacci number by recursively calling itself with n-1 and n-2, then adding the results. The base case handles when n is 0 or 1.",
  "language": "javascript",
  "level": "intermediate",
  "metadata": {
    "codeLength": 89,
    "explainedAt": "2024-01-15T10:30:00Z"
  }
}
```

## 🔧 Error Fixing Tools

### 4. `auto_error_fix`
**Purpose**: Automatically fix errors by analyzing error messages and code context
**Parameters**:
```json
{
  "errorMessage": "ReferenceError: undefinedVariable is not defined",
  "code": "const result = undefinedVariable.method();",
  "language": "javascript",
  "filePath": "main.js",
  "lineNumber": 5,
  "stackTrace": "ReferenceError: undefinedVariable is not defined\n    at main.js:5:16",
  "context": {
    "projectPath": "/project",
    "dependencies": ["lodash"],
    "framework": "express"
  }
}
```
**Expected Output**:
```json
{
  "originalError": "ReferenceError: undefinedVariable is not defined",
  "errorType": "REFERENCE_ERROR",
  "errorCategory": "undefined_variable",
  "fixes": [
    {
      "title": "Define the missing variable",
      "fixedCode": "const undefinedVariable = {};\nconst result = undefinedVariable.method();",
      "confidence": 0.8,
      "description": "Added variable declaration"
    }
  ],
  "recommendedFix": {
    "title": "Define the missing variable",
    "fixedCode": "const undefinedVariable = {};\nconst result = undefinedVariable.method();",
    "confidence": 0.8
  },
  "isValidated": true,
  "validationDetails": "Fix successfully resolves the reference error"
}
```

### 5. `quick_fix`
**Purpose**: Generate quick fix suggestions for specific code issues
**Parameters**:
```json
{
  "code": "function divide(a, b) {\n  return a / b;\n}",
  "language": "javascript",
  "issueType": "logic_error",
  "issueDescription": "Division by zero not handled",
  "lineNumber": 2,
  "severity": "error"
}
```
**Expected Output**:
```json
{
  "fixes": [
    {
      "title": "Add zero division check",
      "description": "Prevent division by zero with error handling",
      "fixedCode": "function divide(a, b) {\n  if (b === 0) throw new Error('Division by zero');\n  return a / b;\n}",
      "confidence": 0.9,
      "preservesSemantics": true,
      "requiresUserReview": false
    }
  ],
  "issueType": "logic_error",
  "severity": "error",
  "lineNumber": 2,
  "language": "javascript"
}
```

### 6. `batch_error_fix`
**Purpose**: Fix multiple errors in a codebase at once
**Parameters**:
```json
{
  "errors": [
    {
      "errorMessage": "Missing semicolon",
      "filePath": "file1.js",
      "lineNumber": 10,
      "code": "let x = 5",
      "language": "javascript"
    },
    {
      "errorMessage": "Unused variable",
      "filePath": "file2.js",
      "lineNumber": 5,
      "code": "let unused = 10;\nconsole.log('hello');",
      "language": "javascript"
    }
  ],
  "prioritizeBy": "severity"
}
```
**Expected Output**:
```json
{
  "totalErrors": 2,
  "processedErrors": 2,
  "successfulFixes": 2,
  "failedFixes": 0,
  "fixes": [
    {
      "error": { "errorMessage": "Missing semicolon" },
      "fix": { "fixedCode": "let x = 5;" }
    },
    {
      "error": { "errorMessage": "Unused variable" },
      "fix": { "fixedCode": "console.log('hello');" }
    }
  ],
  "prioritizedBy": "severity"
}
```

### 7. `validate_fix`
**Purpose**: Validate that a proposed fix actually resolves the issue
**Parameters**:
```json
{
  "originalCode": "function divide(a, b) { return a / b; }",
  "fixedCode": "function divide(a, b) {\n  if (b === 0) throw new Error('Division by zero');\n  return a / b;\n}",
  "language": "javascript",
  "originalError": "Division by zero not handled",
  "testCases": ["divide(10, 2)", "divide(10, 0)"]
}
```
**Expected Output**:
```json
{
  "isValid": true,
  "confidence": 0.95,
  "details": "Fix successfully prevents division by zero with proper error handling",
  "potentialIssues": [],
  "testResults": [
    { "test": "divide(10, 2)", "result": "passes" },
    { "test": "divide(10, 0)", "result": "throws error as expected" }
  ],
  "semanticPreservation": true
}
```

### 8. `diagnose_code`
**Purpose**: Perform real-time error detection and diagnostics
**Parameters**:
```json
{
  "code": "function process(data) {\n  if (data.length > 0) {\n    return data.map(item => item.value);\n  }\n}",
  "language": "javascript",
  "filePath": "processor.js",
  "checkTypes": ["syntax", "semantic", "style", "security"]
}
```
**Expected Output**:
```json
{
  "diagnostics": [
    {
      "severity": "warning",
      "message": "Function may return undefined",
      "line": 1,
      "column": 1,
      "type": "semantic",
      "code": "implicit-return",
      "source": "mcp-ollama",
      "quickFix": "Add explicit return statement for else case"
    }
  ],
  "summary": {
    "errorCount": 0,
    "warningCount": 1,
    "infoCount": 0,
    "totalIssues": 1
  },
  "language": "javascript",
  "filePath": "processor.js"
}
```

## 🔍 Analysis Tools

### 9. `code_analysis`
**Purpose**: Analyze code for explanations, refactoring, optimization, or bugs
**Parameters**:
```json
{
  "code": "for (let i = 0; i < array.length; i++) {\n  for (let j = 0; j < array.length; j++) {\n    console.log(array[i] + array[j]);\n  }\n}",
  "language": "javascript",
  "analysisType": "optimization"
}
```
**Expected Output**:
```json
{
  "analysis": "This nested loop has O(n²) complexity. The inner loop recalculates array.length on each iteration, which is inefficient.",
  "suggestions": [
    "Cache array.length in a variable",
    "Consider using array methods like forEach or map",
    "Evaluate if nested iteration is necessary"
  ],
  "confidence": 0.85,
  "metadata": {
    "model": "llama3.1:8b-instruct-q4_K_M",
    "processingTime": 200
  }
}
```

### 10. `context_analysis`
**Purpose**: Analyze project context for better code suggestions
**Parameters**:
```json
{
  "projectPath": "/home/user/project",
  "filePatterns": ["**/*.js", "**/*.ts", "**/*.json"],
  "maxFiles": 50
}
```
**Expected Output**:
```json
{
  "projectStructure": {
    "totalFiles": 45,
    "languages": ["javascript", "typescript"],
    "frameworks": ["express", "react"],
    "dependencies": ["lodash", "axios", "jest"]
  },
  "codePatterns": [
    "Uses ES6 modules",
    "Follows async/await pattern",
    "Uses Jest for testing"
  ],
  "recommendations": [
    "Consider adding TypeScript for better type safety",
    "Add ESLint configuration for consistent code style"
  ]
}
```

### 11. `refactoring_suggestions`
**Purpose**: Get intelligent refactoring suggestions for code improvement
**Parameters**:
```json
{
  "code": "function processUserData(userData) {\n  if (userData) {\n    if (userData.name) {\n      if (userData.email) {\n        return { name: userData.name, email: userData.email };\n      }\n    }\n  }\n  return null;\n}",
  "language": "javascript",
  "focusAreas": ["readability", "maintainability"]
}
```
**Expected Output**:
```json
{
  "analysis": "The function has deeply nested conditions that reduce readability. Early returns and destructuring can improve the code structure.",
  "suggestions": [
    {
      "type": "early_return",
      "description": "Use early returns to reduce nesting",
      "refactoredCode": "function processUserData(userData) {\n  if (!userData?.name || !userData?.email) return null;\n  return { name: userData.name, email: userData.email };\n}"
    }
  ],
  "focusAreas": ["readability", "maintainability"],
  "refactoringType": "suggestions"
}
```

### 12. `error_pattern_analysis`
**Purpose**: Analyze error patterns and suggest preventive measures
**Parameters**:
```json
{
  "errorHistory": [
    {
      "errorMessage": "TypeError: Cannot read property 'length' of undefined",
      "timestamp": "2024-01-15T10:00:00Z",
      "filePath": "utils.js",
      "language": "javascript",
      "fixed": true
    },
    {
      "errorMessage": "ReferenceError: variable is not defined",
      "timestamp": "2024-01-15T11:00:00Z",
      "filePath": "main.js",
      "language": "javascript",
      "fixed": false
    }
  ],
  "analysisDepth": "detailed"
}
```
**Expected Output**:
```json
{
  "patterns": [
    {
      "type": "null_undefined_access",
      "frequency": 5,
      "description": "Frequent attempts to access properties of null/undefined values",
      "affectedFiles": ["utils.js", "helpers.js"]
    }
  ],
  "recommendations": [
    "Implement null checks before property access",
    "Use optional chaining (?.) operator",
    "Add TypeScript for better type safety"
  ],
  "statistics": {
    "totalErrors": 2,
    "resolvedErrors": 1,
    "resolutionRate": 0.5,
    "byLanguage": [{ "javascript": 2 }],
    "byType": [{ "TypeError": 1, "ReferenceError": 1 }]
  },
  "trends": {
    "errorFrequencyTrend": { "trend": "increasing", "change": 0.2 },
    "mostCommonRecentErrors": ["TypeError", "ReferenceError"],
    "improvementAreas": ["null safety", "variable declaration"]
  }
}
```

## 🤖 Copilot-like Features

### 13. `chat_assistant`
**Purpose**: Interactive chat for code help and explanations
**Parameters**:
```json
{
  "query": "How do I handle async errors in JavaScript?",
  "context": "async function fetchData() { const response = await fetch('/api'); }",
  "language": "javascript"
}
```
**Expected Output**:
```json
{
  "response": "To handle async errors in JavaScript, you can use try-catch blocks with async/await or .catch() with promises. Here's how to improve your code:\n\n```javascript\nasync function fetchData() {\n  try {\n    const response = await fetch('/api');\n    if (!response.ok) throw new Error('Network error');\n    return await response.json();\n  } catch (error) {\n    console.error('Fetch failed:', error);\n    throw error;\n  }\n}\n```",
  "query": "How do I handle async errors in JavaScript?",
  "context": "async function fetchData() { const response = await fetch('/api'); }",
  "language": "javascript",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 14. `explain_code`
**Purpose**: Explain code functionality and structure
**Parameters**:
```json
{
  "code": "const memoize = (fn) => {\n  const cache = new Map();\n  return (...args) => {\n    const key = JSON.stringify(args);\n    if (cache.has(key)) return cache.get(key);\n    const result = fn(...args);\n    cache.set(key, result);\n    return result;\n  };\n};",
  "language": "javascript",
  "detail": "comprehensive"
}
```
**Expected Output**:
```json
{
  "explanation": "This is a memoization higher-order function that caches function results to improve performance:\n\n1. **Function Definition**: Takes a function `fn` as parameter\n2. **Cache Creation**: Creates a Map to store cached results\n3. **Returned Function**: Returns a new function that wraps the original\n4. **Key Generation**: Uses JSON.stringify to create cache keys from arguments\n5. **Cache Check**: Returns cached result if available\n6. **Computation**: Calls original function if not cached\n7. **Cache Storage**: Stores result for future use\n\nThis pattern is useful for expensive computations that are called repeatedly with the same arguments.",
  "code": "const memoize = (fn) => { ... }",
  "language": "javascript",
  "detail": "comprehensive",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 15. `refactor_code`
**Purpose**: Suggest code refactoring improvements
**Parameters**:
```json
{
  "code": "function calculateTotal(items) {\n  let total = 0;\n  for (let i = 0; i < items.length; i++) {\n    total += items[i].price * items[i].quantity;\n  }\n  return total;\n}",
  "language": "javascript",
  "focus": "readability"
}
```
**Expected Output**:
```json
{
  "originalCode": "function calculateTotal(items) { ... }",
  "refactoredCode": "const calculateTotal = (items) => {\n  return items.reduce((total, item) => {\n    return total + (item.price * item.quantity);\n  }, 0);\n};\n\n// Or more concise:\nconst calculateTotal = (items) => \n  items.reduce((total, item) => total + item.price * item.quantity, 0);",
  "language": "javascript",
  "focus": "readability",
  "improvements": [
    "Used array.reduce() for more functional approach",
    "Eliminated manual loop and index management",
    "More concise and expressive code"
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 16. `generate_tests`
**Purpose**: Generate unit tests for code
**Parameters**:
```json
{
  "code": "function isPalindrome(str) {\n  const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, '');\n  return cleaned === cleaned.split('').reverse().join('');\n}",
  "language": "javascript",
  "framework": "jest"
}
```
**Expected Output**:
```json
{
  "originalCode": "function isPalindrome(str) { ... }",
  "tests": "describe('isPalindrome', () => {\n  test('should return true for palindromes', () => {\n    expect(isPalindrome('racecar')).toBe(true);\n    expect(isPalindrome('A man a plan a canal Panama')).toBe(true);\n  });\n\n  test('should return false for non-palindromes', () => {\n    expect(isPalindrome('hello')).toBe(false);\n    expect(isPalindrome('world')).toBe(false);\n  });\n\n  test('should handle empty string', () => {\n    expect(isPalindrome('')).toBe(true);\n  });\n\n  test('should handle single character', () => {\n    expect(isPalindrome('a')).toBe(true);\n  });\n});",
  "language": "javascript",
  "framework": "jest",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 17. `generate_docs`
**Purpose**: Generate documentation for code
**Parameters**:
```json
{
  "code": "function debounce(func, wait, immediate) {\n  let timeout;\n  return function executedFunction(...args) {\n    const later = () => {\n      timeout = null;\n      if (!immediate) func.apply(this, args);\n    };\n    const callNow = immediate && !timeout;\n    clearTimeout(timeout);\n    timeout = setTimeout(later, wait);\n    if (callNow) func.apply(this, args);\n  };\n}",
  "language": "javascript",
  "style": "jsdoc"
}
```
**Expected Output**:
```json
{
  "originalCode": "function debounce(func, wait, immediate) { ... }",
  "documentation": "/**\n * Creates a debounced function that delays invoking func until after wait milliseconds\n * have elapsed since the last time the debounced function was invoked.\n * \n * @param {Function} func - The function to debounce\n * @param {number} wait - The number of milliseconds to delay\n * @param {boolean} [immediate=false] - If true, trigger the function on the leading edge\n * @returns {Function} The debounced function\n * \n * @example\n * const debouncedSave = debounce(saveData, 300);\n * input.addEventListener('input', debouncedSave);\n * \n * @example\n * // Immediate execution\n * const debouncedSubmit = debounce(submitForm, 1000, true);\n */\nfunction debounce(func, wait, immediate) {\n  // ... implementation\n}",
  "language": "javascript",
  "style": "jsdoc",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 18. `security_scan`
**Purpose**: Scan code for security vulnerabilities
**Parameters**:
```json
{
  "code": "app.get('/user/:id', (req, res) => {\n  const query = `SELECT * FROM users WHERE id = ${req.params.id}`;\n  db.query(query, (err, results) => {\n    res.json(results);\n  });\n});",
  "language": "javascript",
  "severity": "high"
}
```
**Expected Output**:
```json
{
  "code": "app.get('/user/:id', (req, res) => { ... }",
  "language": "javascript",
  "severity": "high",
  "vulnerabilities": [
    {
      "type": "sql_injection",
      "severity": "critical",
      "description": "SQL injection vulnerability in user ID parameter",
      "line": 2,
      "fix": "Use parameterized queries or prepared statements"
    }
  ],
  "scanResult": "Found 1 critical security vulnerability:\n\n1. SQL Injection (Line 2): Direct string interpolation in SQL query allows injection attacks.\n\nRecommended fix:\n```javascript\nconst query = 'SELECT * FROM users WHERE id = ?';\ndb.query(query, [req.params.id], (err, results) => {\n  res.json(results);\n});\n```",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 19. `optimize_performance`
**Purpose**: Suggest performance optimizations
**Parameters**:
```json
{
  "code": "function findUser(users, targetId) {\n  for (let i = 0; i < users.length; i++) {\n    if (users[i].id === targetId) {\n      return users[i];\n    }\n  }\n  return null;\n}",
  "language": "javascript",
  "target": "speed"
}
```
**Expected Output**:
```json
{
  "originalCode": "function findUser(users, targetId) { ... }",
  "optimizedCode": "// Option 1: Use built-in find method (most readable)\nconst findUser = (users, targetId) => \n  users.find(user => user.id === targetId) || null;\n\n// Option 2: Use Map for O(1) lookup if called frequently\nclass UserLookup {\n  constructor(users) {\n    this.userMap = new Map(users.map(user => [user.id, user]));\n  }\n  \n  findUser(targetId) {\n    return this.userMap.get(targetId) || null;\n  }\n}",
  "language": "javascript",
  "target": "speed",
  "improvements": [
    "Reduced time complexity from O(n) to O(1) with Map",
    "Used native find() method for better readability",
    "Eliminated manual loop management"
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 20. `translate_code`
**Purpose**: Convert code between programming languages
**Parameters**:
```json
{
  "code": "function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}",
  "fromLanguage": "javascript",
  "toLanguage": "python",
  "preserveComments": true
}
```
**Expected Output**:
```json
{
  "originalCode": "function factorial(n) { ... }",
  "translatedCode": "def factorial(n):\n    \"\"\"Calculate factorial of n recursively\"\"\"\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)",
  "fromLanguage": "javascript",
  "toLanguage": "python",
  "preserveComments": true,
  "notes": [
    "Converted function syntax to Python def",
    "Added docstring for documentation",
    "Maintained recursive logic structure"
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## ⚡ Real-time Features

### 21. `inline_suggestion`
**Purpose**: Real-time inline code suggestions as you type
**Parameters**:
```json
{
  "code": "const users = await fetch('/api/users');\nconst data = await users.",
  "position": { "line": 1, "character": 27 },
  "language": "javascript",
  "triggerKind": "typing",
  "context": {
    "fileName": "api.js",
    "openFiles": ["utils.js", "config.js"]
  }
}
```
**Expected Output**:
```json
{
  "suggestions": [
    { "text": "json()", "confidence": 0.9, "type": "method" },
    { "text": "text()", "confidence": 0.7, "type": "method" },
    { "text": "blob()", "confidence": 0.5, "type": "method" }
  ],
  "triggerKind": "typing",
  "position": { "line": 1, "character": 27 },
  "ghostText": "json()",
  "confidence": 0.9,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 22. `slash_command`
**Purpose**: Handle Copilot-style slash commands
**Parameters**:
```json
{
  "command": "/fix",
  "code": "function divide(a, b) {\n  return a / b;\n}",
  "language": "javascript",
  "context": "User wants to fix potential division by zero"
}
```
**Expected Output**:
```json
{
  "command": "/fix",
  "result": "Here's the fixed code with proper error handling:\n\n```javascript\nfunction divide(a, b) {\n  if (b === 0) {\n    throw new Error('Division by zero is not allowed');\n  }\n  return a / b;\n}\n\n// Alternative with default return:\nfunction divide(a, b) {\n  return b === 0 ? NaN : a / b;\n}\n```\n\nThe fix adds a check for zero division to prevent runtime errors.",
  "code": "function divide(a, b) { return a / b; }",
  "language": "javascript",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 23. `ghost_text`
**Purpose**: Generate ghost text for inline display in editor
**Parameters**:
```json
{
  "code": "const handleSubmit = async (event) => {\n  event.preventDefault();\n  ",
  "position": { "line": 2, "character": 2 },
  "language": "javascript",
  "maxLength": 80,
  "style": "completion"
}
```
**Expected Output**:
```json
{
  "ghostText": "const formData = new FormData(event.target);",
  "style": "completion",
  "confidence": 0.85,
  "position": { "line": 2, "character": 2 },
  "maxLength": 80,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## 🤖 Agent System

### 24. `agent_execute`
**Purpose**: Execute autonomous agent tasks
**Parameters**:
```json
{
  "taskId": "task-123",
  "type": "implement",
  "description": "Create a REST API endpoint for user authentication with JWT tokens",
  "context": {
    "workspacePath": "/project",
    "files": ["server.js", "routes/"],
    "language": "javascript"
  },
  "priority": "high"
}
```
**Expected Output**:
```json
{
  "taskId": "task-123",
  "success": true,
  "steps": [
    {
      "id": "step-1",
      "action": "Create authentication middleware",
      "status": "completed",
      "filesModified": ["middleware/auth.js"]
    },
    {
      "id": "step-2", 
      "action": "Implement login endpoint",
      "status": "completed",
      "filesModified": ["routes/auth.js"]
    }
  ],
  "summary": "Successfully implemented JWT authentication system with login/logout endpoints and middleware",
  "filesModified": ["middleware/auth.js", "routes/auth.js", "server.js"],
  "executionTime": 45000
}
```

### 25. `agent_plan`
**Purpose**: Plan agent workflow without execution
**Parameters**:
```json
{
  "taskId": "plan-456",
  "type": "refactor",
  "description": "Refactor monolithic Express app into microservices architecture",
  "context": {
    "workspacePath": "/monolith-app",
    "files": ["app.js", "routes/", "models/"],
    "language": "javascript"
  }
}
```
**Expected Output**:
```json
{
  "taskId": "plan-456",
  "steps": [
    {
      "id": "step-1",
      "action": "Analyze current monolithic structure",
      "tool": "project",
      "params": { "analysisType": "architecture" },
      "estimatedTime": 300
    },
    {
      "id": "step-2",
      "action": "Identify service boundaries",
      "tool": "code",
      "params": { "analysisType": "dependencies" },
      "estimatedTime": 600
    },
    {
      "id": "step-3",
      "action": "Create user service",
      "tool": "file",
      "params": { "serviceType": "user-management" },
      "estimatedTime": 900
    }
  ],
  "estimatedTime": 1800,
  "requiredApprovals": ["architecture-review", "database-migration"]
}
```

### 26. `agent_status`
**Purpose**: Get agent task status and active tasks
**Parameters**:
```json
{
  "taskId": "task-123"
}
```
**Expected Output**:
```json
{
  "taskId": "task-123",
  "status": "executing",
  "progress": {
    "currentStep": 2,
    "totalSteps": 4,
    "percentage": 50,
    "currentAction": "Implementing authentication middleware"
  },
  "startTime": "2024-01-15T10:00:00Z",
  "estimatedCompletion": "2024-01-15T10:05:00Z",
  "filesModified": ["middleware/auth.js"]
}
```

### 27. `complex_workflow`
**Purpose**: Execute complex multi-step autonomous workflows
**Parameters**:
```json
{
  "description": "Set up a complete React TypeScript project with testing, linting, and CI/CD pipeline",
  "context": {
    "workspacePath": "/new-project",
    "language": "typescript",
    "projectType": "react",
    "features": ["testing", "linting", "ci-cd"]
  },
  "autoApprove": false
}
```
**Expected Output**:
```json
{
  "taskId": "workflow-789",
  "success": true,
  "steps": [
    {
      "id": "init-project",
      "action": "Initialize React TypeScript project",
      "status": "completed",
      "filesCreated": ["package.json", "tsconfig.json", "src/App.tsx"]
    },
    {
      "id": "setup-testing",
      "action": "Configure Jest and React Testing Library",
      "status": "completed", 
      "filesCreated": ["jest.config.js", "src/setupTests.ts"]
    },
    {
      "id": "setup-linting",
      "action": "Configure ESLint and Prettier",
      "status": "completed",
      "filesCreated": [".eslintrc.js", ".prettierrc"]
    },
    {
      "id": "setup-cicd",
      "action": "Create GitHub Actions workflow",
      "status": "completed",
      "filesCreated": [".github/workflows/ci.yml"]
    }
  ],
  "summary": "Successfully created complete React TypeScript project with testing, linting, and CI/CD pipeline",
  "filesModified": 15,
  "executionTime": 120000
}
```

## 🔗 Integration Tools

### 28. `lsp_integration`
**Purpose**: Language Server Protocol integration for syntax awareness
**Parameters**:
```json
{
  "uri": "file:///project/src/utils.ts",
  "position": { "line": 10, "character": 15 },
  "language": "typescript",
  "syntaxTree": {
    "type": "FunctionDeclaration",
    "name": "processData",
    "parameters": ["data"]
  },
  "symbols": [
    { "name": "processData", "kind": "function", "line": 10 },
    { "name": "validateInput", "kind": "function", "line": 5 }
  ]
}
```
**Expected Output**:
```json
{
  "suggestions": [
    {
      "text": "data.map(item => item.value)",
      "confidence": 0.9,
      "type": "expression",
      "contextAware": true
    }
  ],
  "uri": "file:///project/src/utils.ts",
  "position": { "line": 10, "character": 15 },
  "symbolsCount": 2,
  "syntaxAware": true,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 29. `persistent_cache`
**Purpose**: Manage persistent suggestion cache across sessions
**Parameters**:
```json
{
  "action": "set",
  "key": "completion-cache-utils.ts-line-10",
  "value": {
    "suggestions": ["data.map", "data.filter", "data.reduce"],
    "confidence": 0.85,
    "context": "array processing"
  },
  "ttl": 3600
}
```
**Expected Output**:
```json
{
  "action": "set",
  "key": "completion-cache-utils.ts-line-10",
  "result": true,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 30. `workspace_analysis`
**Purpose**: Deep workspace analysis for better context understanding
**Parameters**:
```json
{
  "workspaceRoot": "/project",
  "includePatterns": ["**/*.{js,ts,jsx,tsx}"],
  "excludePatterns": ["**/node_modules/**", "**/dist/**"],
  "analysisDepth": "deep",
  "cacheResults": true
}
```
**Expected Output**:
```json
{
  "workspaceRoot": "/project",
  "analysis": {
    "fileCount": 150,
    "languages": ["typescript", "javascript", "jsx"],
    "frameworks": ["react", "express", "jest"],
    "dependencies": {
      "production": ["react", "express", "lodash"],
      "development": ["jest", "@types/node", "eslint"]
    },
    "structure": {
      "src": { "files": 80, "subdirs": 8 },
      "tests": { "files": 30, "subdirs": 3 },
      "docs": { "files": 5, "subdirs": 1 }
    },
    "codePatterns": [
      "Uses TypeScript with strict mode",
      "Follows React functional components pattern",
      "Uses async/await for asynchronous operations"
    ]
  },
  "filesAnalyzed": 150,
  "analysisDepth": "deep",
  "cached": true,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## 🎯 Usage Summary

### Most Common Tools:
1. **`code_completion`** - Real-time autocomplete
2. **`slash_command`** - Quick commands (/fix, /explain, etc.)
3. **`auto_error_fix`** - Automatic error resolution
4. **`chat_assistant`** - Interactive coding help
5. **`agent_execute`** - Autonomous task execution

### Tool Categories:
- **Core Tools** (3): Basic code operations
- **Error Fixing** (5): Automated error resolution
- **Analysis Tools** (4): Code analysis and insights
- **Copilot Features** (8): GitHub Copilot-like functionality
- **Real-time Features** (3): Live coding assistance
- **Agent System** (4): Autonomous coding agents
- **Integration Tools** (3): IDE and system integration

### Key Benefits:
- ✅ **AI-powered** code completion and generation
- ✅ **Automatic** error detection and fixing
- ✅ **Real-time** suggestions and assistance
- ✅ **Multi-language** support (JS, TS, Python, Java, etc.)
- ✅ **Context-aware** suggestions using project analysis
- ✅ **Autonomous** agents for complex tasks
- ✅ **Security** scanning and vulnerability detection
- ✅ **Performance** optimization suggestions

All tools are powered by local Ollama models, ensuring privacy and offline capability while providing GitHub Copilot-level functionality.