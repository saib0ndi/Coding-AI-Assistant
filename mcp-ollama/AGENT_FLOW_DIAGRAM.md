# Agent Flow & Orchestration Diagram

## 🔄 **Complete Agent Flow**

```
User Input → VS Code Extension → MCP Server → Agent Manager → Specific Agent → Ollama → Results
     ↑                                                              ↓
     └─────────────── Progress Updates & Results ←──────────────────┘
```

## 🏗️ **Detailed Agent Architecture**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              VS Code Extension                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                │
│  │   Chat UI       │  │ Agent Commands  │  │ Inline Suggest  │                │
│  │ (Ctrl+Shift+M)  │  │ (/dev /test)    │  │  (Ghost Text)   │                │
│  │                 │  │                 │  │                 │                │
│  │ - User queries  │  │ - /dev create   │  │ - Real-time     │                │
│  │ - Chat history  │  │ - /test fix     │  │ - Context-aware │                │
│  │ - Progress view │  │ - /review code  │  │ - Multi-model   │                │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────┘
                                │ MCP Protocol
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MCP Server                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                │
│  │ Request Router  │  │  Tool Registry  │  │ Context Manager │                │
│  │                 │  │                 │  │                 │                │
│  │ - Route to      │  │ - 80+ tools     │  │ - Multi-file    │                │
│  │   appropriate   │  │ - Tool calling  │  │ - Project ctx   │                │
│  │   agent         │  │ - Validation    │  │ - Memory        │                │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                │
│                                │                                               │
│                                ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                        Agent Manager                                    │  │
│  │                     (Main Orchestrator)                                 │  │
│  │                                                                         │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │  │
│  │  │ Task Routing    │  │ Workflow Exec   │  │ Progress Track  │        │  │
│  │  │ - Analyze req   │  │ - Multi-step    │  │ - Real-time     │        │  │
│  │  │ - Select agent  │  │ - Coordination  │  │ - Status update │        │  │
│  │  │ - Priority mgmt │  │ - Error handle  │  │ - User feedback │        │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Specialized Agents                                   │
│                                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌───────────┐ │
│  │ AutonomousAgent │  │   CodeAgent     │  │  ProjectAgent   │  │TestAgent  │ │
│  │                 │  │                 │  │                 │  │           │ │
│  │ 4-Phase Exec:   │  │ Specializes in: │  │ Handles:        │  │ Manages:  │ │
│  │ 1. Intent       │  │ - Code gen      │  │ - File ops      │  │ - Testing │ │
│  │ 2. Planning     │  │ - Bug fixing    │  │ - Dependencies  │  │ - Specs   │ │
│  │ 3. Execution    │  │ - Refactoring   │  │ - Build tasks   │  │ - Coverage│ │
│  │ 4. Validation   │  │ - Optimization  │  │ - Git ops       │  │ - Reports │ │
│  │                 │  │                 │  │                 │  │           │ │
│  │ Self-Correction │  │ Backup/Rollback │  │ Project Analysis│  │ Auto-gen  │ │
│  │ Risk Assessment │  │ Syntax Check    │  │ Structure Mgmt  │  │ Validation│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Ollama Provider                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                │
│  │ Model Selection │  │ Load Balancing  │  │ Response Cache  │                │
│  │ - Best for task │  │ - Multi-model   │  │ - Performance   │                │
│  │ - Fallback      │  │ - Consensus     │  │ - Smart cache   │                │
│  │ - Performance   │  │ - Reliability   │  │ - TTL mgmt      │                │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Remote Ollama Server                                      │
│                    http://10.10.110.25:11434                                   │
│                                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                │
│  │ deepseek-coder  │  │   llama3.3:70b  │  │   phi4:latest   │                │
│  │     v2:236b     │  │                 │  │                 │                │
│  │                 │  │ - Complex       │  │ - Fast          │                │
│  │ - Primary model │  │   reasoning     │  │   responses     │                │
│  │ - Code tasks    │  │ - Planning      │  │ - Simple tasks  │                │
│  │ - Bug fixing    │  │ - Analysis      │  │ - Completions   │                │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 🔄 **Agent Execution Flow Example**

