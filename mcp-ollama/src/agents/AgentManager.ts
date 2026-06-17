import { Logger } from '../utils/Logger.js';
import { AgentOllamaRegistry } from '../providers/AgentOllamaRegistry.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AgentToolRegistry } from '../tools/AgentToolRegistry.js';
import { AgentTask, WorkflowPlan, WorkflowStep, AgentResult } from '../types/agent.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { CodeAgent } from './CodeAgent.js';
import { FileAgent } from './FileAgent.js';
import { ProjectAgent } from './ProjectAgent.js';
import { TestAgent } from './TestAgent.js';
import { WorkflowTemplates } from '../workflows/WorkflowTemplates.js';
import { WorkflowExecutor } from '../workflows/WorkflowExecutor.js';
import { AutonomousAgent } from './AutonomousAgent.js';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import { VectorStore } from '../semantic/VectorStore.js';
import { CodebaseIndexerRegistry } from '../indexing/CodebaseIndexerRegistry.js';
import {
    measureAgentPayload,
    type HallucinationMeasureContext,
} from '../quality/HallucinationDetector.js';
import { inferAgentTool, classifyTask } from './workflowRouting.js';
import { parseSimpleFsTask, buildSimpleFsAgentResult } from './simpleFsTasks.js';
import {
    routeCommand,
    routeCommandSmart,
    type SmartRouteDeps,
    type LlmIntentResult,
    type CommandRoute,
} from './intentRouter.js';
import { TaskPersistence } from './TaskPersistence.js';
import { withTrace } from '../utils/Tracing.js';
import { activeTasksGauge, agentErrorsTotal } from '../utils/Metrics.js';

export class AgentManager {
    private logger: Logger;
    private readonly ollamaRegistry: AgentOllamaRegistry;
    private ollamaProvider: OllamaProvider;
    private readonly toolRegistry: AgentToolRegistry;
    private fileSystemTool: FileSystemTool;
    private agents: Map<string, any>;
    private activeTasks: Map<string, AgentTask>;
    private workflowExecutor: WorkflowExecutor;
    private autonomousAgent: AutonomousAgent;
    private enhancedContext: EnhancedContextManager;
    private vectorStore: VectorStore;
    private conversationHistory: string[] = [];
    private warnedEmbedderFallback = false;
    private readonly taskPersistence: TaskPersistence;

    constructor(ollamaRegistry: AgentOllamaRegistry) {
        this.logger = new Logger();
        this.ollamaRegistry = ollamaRegistry;
        this.ollamaProvider = ollamaRegistry.getOrchestrator();
        this.toolRegistry = new AgentToolRegistry();
        this.fileSystemTool = this.toolRegistry.get('code');
        this.agents = new Map();
        this.activeTasks = new Map();
        
        this.initializeAgents();
        this.workflowExecutor = new WorkflowExecutor(this.agents);
        this.autonomousAgent = new AutonomousAgent(
            ollamaRegistry.get('autonomous'),
            this.toolRegistry.get('autonomous'),
            this.agents
        );
        this.enhancedContext = new EnhancedContextManager();
        this.vectorStore = new VectorStore();
        this.taskPersistence = new TaskPersistence();
    }

    getOllamaRegistry(): AgentOllamaRegistry {
        return this.ollamaRegistry;
    }

    /**
     * Ping each agent's Ollama provider and return a health map.
     * Call once at startup so misconfigured roles surface immediately.
     */
    async initialize(): Promise<{ healthy: boolean; agents: Record<string, boolean> }> {
        const roles = ['orchestrator', 'code', 'test', 'project', 'autonomous'] as const;
        const results: Record<string, boolean> = {};

        await Promise.all(roles.map(async role => {
            try {
                const ok = await this.ollamaRegistry.executeWithBreaker(role, () =>
                    this.ollamaRegistry.get(role).healthCheck()
                );
                results[role] = ok;
            } catch {
                results[role] = false;
            }
        }));

        const healthy = Object.values(results).some(Boolean);

        for (const [role, ok] of Object.entries(results)) {
            if (ok) {
                this.logger.info(`Agent provider [${role}]: reachable`);
            } else {
                this.logger.warn(`Agent provider [${role}]: UNREACHABLE — requests to this role will fail`);
            }
        }

        return { healthy, agents: results };
    }

