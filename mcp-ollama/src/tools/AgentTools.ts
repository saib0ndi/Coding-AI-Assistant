/**
 * Agent tools: agent_execute, agent_plan, agent_status, verify_workspace, complex_workflow
 */
import { ToolDependencies, MCPTool } from './ToolDependencies.js';
import { createTool, withErrorHandling } from './toolHelper.js';
import { AgentTask } from '../types/agent.js';
import { buildSimpleFsAgentResult } from '../agents/simpleFsTasks.js';
import { routeCommand } from '../agents/intentRouter.js';

export function createAgentTools(deps: ToolDependencies): MCPTool[] {
  return [
    createAgentExecuteTool(deps),
    createAgentCapabilitiesTool(deps),
    createAgentPlanTool(deps),
    createAgentStatusTool(deps),
    createVerifyWorkspaceTool(deps),
    createComplexWorkflowTool(deps),
  ];
}

function createAgentCapabilitiesTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'agent_capabilities',
    'List supported agent task types, intents, and execution strategies',
    {},
    [],
    async () => {
      const autonomous = deps.agentManager.getAutonomousCapabilities?.() ?? {};
      return {
        taskTypes: ['implement', 'fix', 'test', 'refactor', 'analyze'],
        agents: ['code', 'file', 'project', 'test'],
        intents: [
          'create_directory', 'create_file', 'implement_feature',
          'fix_code', 'generate_tests', 'refactor',
        ],
        strategies: {
          fast_fs: 'Instant mkdir/touch — no LLM (e.g. "create folder X")',
          semantic_agent: 'High-confidence intent → specialized agent',
          autonomous: 'Plan → execute → verify with self-correction',
        },
        examples: [
          'create a folder inside mcp-ollama with the name sai',
          'create a file inside src with the name utils.ts',
          'fix the bug in AuthService.ts',
          'generate unit tests for UserService',
          'implement user authentication with JWT',
          'refactor the login handler',
        ],
        defaults: {
          useNlpRouting: true,
          previewChanges: true,
        },
        ...autonomous,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// agent_execute
// ---------------------------------------------------------------------------
function createAgentExecuteTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'agent_execute',
    'Execute autonomous agent tasks (implement, fix, test, refactor)',
    {
      taskId: { type: 'string', description: 'Unique task identifier' },
      type: { type: 'string', enum: ['implement', 'fix', 'test', 'refactor', 'analyze'], description: 'Task type' },
      description: { type: 'string', description: 'Task description' },
      context: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          language: { type: 'string' }
        }
      },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority', default: 'medium' }
    },
    ['description'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { taskId, type = 'implement', description, context = {}, priority = 'medium' } = params as {
            taskId?: string; type?: string; description?: string; context?: any; priority?: string;
          };

          if (!description) {
            throw new Error('Missing required parameter: description');
          }

          const workspacePath = context.workspacePath || process.cwd();
          const route = routeCommand(description, type);

          if (route.simpleFsTask) {
            return buildSimpleFsAgentResult(taskId || `quick_${Date.now()}`, route.simpleFsTask, workspacePath);
          }

          const agentTypes = ['implement', 'fix', 'test', 'refactor', 'analyze'];
          const resolvedType = route.taskType;
          if (agentTypes.includes(resolvedType)) {
            return await deps.agentManager.executeAutonomously(description, {
              ...context,
              workspacePath,
              verify: context.verify !== false,
              useNlpRouting: context.useNlpRouting !== false,
              taskType: resolvedType,
              routedIntent: route.semanticIntent,
              routedTool: route.tool,
            }, taskId);
          }

          const task: AgentTask = {
            id: taskId || `task_${Date.now()}`,
            type: type as any,
            description,
            context,
            priority: priority as any,
            status: 'pending'
          };

          const result = await deps.agentManager.executeTask(task);
          return result;
        },
        () => ({
          taskId: '',
          success: false,
          steps: [],
          summary: 'Agent execution failed',
          filesModified: [],
          error: 'Agent execution handler failed'
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// agent_plan
// ---------------------------------------------------------------------------
function createAgentPlanTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'agent_plan',
    'Plan agent workflow without execution',
    {
      taskId: { type: 'string', description: 'Unique task identifier' },
      type: { type: 'string', enum: ['implement', 'fix', 'test', 'refactor', 'analyze'], description: 'Task type' },
      description: { type: 'string', description: 'Task description' },
      context: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          language: { type: 'string' }
        }
      },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority', default: 'medium' }
    },
    ['description'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { taskId, type = 'implement', description, context = {}, priority = 'medium' } = params as {
            taskId?: string; type?: string; description?: string; context?: any; priority?: string;
          };

          if (!description) {
            throw new Error('Missing required parameter: description');
          }

          const task: AgentTask = {
            id: taskId || `task_${Date.now()}`,
            type: type as any,
            description,
            context,
            priority: priority as any,
            status: 'pending'
          };

          const plan = await deps.agentManager.planWorkflow(task);
          return plan;
        },
        () => ({
          taskId: '',
          steps: [],
          estimatedTime: 0,
          requiredApprovals: [],
          error: 'Agent planning failed'
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// agent_status
// ---------------------------------------------------------------------------
function createAgentStatusTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'agent_status',
    'Get agent task status and active tasks',
    {
      taskId: { type: 'string', description: 'Task ID to check (optional)' }
    },
    [],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { taskId } = params as { taskId?: string };

          if (taskId) {
            const status = deps.agentManager.getTaskStatus(taskId);
            return status || { error: 'Task not found' };
          }

          return {
            activeTasks: deps.agentManager.getAllActiveTasks()
          };
        },
        () => ({
          activeTasks: []
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// verify_workspace
// ---------------------------------------------------------------------------
function createVerifyWorkspaceTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'verify_workspace',
    'Run typecheck, build, and test scripts for the workspace',
    {
      workspacePath: { type: 'string', description: 'Project root path' },
    },
    [],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { workspacePath } = (params || {}) as { workspacePath?: string };
          const root = workspacePath || process.cwd();
          const result = await deps.projectVerifier.verify(root);
          return {
            passed: result.passed,
            verified: result.passed,
            summary: result.summary,
            workspacePath: result.workspacePath,
            profile: result.profile,
            verification: {
              passed: result.passed,
              summary: result.summary,
              checks: result.checks.map((c) => ({
                name: c.name,
                command: c.command,
                passed: c.passed,
                exitCode: c.exitCode,
                skipped: c.skipped,
              })),
            },
            checks: result.checks,
          };
        },
        () => ({
          passed: false,
          verified: false,
          summary: 'Verification failed',
          workspacePath: process.cwd(),
          profile: { buildSystem: 'unknown' as const, hasTypeScript: false, scripts: {} },
          verification: { passed: false, summary: 'Verification handler failed', checks: [] },
          checks: [],
        }),
        deps.logger
      );
    }
  );
}

// ---------------------------------------------------------------------------
// complex_workflow
// ---------------------------------------------------------------------------
function createComplexWorkflowTool(deps: ToolDependencies): MCPTool {
  return createTool(
    'complex_workflow',
    'Execute complex multi-step autonomous workflows',
    {
      description: { type: 'string', description: 'High-level description of what to accomplish' },
      context: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          language: { type: 'string' },
          projectType: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } }
        }
      },
      autoApprove: { type: 'boolean', description: 'Auto-approve all steps', default: false }
    },
    ['description'],
    async (params: unknown) => {
      return withErrorHandling(
        async () => {
          const { description, context = {}, autoApprove = false, autonomous = true } = params as {
            description?: string; context?: any; autoApprove?: boolean; autonomous?: boolean;
          };

          if (!description) {
            throw new Error('Missing required parameter: description');
          }

          const result = await deps.agentManager.executeComplexWorkflow(description, {
            ...context,
            autoApprove,
            autonomous
          });
          
          return result;
        },
        () => ({
          taskId: '',
          success: false,
          steps: [],
          summary: 'Complex workflow execution failed',
          filesModified: [],
          error: 'Complex workflow handler failed'
        }),
        deps.logger
      );
    }
  );
}