### **User Request**: `/dev create a login system with JWT authentication`

```
Step 1: VS Code Extension
├── Receives command: "/dev create a login system with JWT authentication"
├── Parses command type: "agent_command" 
├── Extracts parameters: { command: "/dev", description: "create login system with JWT" }
└── Sends to MCP Server via protocol

Step 2: MCP Server (MCPServer.ts)
├── Receives tool call: "autonomous_execute"
├── Parameters: { description: "create login system with JWT", context: {...} }
├── Routes to AgentManager.executeAutonomously()
└── Starts autonomous execution

Step 3: Agent Manager (AgentManager.ts)
├── Creates task ID: "auto_1703123456789"
├── Calls AutonomousAgent.executeAutonomously()
├── Tracks progress and status
└── Manages workflow coordination

Step 4: Autonomous Agent (AutonomousAgent.ts)
├── Phase 1: Intent Analysis
│   ├── Analyzes: "create login system with JWT"
│   ├── Determines intent: "implement"
│   ├── Assesses complexity: 7/10
│   ├── Risk level: "medium"
│   └── Required tools: ["code", "file", "project", "test"]
│
├── Phase 2: Planning
│   ├── Creates execution plan with 6 steps:
│   │   1. Create authentication types/interfaces
│   │   2. Implement JWT utility functions  
│   │   3. Create login/register endpoints
│   │   4. Add middleware for auth validation
│   │   5. Generate unit tests
│   │   6. Update documentation
│   └── Risk assessment: medium (requires security validation)
│
├── Phase 3: Execution with Self-Correction
│   ├── Step 1: CodeAgent creates auth types
│   │   ├── Generates TypeScript interfaces
│   │   ├── Validates syntax
│   │   └── ✅ Success
│   │
│   ├── Step 2: CodeAgent implements JWT utils
│   │   ├── Creates jwt.ts with sign/verify functions
│   │   ├── Adds security best practices
│   │   ├── Validates implementation
│   │   └── ✅ Success
│   │
│   ├── Step 3: CodeAgent creates endpoints
│   │   ├── Generates login/register routes
│   │   ├── Adds input validation
│   │   ├── Implements error handling
│   │   └── ✅ Success
│   │
│   ├── Step 4: CodeAgent adds middleware
│   │   ├── Creates auth middleware
│   │   ├── Adds token validation
│   │   ├── Error: Missing error handling
│   │   ├── Self-correction: Adds try-catch blocks
│   │   └── ✅ Success (after correction)
│   │
│   ├── Step 5: TestAgent generates tests
│   │   ├── Creates comprehensive test suite
│   │   ├── Tests all endpoints and utilities
│   │   └── ✅ Success
│   │
│   └── Step 6: ProjectAgent updates docs
│       ├── Generates API documentation
│       ├── Adds usage examples
│       └── ✅ Success
│
└── Phase 4: Final Validation
    ├── Validates all files created
    ├── Runs security scan
    ├── Checks test coverage
    └── ✅ All validations pass

Step 5: Results Return
├── AgentManager receives results
├── Formats response with file list
├── MCP Server returns to VS Code
└── User sees completion notification

Files Created:
├── src/types/auth.ts (TypeScript interfaces)
├── src/utils/jwt.ts (JWT utilities)  
├── src/routes/auth.ts (Login/register endpoints)
├── src/middleware/auth.ts (Authentication middleware)
├── tests/auth.test.ts (Comprehensive tests)
└── docs/auth-api.md (API documentation)
```

## 🧠 **Agent Decision Making Process**

### **How Agents Choose Actions:**

