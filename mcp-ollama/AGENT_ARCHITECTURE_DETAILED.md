# Agent Architecture & Orchestration

## 🤖 **What Kind of Agents We Have**

When someone asks "What kind of agents do you have?", here's what to say:

### **We have 4 types of AI agents:**

1. **Autonomous Agent** - Self-planning, self-correcting AI that can complete entire tasks
2. **Code Agent** - Specialized for code operations (write, fix, test, refactor)
3. **Project Agent** - Handles project-level operations (structure, dependencies, builds)
4. **Enhanced Agent Manager** - Orchestrates and coordinates all agents

## 🏗️ **Agent Architecture Flow**

```
User Request → VS Code Extension → MCP Server → Agent Manager → Specific Agent → Ollama Models
     ↑                                                              ↓
     └─────────────── Results with Progress Updates ←──────────────┘
```

## 🔄 **Complete Agent Orchestration**

### **Main Orchestration Hub: AgentManager.ts**

```typescript
// The central orchestrator that manages all agents
class AgentManager {
  private agents: Map<string, BaseAgent> = new Map()
  private activeWorkflows: Map<string, WorkflowExecution> = new Map()
  private taskQueue: PriorityQueue<AgentTask> = new PriorityQueue()
  
  // Main entry point for all agent operations
  async executeAutonomously(description: string, context: any): Promise<AgentResult>
}
```

### **Agent Hierarchy & Connections**

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentManager                             │
│  (Main Orchestrator - coordinates everything)               │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ AutonomousAgent │  │   CodeAgent     │  │ProjectAgent │ │
│  │ (Self-planning) │  │ (Code-specific) │  │(Project ops)│ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│           │                     │                   │       │
│           └─────────────────────┼───────────────────┘       │
│                                 │                           │
└─────────────────────────────────┼───────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │      OllamaProvider       │
                    │   (AI Model Interface)    │
                    └───────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    Remote Ollama Server   │
                    │  http://127.0.0.1:11434│
                    └───────────────────────────┘
```

## 📁 **File Connections & Dependencies**

### **Core Agent Files:**

```typescript
// 1. AgentManager.ts - Main orchestrator
src/agents/AgentManager.ts
├── Manages all agent instances
├── Routes requests to appropriate agents  
├── Handles workflow execution
└── Coordinates multi-agent tasks

// 2. AutonomousAgent.ts - Self-planning agent
src/agents/AutonomousAgent.ts  
├── 4-phase execution (Intent → Plan → Execute → Validate)
├── Self-correction capabilities
├── Risk assessment and rollback
└── Progress tracking

// 3. CodeAgent.ts - Code-specific operations
src/agents/CodeAgent.ts
├── Code generation and modification
├── Syntax validation and testing
├── Backup and rollback for code changes
└── Integration with build tools

// 4. EnhancedAgentManager.ts - Advanced orchestration
src/agents/EnhancedAgentManager.ts
├── Simplified interface for autonomous operations
├── Direct integration with AutonomousAgent
└── Streamlined workflow management
```

### **How Files Connect:**

```typescript
// Connection Flow:
MCPServer.ts 
  → imports AgentManager
  → AgentManager imports AutonomousAgent, CodeAgent, ProjectAgent
  → All agents use OllamaProvider
  → OllamaProvider connects to the configured Ollama server
```

## 🔧 **How We Built These Agents**

### **1. Base Agent Pattern**
```typescript
// All agents inherit from this base
abstract class BaseAgent {
  protected ollamaProvider: OllamaProvider
  protected logger: Logger
  
  abstract async execute(task: AgentTask): Promise<AgentResult>
  abstract async plan(task: AgentTask): Promise<ExecutionPlan>
  abstract async validate(result: AgentResult): Promise<ValidationResult>
}
```

### **2. Autonomous Agent Implementation**
```typescript
class AutonomousAgent extends BaseAgent {
  // 4-Phase Execution Model
  async execute(task: AgentTask): Promise<AgentResult> {
    const phases = [
      this.analyzeIntent(task),      // Phase 1: Understand what user wants
      this.createPlan(task),         // Phase 2: Break down into steps
      this.executeSteps(plan),       // Phase 3: Execute with validation
      this.validateAndCorrect(result) // Phase 4: Self-correction
    ]
    
    return await this.executePhases(phases)
  }
}
```

### **3. Agent Orchestration Logic**
```typescript
class AgentManager {
  async executeAutonomously(description: string, context: any) {
    // 1. Analyze request and select appropriate agent
    const agentType = await this.selectAgent(description, context)
    
    // 2. Create task with priority and context
    const task = this.createTask(description, context, agentType)
    
    // 3. Execute with the selected agent
    const agent = this.getAgent(agentType)
    const result = await agent.execute(task)
    
    // 4. Handle multi-agent coordination if needed
    if (result.requiresMultipleAgents) {
      return await this.coordinateMultipleAgents(task, result)
    }
    
    return result
  }
}
```

## 🎯 **Agent Specializations**

### **AutonomousAgent Capabilities:**
```typescript
const autonomousCapabilities = {
  planning: "Creates detailed execution plans",
  selfCorrection: "Fixes its own mistakes automatically",
  riskAssessment: "Evaluates changes before applying",
  progressTracking: "Real-time status updates",
  rollback: "Undoes changes if something goes wrong",
  multiStep: "Handles complex workflows end-to-end"
}
```

### **CodeAgent Specializations:**
```typescript
const codeAgentCapabilities = {
  codeGeneration: "Creates new code from descriptions",
  bugFixing: "Identifies and fixes code issues",
  refactoring: "Improves code structure and quality", 
  testing: "Generates and runs unit tests",
  validation: "Checks syntax and best practices",
  backup: "Creates backups before modifications"
}
```

### **ProjectAgent Specializations:**
```typescript
const projectAgentCapabilities = {
  projectAnalysis: "Analyzes entire project structure",
  dependencyManagement: "Handles package installations",
  buildOperations: "Runs build, test, and deploy commands",
  fileOperations: "Creates, moves, and organizes files",
  gitOperations: "Handles version control operations"
}
```

## 🔄 **Agent Communication Protocol**

### **Inter-Agent Communication:**
```typescript
// Agents communicate through the AgentManager
interface AgentMessage {
  from: string          // Source agent ID
  to: string           // Target agent ID  
  type: 'request' | 'response' | 'notification'
  payload: any         // Message data
  taskId: string       // Associated task
  priority: 'low' | 'medium' | 'high'
}