    getAgentHealth(): Record<string, boolean> {
        const roles = ['orchestrator', 'code', 'test', 'project', 'autonomous'] as const;
        const result: Record<string, boolean> = {};
        for (const role of roles) {
            try {
                result[role] = this.ollamaRegistry.get(role) !== undefined;
            } catch {
                result[role] = false;
            }
        }
        return result;
    }

    getCircuitStats() {
        return this.ollamaRegistry.getCircuitStats();
    }

    private initializeAgents(): void {
        this.agents.set('code', new CodeAgent(this.ollamaRegistry.get('code'), this.toolRegistry.get('code')));
        this.agents.set('file', new FileAgent(this.toolRegistry.get('file')));
        this.agents.set('project', new ProjectAgent(this.ollamaRegistry.get('project'), this.toolRegistry.get('project')));
        this.agents.set('test', new TestAgent(this.ollamaRegistry.get('test'), this.toolRegistry.get('test')));
    }

    async executeTask(task: AgentTask, progressCallback?: (progress: number, step: string) => void): Promise<AgentResult> {
        const sanitizedTask = this.sanitizeTask(task);
        return withTrace(`task:${sanitizedTask.type}`, async () => {
            this.logger.info(`Starting agent task: ${sanitizedTask.id} - ${sanitizedTask.description}`);
            this.activeTasks.set(sanitizedTask.id, { ...sanitizedTask, status: 'planning' });
            this.taskPersistence.save({ ...sanitizedTask, status: 'planning' });
            activeTasksGauge.inc();

            try {
                const plan = await this.planWorkflow(sanitizedTask);
                this.taskPersistence.update(sanitizedTask.id, 'executing');
                const result = await this.executeWorkflow(plan, progressCallback);

                this.activeTasks.delete(sanitizedTask.id);
                this.taskPersistence.remove(sanitizedTask.id);
                activeTasksGauge.dec();
                return result;
            } catch (error) {
                this.logger.error(`Agent task failed: ${sanitizedTask.id}`, error);
                this.activeTasks.delete(sanitizedTask.id);
                this.taskPersistence.remove(sanitizedTask.id);
                activeTasksGauge.dec();
                agentErrorsTotal.inc({ type: sanitizedTask.type });

                return {
                    taskId: sanitizedTask.id,
                    success: false,
                    steps: [],
                    summary: `Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    filesModified: [],
                    error: error instanceof Error ? error.message : 'Unknown error'
                };
            }
        });
    }

    async planWorkflow(task: AgentTask): Promise<WorkflowPlan> {
        // Try to use predefined templates first
        const templateSteps = WorkflowTemplates.getTemplate(task.type, {
            language: task.context?.language,
            description: task.description,
            projectType: (task.context as any)?.projectType
        });

        if (templateSteps.length > 1) {
            const sensitiveTypes = new Set(['refactor', 'fix']);
            const requireApprovalForWrites = task.priority === 'high' || sensitiveTypes.has(task.type);
            const plan = {
                taskId: task.id,
                steps: templateSteps,
                estimatedTime: templateSteps.length * 45,
                requiredApprovals: requireApprovalForWrites
                    ? templateSteps.filter(s => s.tool === 'code' || s.tool === 'file').map(s => s.id)
                    : [],
            };
            return this.validatePlan(plan) ? plan : await this.fallbackPlanning(task);
        }

        return await this.fallbackPlanning(task);
    }

    private async fallbackPlanning(task: AgentTask): Promise<WorkflowPlan> {
        this.logger.info(`Running fast rule-based workflow planning for task ${task.id}`);
        const steps: WorkflowStep[] = [];
        const category = classifyTask(task.type, task.description);

        if (category === 'implement') {
            steps.push({
                id: 'step_0',
                action: `Analyze project files and context related to: ${task.description}`,
                tool: 'file',
                params: {},
                status: 'pending'
            });
            steps.push({
                id: 'step_1',
                action: `Implement requested implementation/fix: ${task.description}`,
                tool: 'code',
                params: {},
                status: 'pending',
                dependencies: ['step_0']
            });
            steps.push({
                id: 'step_2',
                action: 'Verify code correctness and run build',
                tool: 'project',
                params: {},
                status: 'pending',
                dependencies: ['step_1']
            });
        } else if (category === 'test') {
            steps.push({
                id: 'step_0',
                action: `Analyze code to generate tests for: ${task.description}`,
                tool: 'code',
                params: {},
                status: 'pending'
            });
            steps.push({
                id: 'step_1',
                action: `Generate and write test file for: ${task.description}`,
                tool: 'test',
                params: {},
                status: 'pending',
                dependencies: ['step_0']
            });
            steps.push({
                id: 'step_2',
                action: 'Run and verify generated tests',
                tool: 'test',
                params: {},
                status: 'pending',
                dependencies: ['step_1']
            });
        } else if (category === 'refactor') {
            steps.push({
                id: 'step_0',
                action: `Analyze code and structure for refactoring: ${task.description}`,
                tool: 'code',
                params: {},
                status: 'pending'
            });
            steps.push({
                id: 'step_1',
                action: `Refactor and optimize code: ${task.description}`,
                tool: 'code',
                params: {},
                status: 'pending',
                dependencies: ['step_0']
            });
            steps.push({
                id: 'step_2',
                action: 'Run build and verification to ensure no regression',
                tool: 'project',
                params: {},
                status: 'pending',
                dependencies: ['step_1']
            });
        } else {
            const tool = inferAgentTool(task.description);
            steps.push({
                id: 'step_0',
                action: `Analyze task context: ${task.description}`,
                tool: tool === 'code' ? 'file' : 'project',
                params: {},
                status: 'pending'
            });
            steps.push({
                id: 'step_1',
                action: `Execute task: ${task.description}`,
                tool: tool,
                params: {},
                status: 'pending',
                dependencies: ['step_0']
            });
        }

        // Steps that mutate the file system require approval when the task
        // priority is 'high' or the task type is 'refactor' or 'fix'.
        const sensitiveTypes = new Set(['refactor', 'fix']);
        const requireApprovalForWrites = task.priority === 'high' || sensitiveTypes.has(task.type);
        const requiredApprovals = requireApprovalForWrites
            ? steps.filter(s => s.tool === 'code' || s.tool === 'file').map(s => s.id)
            : [];

        const plan: WorkflowPlan = {
            taskId: task.id,
            steps,
            estimatedTime: steps.length * 45,
            requiredApprovals,
        };
        return plan;
    }

    private validatePlan(plan: WorkflowPlan): boolean {
        return plan.steps.length > 0 && 
               plan.steps.every(step => step.action && step.tool && this.agents.has(step.tool));
    }

    async executeWorkflow(plan: WorkflowPlan, progressCallback?: (progress: number, step: string) => void): Promise<AgentResult> {
        const task = this.activeTasks.get(plan.taskId);
        if (task) {
            task.status = 'executing';
        }

        const wrappedCallback = progressCallback ? (progress: number, step: string) => {
            progressCallback(progress, step);
            if (task) (task as any).progress = { current: progress, step };
        } : undefined;

        return await this.workflowExecutor.executeWorkflow(plan, task?.context || {}, wrappedCallback);
    }

    getTaskStatus(taskId: string): any | null {
        return this.activeTasks.get(taskId) || this.autonomousAgent.getTask(taskId) || null;
    }

    getAllActiveTasks(): any[] {
        const managerTasks = Array.from(this.activeTasks.values());
        const autoTasks = this.autonomousAgent ? this.autonomousAgent.getAllTasks() : [];
        return [...managerTasks, ...autoTasks];
    }

    getWorkflowProgress(taskId: string): any {
        const task = this.activeTasks.get(taskId);
        if (!task) return null;

        // Get the last executed plan for this task
        const steps = (task as any).currentSteps || [];
        return this.workflowExecutor.getExecutionProgress(steps);
    }

    // Autonomous task management
    getAutonomousTaskStatus(taskId: string): any {
        return this.getTaskStatus(taskId);
    }

    getAllAutonomousTasks(): any[] {
        return this.getAllActiveTasks().filter(task => task.id.startsWith('auto_'));
    }

    async executeComplexWorkflow(description: string, context: any): Promise<AgentResult> {
        const sanitizedDesc = this.sanitizeInput(description);
        
        // Enable autonomous mode for complex workflows
        if (context.autonomous !== false) {
            return await this.executeAutonomously(sanitizedDesc, context);
        }
        
        const task: AgentTask = {
            id: `complex_${Date.now()}`,
            type: this.inferTaskType(sanitizedDesc),
            description: sanitizedDesc,
            context: this.sanitizeContext(context),
            priority: 'high',
            status: 'pending'
        };

        return await this.executeTask(task);
    }

    // Verified autonomous execution (plan → execute → build/test verify → repair)
    async executeAutonomously(description: string, context: any, taskId?: string): Promise<AgentResult> {
        const sanitizedDesc = this.sanitizeInput(description);
        const sanitizedContext = this.sanitizeContext({
            ...context,
            workspacePath: context?.workspacePath || process.cwd(),
        });

        const route = await this.resolveRoute(sanitizedDesc, context);

        // Semantic NLP fast path for filesystem intents only (no LLM needed).
        // Other intents go through the autonomous pipeline below, which supports
        // preview diffs, file resolution, validation, and self-correction.
        const semanticFastPathIntents = ['create_directory', 'create_file'];
        if (
            context?.fast !== true &&
            context?.useNlpRouting !== false &&
            route.strategy === 'semantic_agent' &&
            semanticFastPathIntents.includes(route.semanticIntent)
        ) {
            try {
                const semanticAnalysis = await this.enhancedContext.enhanceWithSemanticContext(
                    sanitizedDesc,
                    { ...sanitizedContext, taskType: route.taskType, routedIntent: route.semanticIntent }
                );
                if (semanticAnalysis.confidence >= 0.65 && semanticAnalysis.intent !== 'unknown') {
                    const result = await this.executeWithIntegratedSemantics(semanticAnalysis, {
                        ...sanitizedContext,
                        taskType: route.taskType,
                    });
                    return this.mapToAgentResult(taskId || `auto_${Date.now()}`, result, Date.now());
                }
            } catch (error) {
                this.logger.warn(`NLP routing skipped: ${error instanceof Error ? error.message : error}`);
            }
        }

        const fsTask = route.simpleFsTask ?? parseSimpleFsTask(sanitizedDesc);
        if (fsTask) {
            const workspacePath = (sanitizedContext.workspacePath as string) || process.cwd();
            const result = buildSimpleFsAgentResult(taskId || `auto_${Date.now()}`, fsTask, workspacePath);
            return this.mapAutonomousResult(result, sanitizedContext, sanitizedDesc);
        }

        const enrichedContext = await this.enrichAgentContext(sanitizedDesc, {
            ...sanitizedContext,
            taskType: route.taskType,
            routedIntent: route.semanticIntent,
            routedTool: route.tool,
        });
        const result = await this.autonomousAgent.executeAutonomously(sanitizedDesc, enrichedContext, taskId);
        return this.mapAutonomousResult(result, enrichedContext, sanitizedDesc);
    }

    getAutonomousCapabilities(): Record<string, unknown> {
        return this.autonomousAgent.getCapabilities();
    }

    /**
     * Resolve the execution route using the phrasing-robust three-tier router
     * (regex → embedding → LLM). Falls back to the synchronous regex-only route
     * when NLP routing is disabled or fast mode is requested.
     */
    private async resolveRoute(description: string, context: any): Promise<CommandRoute> {
        const explicitType = context?.taskType as string | undefined;

        if (context?.fast === true || context?.useNlpRouting === false) {
            return routeCommand(description, explicitType);
        }

        const embedder = CodebaseIndexerRegistry.getEmbedder();
        const deps: SmartRouteDeps = { embedder };

        // Only enable the LLM tie-breaker tier when a dedicated fast model is
        // configured. Otherwise `getModel('fast')` falls back to the primary
        // (large) model, which is far too slow for per-request intent
        // classification; in that case we stay embedding-only.
        if (process.env.OLLAMA_FAST_MODEL) {
            deps.classifyByLlm = (desc) => this.classifyIntentWithLlm(desc);
        }

        try {
            const route = await routeCommandSmart(description, explicitType, deps);
            this.warnIfEmbedderDegraded(embedder);
            return route;
        } catch (error) {
            this.logger.warn(`Smart routing failed, using regex route: ${error instanceof Error ? error.message : error}`);
            return routeCommand(description, explicitType);
        }
    }

    /**
     * Surface embedding-tier degradation. When the embedder drops to the
     * hash-based fallback (e.g. the embed model/host is unreachable), the
     * semantic intent tier is effectively disabled and routing accuracy
     * collapses toward the regex baseline. Warn loudly once so the operator can
     * see it in the logs instead of silently losing comprehension quality.
     */
    private warnIfEmbedderDegraded(embedder: { getBackend?: () => string; getModel?: () => string }): void {
        if (this.warnedEmbedderFallback) return;
        if (typeof embedder.getBackend === 'function' && embedder.getBackend() === 'fallback') {
            this.warnedEmbedderFallback = true;
            const model = embedder.getModel?.() ?? 'unknown';
            this.logger.warn(
                `Embedding model '${model}' is unavailable — intent routing fell back to hash vectors. ` +
                `The semantic tier is DISABLED and accuracy will degrade toward the regex baseline. ` +
                `Ensure the embed model is pulled and OLLAMA_HOST is reachable (with OLLAMA_AUTH_TOKEN if required).`
            );
        }
    }

    /** Low-confidence fallback: ask a fast model to classify the intent. */
    private async classifyIntentWithLlm(description: string): Promise<LlmIntentResult | null> {
        try {
            const prompt =
                'Classify the developer request into exactly one intent.\n' +
                'Allowed intents: implement_feature, fix_code, refactor, generate_tests, review.\n' +
                'Respond with ONLY a JSON object of the form {"intent": "<one>", "confidence": <0..1>}.\n\n' +
                `Request: """${description.slice(0, 500)}"""`;

            const model = this.ollamaProvider.getModel(undefined, 'fast');
            const raw = await this.ollamaProvider.generateText({ prompt, model });
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) return null;

            const parsed = JSON.parse(match[0]) as { intent?: unknown; confidence?: unknown };
            if (typeof parsed.intent !== 'string') return null;

            const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.6;
            return { intent: parsed.intent, confidence };
        } catch {
            return null;
        }
    }

    private async enrichAgentContext(
        description: string,
        context: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const workspacePath = (context.workspacePath as string) || process.cwd();
        let enriched: Record<string, unknown> = { ...context };

        // Inject project rules (AGENTS.md / .coding-ai/rules / .cursor/rules)
        try {
            const { RulesLoader } = await import('../config/RulesLoader.js');
            const rules = RulesLoader.load(workspacePath);
            if (rules) enriched.projectRules = rules;
        } catch { /* best-effort */ }

        try {
            const indexer = CodebaseIndexerRegistry.get(workspacePath);
            await indexer.load();
            if (indexer.getStatus().chunkCount === 0) {
                await indexer.indexWorkspace();
            }
            const hits = await indexer.search(description, 8);
            enriched = {
                ...enriched,
                relevantChunks: hits.map((h) => ({
                    filePath: h.filePath,
                    symbolName: h.symbolName,
                    symbolType: h.symbolType,
                    startLine: h.startLine,
                    endLine: h.endLine,
                    score: h.score,
                    snippet: h.code.slice(0, 1500),
                })),
            };
        } catch (error) {
            this.logger.warn(`Codebase index context skipped: ${error instanceof Error ? error.message : error}`);
        }

        try {
            const { TransformerLikeContext } = await import('../tools/TransformerLikeContext.js');
            const chunks = (enriched.relevantChunks as Array<{ filePath: string; snippet?: string }>) || [];
            if (chunks.length > 0) {
                const transformer = new TransformerLikeContext();
                const history = chunks.map((c, i) => ({
                    role: 'system',
                    content: `[${c.filePath}]\n${(c.snippet || '').slice(0, 800)}`,
                    timestamp: Date.now() - (chunks.length - i) * 1000,
                }));
                const attention = await transformer.computeMultiHeadAttention(description, history, 4);
                const top = transformer.selectContextMessages(attention, 5);
                enriched.attentionContext = top.map((t) => t.message.content);
            }
        } catch (error) {
            this.logger.warn(`Transformer context skipped: ${error instanceof Error ? error.message : error}`);
        }

        return enriched;
    }

    private mapAutonomousResult(
        result: any,
        context?: Record<string, unknown>,
        description?: string
    ): AgentResult {
        const steps: WorkflowStep[] = (result.steps || []).map((s: any, i: number) => ({
            id: s.id || `step_${i}`,
            action: s.action || 'autonomous_step',
            tool: s.tool || 'code',
            params: s.params || {},
            status: s.success === false ? 'failed' : 'completed',
            result: s.result,
            error: s.error,
        }));

        const proposedChanges = this.collectProposedChanges(result, steps);

        let hallucination = result.hallucination;
        if (!hallucination) {
            const measureCtx: HallucinationMeasureContext = {};
            if (description) measureCtx.taskDescription = description;
            if (typeof context?.workspacePath === 'string') {
                measureCtx.workspacePath = context.workspacePath;
            }
            if (Array.isArray(context?.files)) {
                measureCtx.files = context.files as string[];
            }
            if (proposedChanges?.length) {
                measureCtx.outputFilePaths = proposedChanges.map((c) => c.filePath);
            }
            if (result.taskId) measureCtx.taskId = result.taskId;
            measureCtx.taskType = (context?.taskType as string) || 'unknown';
            const measurePayload: {
                proposedChanges?: Array<{ modified?: string; original?: string }>;
                steps?: Array<{ result?: any }>;
            } = { steps: result.steps };
            if (proposedChanges?.length) {
                measurePayload.proposedChanges = proposedChanges;
            }
            hallucination = measureAgentPayload(measurePayload, measureCtx, true);
        }

        return {
            taskId: result.taskId,
            success: result.success,
            steps,
            summary: result.summary,
            filesModified: result.filesModified || [],
            proposedChanges: proposedChanges ?? [],
            executionTime: result.executionTime,
            autonomous: true,
            verification: result.verification,
            verified: result.verified,
            error: result.error,
            hallucination,
        };
    }

    private collectProposedChanges(result: any, steps: WorkflowStep[]): AgentResult['proposedChanges'] {
        const direct = Array.isArray(result.proposedChanges) ? result.proposedChanges : [];
        const fromSteps = steps.flatMap((s) => s.result?.proposedChanges || []);
        const merged = [...direct, ...fromSteps];
        const seen = new Set<string>();
        return merged.filter((change) => {
            if (!change?.filePath || seen.has(change.filePath)) return false;
            seen.add(change.filePath);
            return true;
        });
    }

    private mapToAgentResult(taskId: string, result: any, startTime: number): AgentResult {
        return {
            taskId,
            success: result.success,
            steps: result.steps || [],
            summary: result.summary || '',
            filesModified: result.filesModified || [],
            executionTime: Date.now() - startTime,
            autonomous: true,
            verified: true,
        };
    }

    private async executeWithIntegratedSemantics(analysis: any, context: any): Promise<any> {
        const { intent, target, semanticMatches, similarCode } = analysis;
        
        // Enhanced context with integrated NLP and semantic data
        const enhancedContext = {
            ...context,
            semanticMatches,
            similarCode,
            nlpAnalysis: analysis
        };
        
        switch (intent) {
            case 'create_directory':
                return await this.executeCreateDirectory(target, enhancedContext);
            
            case 'create_file':
                return await this.executeCreateFile(target, enhancedContext);
            
            case 'implement_feature':
                return await this.executeImplementFeature(target, enhancedContext);
            
            case 'fix_code':
                return await this.executeFixCode(target, enhancedContext);
            
            case 'generate_tests':
                return await this.executeGenerateTests(target, enhancedContext);
            
            default:
                return await this.executeFallback(target || 'unknown task', enhancedContext, 'unknown', Date.now());
        }
    }
    
    private async executeCreateDirectory(dirName: string, context: any): Promise<any> {
        const workspacePath = (context?.workspacePath as string) || process.cwd();
        const { executeMkdirTask } = await import('./simpleFsTasks.js');
        const relativePath = dirName.replace(/^\.\/+/, '');
        try {
            const outcome = executeMkdirTask({ type: 'mkdir', relativePath }, workspacePath);
            if (!outcome.success) {
                return {
                    success: false,
                    summary: `Failed to create directory: ${outcome.error}`,
                    filesModified: [],
                    error: outcome.error,
                };
            }
            const label = outcome.created ? 'Created directory' : 'Directory already exists';
            return {
                success: true,
                summary: `${label}: ${outcome.fullPath}`,
                filesModified: outcome.created ? [outcome.fullPath] : [],
                steps: [{
                    id: 'create_dir',
                    action: 'create_directory',
                    tool: 'file',
                    params: { path: outcome.fullPath },
                    status: 'completed',
                }],
            };
        } catch (error) {
            return {
                success: false,
                summary: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filesModified: [],
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    
    private async executeCreateFile(fileName: string, context: any): Promise<any> {
        const workspacePath = (context?.workspacePath as string) || process.cwd();
        const { executeCreateFileTask } = await import('./simpleFsTasks.js');
        const relativePath = fileName.replace(/^\.\/+/, '');
        const outcome = executeCreateFileTask(
            { type: 'create_file', relativePath, content: '' },
            workspacePath
        );
        if (!outcome.success) {
            return {
                success: false,
                summary: `Failed to create file: ${outcome.error}`,
                filesModified: [],
                error: outcome.error,
            };
        }
        const label = outcome.created ? 'Created file' : 'File already exists';
        return {
            success: true,
            summary: `${label}: ${outcome.fullPath}`,
            filesModified: outcome.created ? [outcome.fullPath] : [],
            steps: [{
                id: 'create_file',
                action: 'create_file',
                tool: 'file',
                params: { path: outcome.fullPath },
                status: 'completed',
            }],
        };
    }
    
    private async executeImplementFeature(feature: string, context: any): Promise<any> {
        const agent = this.agents.get('code');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'implement_feature',
                params: { feature, language: context.language || 'typescript' },
                context
            });
        }
        return { success: false, summary: 'Code agent not available' };
    }
    
    private async executeFixCode(issue: string, context: any): Promise<any> {
        const agent = this.agents.get('code');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'fix_code',
                params: { issue, language: context.language || 'typescript' },
                context
            });
        }
        return { success: false, summary: 'Code agent not available' };
    }
    
    private async executeGenerateTests(target: string, context: any): Promise<any> {
        const agent = this.agents.get('test');
        if (agent && agent.execute) {
            return await agent.execute({
                action: 'generate_tests',
                params: { target, language: context.language || 'typescript' },
                context
            });
        }
        return { success: false, summary: 'Test agent not available' };
    }
    
    private async executeFallback(description: string, context: any, taskId: string, startTime: number): Promise<any> {
        // Original fast execution as fallback
        const agent = this.agents.get('code');
        if (agent && agent.execute) {
            const result = await agent.execute({
                action: description,
                params: { language: context.language || 'typescript' },
                context
            });
            return {
                success: true,
                summary: `Completed: ${description}`,
                filesModified: result.filesModified || [],
                steps: [{ id: 'fallback_step', action: description, tool: 'code', params: {}, status: 'completed' }]
            };
        }
        
        return {
            success: false,
            summary: `Failed: ${description}`,
            filesModified: [],
            error: 'No suitable agent available'
        };
    }

    private inferTaskType(description: string): 'implement' | 'fix' | 'test' | 'refactor' | 'analyze' {
        const desc = this.sanitizeInput(description).toLowerCase();
        const keywords = {
            implement: ['implement', 'create', 'add', 'build', 'develop', 'write'],
            fix: ['fix', 'error', 'bug', 'issue', 'resolve', 'repair'],
            test: ['test', 'testing', 'spec', 'unit', 'integration'],
            refactor: ['refactor', 'improve', 'optimize', 'clean', 'restructure'],
            analyze: ['analyze', 'review', 'check', 'examine', 'audit']
        };
        
        for (const [type, words] of Object.entries(keywords)) {
            if (words.some(word => desc.includes(word))) {
                return type as 'implement' | 'fix' | 'test' | 'refactor' | 'analyze';
            }
        }
        return 'implement';
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').substring(0, 2000);
    }

    private sanitizePathSegment(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>"'&;\\`$(){}\[\]|]/g, '').substring(0, 500);
    }

    private sanitizeContext(context: any): any {
        if (!context || typeof context !== 'object') return {};
        const sanitized: any = {};
        const allowedKeys = ['language', 'workspacePath', 'files', 'projectType', 'verify', 'fast', 'useNlpRouting', 'previewChanges', 'relevantChunks', 'taskType', 'routedIntent', 'routedTool'];
        
        for (const key of allowedKeys) {
            if (context[key] !== undefined && context[key] !== null) {
                if (typeof context[key] === 'string') {
                    sanitized[key] = this.sanitizeInput(context[key]);
                } else if (Array.isArray(context[key])) {
                    sanitized[key] = key === 'relevantChunks'
                        ? context[key].slice(0, 8)
                        : context[key].slice(0, 10).map((item: any) =>
                            typeof item === 'string' ? this.sanitizePathSegment(item) : item
                          );
                } else {
                    sanitized[key] = context[key];
                }
            }
        }
        return sanitized;
    }

    private sanitizeTask(task: AgentTask): AgentTask {
        return {
            id: this.sanitizeInput(task.id),
            type: task.type,
            description: this.sanitizeInput(task.description),
            context: this.sanitizeContext(task.context),
            priority: task.priority,
            status: task.status
        };
    }
}