```typescript
// 1. Intent Analysis (AutonomousAgent.ts)
async analyzeIntentAndContext(description: string, context: any) {
  // Uses deepseek-coder-v2:236b for complex analysis
  const analysis = await this.ollamaProvider.generateText({
    prompt: `Analyze request: "${description}"...`,
    model: 'deepseek-coder-v2:236b'
  })
  
  return {
    intent: 'implement|fix|test|analyze|refactor',
    complexity: 1-10,
    riskLevel: 'low|medium|high',
    tools: ['code', 'file', 'project', 'test'],
    estimatedSteps: 1-8
  }
}

// 2. Agent Selection (AgentManager.ts)
selectAgent(description: string, context: any) {
  if (description.includes('test')) return 'test'
  if (description.includes('file') || description.includes('create')) return 'file'  
  if (description.includes('project') || description.includes('build')) return 'project'
  return 'code' // Default for most coding tasks
}

// 3. Tool Selection (Each Agent)
inferTool(action: string) {
  if (action.includes('file')) return 'file_system_operation'
  if (action.includes('git')) return 'git_operation'
  if (action.includes('test')) return 'build_operation'
  return 'code_generation' // Default
}
```

## 🔧 **Agent Communication Protocol**

### **Inter-Agent Messages:**

```typescript
// Agents communicate through AgentManager
interface AgentMessage {
  from: 'autonomous' | 'code' | 'project' | 'test' | 'file'
  to: 'autonomous' | 'code' | 'project' | 'test' | 'file'
  type: 'request' | 'response' | 'notification'
  payload: {
    action: string
    params: any
    priority: 'low' | 'medium' | 'high'
  }
  taskId: string
}

// Example: CodeAgent requests ProjectAgent to install dependencies
const message = {
  from: 'code',
  to: 'project', 
  type: 'request',
  payload: {
    action: 'install_dependencies',
    params: { packages: ['jsonwebtoken', '@types/jsonwebtoken'] },
    priority: 'high'
  },
  taskId: 'auto_1703123456789'
}
```

## 📊 **Agent Performance Monitoring**

### **Real-time Metrics:**

```typescript
// Each agent reports metrics
interface AgentMetrics {
  taskId: string
  agentType: 'autonomous' | 'code' | 'project' | 'test' | 'file'
  phase: 'analyzing' | 'planning' | 'executing' | 'validating'
  progress: number // 0-100
  currentStep: string
  timeElapsed: number
  estimatedTimeRemaining: number
  corrections: number
  errors: number
}

// Progress updates sent to VS Code in real-time
const progressUpdate = {
  taskId: 'auto_1703123456789',
  progress: 65,
  message: 'Creating JWT authentication middleware...',
  phase: 'executing',
  step: '4/6',
  eta: '2 minutes remaining'
}
```

## 🎯 **Key Agent Capabilities**

### **What Makes Our Agents Special:**

1. **Self-Planning**: Agents create their own execution plans
2. **Self-Correcting**: Automatically fix mistakes without human intervention
3. **Risk-Aware**: Assess and mitigate risks before taking actions
4. **Multi-Agent**: Coordinate between specialized agents
5. **Progress Tracking**: Real-time updates on task progress
6. **Rollback Capable**: Can undo changes if something goes wrong
7. **Context-Aware**: Remember past conversations and learn from them

### **Agent Specializations:**

```typescript
const agentCapabilities = {
  AutonomousAgent: {
    planning: "Creates detailed execution plans",
    selfCorrection: "Fixes own mistakes automatically", 
    riskAssessment: "Evaluates changes before applying",
    coordination: "Manages multi-agent workflows"
  },
  
  CodeAgent: {
    codeGeneration: "Creates new code from descriptions",
    bugFixing: "Identifies and fixes code issues",
    refactoring: "Improves code structure and quality",
    validation: "Checks syntax and best practices"
  },
  
  ProjectAgent: {
    fileOperations: "Creates, moves, organizes files",
    dependencyManagement: "Handles package installations", 
    buildOperations: "Runs build, test, deploy commands",
    gitOperations: "Handles version control"
  },
  
  TestAgent: {
    testGeneration: "Creates comprehensive test suites",
    testExecution: "Runs tests and reports results",
    coverageAnalysis: "Analyzes test coverage",
    testOptimization: "Improves test performance"
  }
}
```

This agent architecture provides **true autonomous AI assistance** that can handle complex development tasks from planning to execution, with built-in error correction and progress tracking - essentially an AI team that works together to complete your development tasks.