// Example: CodeAgent requests ProjectAgent to install dependencies
const message: AgentMessage = {
  from: 'code-agent',
  to: 'project-agent', 
  type: 'request',
  payload: { action: 'install', packages: ['express', 'typescript'] },
  taskId: 'task_123',
  priority: 'high'
}
```

## 🚀 **Real Agent Execution Example**

### **User Request:** "Create a REST API for user management"

```typescript
// 1. AgentManager receives request
const task = {
  id: 'task_user_api',
  description: 'Create a REST API for user management',
  type: 'implement',
  context: { workspacePath: '/project', language: 'typescript' }
}

// 2. AutonomousAgent takes over
const executionPlan = {
  phases: [
    "Analyze requirements for user management API",
    "Design API endpoints (CRUD operations)", 
    "Generate TypeScript interfaces and types",
    "Implement Express.js routes and controllers",
    "Add input validation and error handling",
    "Create database models and migrations",
    "Generate comprehensive unit tests",
    "Update API documentation"
  ]
}

// 3. Agent executes each phase with self-correction
for (const phase of executionPlan.phases) {
  const result = await this.executePhase(phase)
  if (!result.success) {
    await this.selfCorrect(phase, result.error)
  }
}

// 4. Final validation and delivery
const validation = await this.validateComplete(generatedFiles)
if (validation.isValid) {
  return {
    success: true,
    filesCreated: [
      'src/routes/userRoutes.ts',
      'src/controllers/userController.ts', 
      'src/models/User.ts',
      'src/middleware/validation.ts',
      'tests/user.test.ts',
      'docs/api.md'
    ],
    summary: 'Complete user management API created with tests and documentation'
  }
}
```

## 🔧 **Agent Tool Integration**

### **How Agents Use Tools:**
```typescript
class AutonomousAgent {
  async executeStep(step: ExecutionStep): Promise<StepResult> {
    // Agents can call any of the 80+ tools through the MCP server
    switch (step.type) {
      case 'generate_code':
        return await this.mcpServer.callTool('code_generation', step.params)
      
      case 'fix_errors':
        return await this.mcpServer.callTool('auto_error_fix', step.params)
        
      case 'run_tests':
        return await this.mcpServer.callTool('build_operation', {
          operation: 'test',
          workspacePath: step.workspacePath
        })
        
      case 'validate_security':
        return await this.mcpServer.callTool('security_scan', step.params)
    }
  }
}
```

## 📊 **Agent Performance & Monitoring**

### **Agent Metrics:**
```typescript
interface AgentMetrics {
  taskCompletionRate: number    // % of tasks completed successfully
  averageExecutionTime: number  // Average time per task
  selfCorrectionRate: number    // % of tasks that needed self-correction
  userSatisfactionScore: number // Based on user feedback
  errorRate: number            // % of tasks that failed
  toolUsageStats: Map<string, number> // Which tools are used most
}
```

### **Real-time Monitoring:**
```typescript
// Agents report progress in real-time
const progressUpdate = {
  taskId: 'task_123',
  phase: 'execution',
  step: 'generating_code',
  progress: 65,  // 65% complete
  message: 'Creating user controller with validation...',
  estimatedTimeRemaining: 45000 // 45 seconds
}
```

## 🎯 **Key Agent Advantages**

1. **Self-Planning**: Agents create their own execution plans
2. **Self-Correcting**: Automatically fix mistakes without human intervention  
3. **Multi-Agent Coordination**: Agents work together on complex tasks
4. **Tool Integration**: Access to 80+ specialized tools
5. **Progress Tracking**: Real-time updates on task progress
6. **Risk Management**: Backup and rollback capabilities
7. **Learning**: Agents improve based on past executions

## 🔗 **File Dependencies Summary**

```
Main Orchestration:
├── src/agents/AgentManager.ts (Central coordinator)
├── src/agents/EnhancedAgentManager.ts (Simplified interface)

Core Agents:
├── src/agents/AutonomousAgent.ts (Self-planning agent)
├── src/agents/CodeAgent.ts (Code operations)
├── src/agents/ProjectAgent.ts (Project operations)

Supporting Systems:
├── src/providers/OllamaProvider.ts (AI model interface)
├── src/server/MCPServer.ts (Tool registry & execution)
├── src/tools/ (80+ specialized tools)

VS Code Integration:
├── vscode-extension/src/agentCommands.ts (User interface)
├── vscode-extension/src/extension.ts (Extension entry point)
```

This agent architecture provides **autonomous AI assistance** that can handle complex development tasks from planning to execution, with built-in error correction and progress tracking - essentially creating an AI pair programmer that works independently while keeping you informed.
