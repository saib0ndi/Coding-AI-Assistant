# mcp-ollama — Detailed Codebase Documentation

## What is this project?

`mcp-ollama` is a **Model Context Protocol (MCP) server** that bridges the Cursor IDE to locally-running Ollama LLMs. It exposes a rich set of tools for autonomous code generation, analysis, refactoring, testing, and project management — all running on your own machine with zero cloud dependency.

When Cursor calls a tool (like "generate code" or "execute agent task"), this server receives that call, orchestrates one or more local LLM interactions, operates on your workspace files, and returns structured results back to Cursor.

---

## Entry Point

### `src/index.ts`

The application bootstraps here. It:
1. Loads `AppConfig` (ports, Ollama URL, model names, flags)
2. Instantiates `AgentOllamaRegistry` (wires each agent to its Ollama model)
3. Starts `MCPServer` (for Cursor IDE protocol)
4. Starts `HTTPServer` (for REST clients or scripts)

---

## `src/server/` — Transport Layer

This is the front door of the system. All external requests enter here.

### `MCPServer.ts`

The core MCP protocol handler. Cursor IDE sends JSON-RPC style "tool call" requests here. This file registers every available tool and dispatches calls to the correct handler. It also handles the MCP handshake, capability negotiation, and error formatting.

### `MCPServerEnhanced.ts`

An extended variant of `MCPServer` with additional tool registrations — primarily the more advanced agent tools like autonomous execution, code health, and GitHub integration.

### `HTTPServer.ts`

A standard Express/Node HTTP REST API. This lets non-Cursor clients (scripts, other editors, CI pipelines) call the same tools via regular HTTP `POST` requests. Useful for testing and automation.

### `RequestRouter.ts`

Receives a parsed request (from either MCP or HTTP) and routes it to the correct tool handler based on the tool name. Acts as a dispatcher — it doesn't have business logic of its own.

---

## `src/agents/` — The Brain

This is the most important directory. It contains all orchestration logic, agent implementations, planning, routing, and autonomous execution.

### `AgentManager.ts`

The top-level orchestrator. This is the main class the server instantiates. It:
- Holds all four specialized agents (`CodeAgent`, `FileAgent`, `ProjectAgent`, `TestAgent`) in a `Map`
- Holds the `AutonomousAgent`, `WorkflowExecutor`, `EnhancedContextManager`, and `VectorStore`
- Exposes `executeTask()` for structured tasks and `executeAutonomously()` for free-form autonomous runs
- On `executeAutonomously()`, it first runs `routeCommand()` to pick a strategy, then optionally enriches context (codebase index + attention), then delegates to `AutonomousAgent`
- Also does input sanitization (strips control characters, limits lengths, whitelists context keys)

### `AutonomousAgent.ts`

The core of autonomous operation. The `executeAutonomously()` method runs the full 5-phase pipeline:

**Phase 1 — Analyze (5% → 15% progress)**
Calls `routeCommand()` and `assessRisk()` to determine intent, task type, tool selection, and risk level (low / medium / high).

**Phase 2 — Plan (15% → 25% progress)**
- If `isComplexTask()` scores the description ≥ 2 (multi-component, conjunctions, sentences, length), it calls `generateLlmPlan()` to get a structured JSON plan from Ollama (2–8 typed steps)
- For simple tasks, it builds a rule-based plan directly (1–2 steps)

**Phase 3 — Execute with Self-Correction (25% → 75% progress)**
For each step in the plan:
- Picks the correct agent from the map (`code`, `file`, `project`, `test`)
- Calls `agent.executeStep()` or `agent.execute()`
- Validates the result with `validateStepResult()` — first using fast heuristics (no LLM), then with an Ollama "VALID/INVALID" call only as a last resort
- If invalid, calls `generateCorrection()` which asks Ollama to produce revised params/action in JSON
- Retries up to `maxAttempts` (1–2 per step)
- `critical: true` steps abort the whole pipeline on failure; non-critical steps are skipped and logged

**Phase 4 — Verify (75% → 90% progress)**
`ProjectVerifier.verify()` runs the real build and test commands in the workspace. This checks whether the code the agent wrote actually compiles and passes tests.

**Phase 5 — Repair loop (up to 2 attempts)**
If verification fails, the failure log is sent to the `CodeAgent` as context. The agent attempts to auto-repair the modified files. Verification re-runs after each repair attempt.

**Final step — Hallucination scoring**
`measureAgentPayload()` scores the output: checks proposed file paths against real workspace paths, evaluates content groundedness, and returns a `HallucinationSummary` attached to the result.

The `AutonomousTask` also supports `pauseTask()`, `resumeTask()`, and `cancelTask()` — the pipeline checks `task.status === 'paused'` between steps and waits in a polling loop.

### `intentRouter.ts`

The single unified entry point for understanding what a user wants. The `routeCommand()` function maps any natural language description into a `CommandRoute` object containing:

- `taskType` — `implement | fix | test | refactor | analyze`
- `semanticIntent` — fine-grained intent like `create_directory`, `generate_tests`, `fix_code`
- `tool` — which agent should handle it (`code`, `file`, `test`, `project`)
- `strategy` — one of three:
  - `fast_fs` — matched by regex, no LLM at all (for mkdir/touch/create file commands)
  - `semantic_agent` — VectorStore NLP confidence ≥ 0.7, uses a fast semantic path
  - `autonomous` — everything else goes through the full pipeline
- `confidence` — 0.0–1.0 confidence score
- `simpleFsTask` — pre-parsed `MkdirTask` or `CreateFileTask` if applicable

It also exports `isChatOnlyQuestion()` which detects greetings, pure questions, and non-actionable text so the server can respond with chat instead of agent execution.

### `workflowRouting.ts`

Pure, testable rule-based helpers with no LLM calls:
- `inferAgentTool(action)` — returns `code | file | test | project` based on keywords in the action string
- `classifyTask(type, description)` — returns a `WorkflowCategory` (`implement | test | refactor | general`) used by `AgentManager.fallbackPlanning()`

### `llmPlanner.ts`

Called only for complex tasks (as judged by `isComplexTask()`). It:
1. Scans the workspace with `scanProject()` and renders a project summary (file tree, key files, detected language)
2. Sends a structured prompt to Ollama asking for a JSON plan with typed steps
3. Parses and validates the JSON — strips markdown fences, extracts the JSON object, validates each step
4. Maps raw steps to `AutonomousStep` objects with security checks (path traversal prevention, path existence check)
5. Rejects plans with fewer than 2 usable steps or no concrete file work
6. Falls back to `null` on any failure, letting the caller use rule-based planning

Valid step kinds: `mkdir`, `create_file`, `edit_file`, `generate_tests`, `run_tests`, `review`

### `simpleFsTasks.ts`

Handles the simplest possible requests — creating a directory or an empty file — with pure regex parsing and direct `fs` calls. Zero LLM involvement.

- `parseMkdirTask(description)` — recognizes "create folder X", "mkdir X", "make directory X in Y", "folder named X inside Y"
- `parseCreateFileTask(description)` — recognizes "create file X", "touch X", "file named X inside Y"
- `executeMkdirTask()` / `executeCreateFileTask()` — actually call `fs.mkdirSync` / `fs.writeFileSync`
- `buildSimpleFsAgentResult()` — wraps the outcome in the standard `AgentResult` shape

### `projectScanner.ts`

Walks the workspace directory tree and produces a human-readable project summary for LLM context. It detects the project type (Node/TypeScript, Python, etc.), lists key files, and renders a condensed file tree. Used by `llmPlanner.ts` to ground the LLM plan in the real project structure.

### `resolveTargetFiles.ts`

Given a task description and context (including `relevantChunks` from the indexer), it resolves the specific file paths that the agent should operate on. This prevents agents from writing to the wrong files when multiple similar files exist in the workspace.

### `CodeAgent.ts`

The workhorse agent. Handles code generation, feature implementation, bug fixes, refactoring. Takes an action string and context, constructs a prompt for Ollama, parses the generated code, and either writes files directly or returns `proposedChanges` (diffs) when `previewChanges` mode is active.

### `FileAgent.ts`

A read-focused agent. Lists directories, reads files, and gathers structured context about the workspace. Used in the analysis phases of workflows to provide the next step with relevant code context.

### `ProjectAgent.ts`

Handles project-level operations: running build commands, scaffold generation, dependency installation, setup tasks. Uses `BuildTool` and shell execution internally.

### `TestAgent.ts`

Generates unit tests for target files and runs the test suite. When generating, it reads the target source file, constructs a prompt asking for comprehensive tests, writes the test file, and optionally runs it to confirm the tests execute without failures.

### `CodeHealthAgent.ts`

Scans the codebase for health metrics — cyclomatic complexity, dead code, large files, missing tests, code duplication signals. Returns a structured report rather than making code changes.

### `EnhancedAgentManager.ts`

An extended variant of `AgentManager` with additional capabilities. Provides enhanced context handling and routing for more complex multi-agent workflows.

---

## `src/providers/` — LLM Connection Layer

### `OllamaProvider.ts`

The low-level Ollama HTTP API wrapper. It exposes:
- `generateText({ prompt, model })` — sends a generation request and returns the response string
- `getModel(name?, tier?)` — selects a model by tier: `fast` (small/quick), `code` (code-specialized), or the default orchestrator model
- Handles streaming, timeouts, and retry logic

### `AgentOllamaRegistry.ts`

A registry that holds one `OllamaProvider` instance per agent type. At startup it creates providers for: `orchestrator`, `code`, `test`, `project`, `autonomous`. Each can be configured with a different model name and temperature. `AgentManager` calls `registry.get('code')` to get the right provider for each agent.

---

## `src/tools/` — All Registered MCP Tools

Every file in this directory defines one or more tool handlers that get registered on the MCP/HTTP servers.

### `CoreTools.ts`

The fundamental tools: `generate_code` (generate code from description), `complete_code` (fill in the next lines), and `chat` (plain LLM chat without agent orchestration).

### `AgentTools.ts`

The agent-facing tools: `execute_agent_task` (run a structured `AgentTask`), `execute_autonomously` (run the full autonomous pipeline), `get_task_status` (poll a running task), `cancel_task`, `pause_task`, `resume_task`, `get_autonomous_capabilities`.

### `AgentToolRegistry.ts`

Wires each agent key (`code`, `file`, `project`, `test`, `autonomous`) to its own scoped `FileSystemTool` instance. This gives each agent pre-configured filesystem access with appropriate permissions.

### `ContextualChatTool.ts`

A chat tool that automatically injects workspace context (recent files, open files, selected text) into the conversation before sending to Ollama. Maintains a `conversationHistory` array for multi-turn conversations.

### `FileSystemTool.ts`

The core file operations tool used internally by agents: `readFile`, `writeFile`, `listDirectory`, `fileExists`, `deleteFile`, `moveFile`, `createDirectory`. Has path validation to prevent writing outside the workspace.

### `AnalysisTools.ts`

Tools for code review and understanding: `review_code` (quality and correctness review), `explain_code` (plain language explanation), `audit_code` (security/performance audit).

### `ErrorFixTools.ts`

`diagnose_error` and `fix_error` — take an error message and optionally the file contents, then ask the LLM to diagnose the root cause and produce a corrected version.

### `BuildTool.ts`

`run_build` — executes the project's build command (auto-detected from `package.json`, `Makefile`, etc.) and returns stdout/stderr with an exit code.

### `GitTool.ts`

Git operations in the workspace: `git_status`, `git_diff`, `git_log`, `git_commit`, `git_add`, `git_checkout`. Uses `child_process` to run git commands.

### `GitHubTools.ts`

GitHub API operations via the `GitHubService`: `github_get_repo`, `github_list_issues`, `github_create_issue`, `github_list_prs`, `github_get_file`, `github_analyze_repo`.

### `SearchTools.ts`

`search_code` — searches the workspace for a string or symbol using ripgrep-style searching through the `CodebaseIndexer`.

### `IndexingTools.ts`

`index_workspace` — triggers a full codebase index build. `query_index` — searches the index for relevant code chunks by natural language query.

### `IDETools.ts`

`get_diagnostics` — fetches LSP diagnostics (type errors, lint warnings) via `LSPClient`. `get_symbols` — lists symbols (functions, classes, exports) in a file.

### `InlineTools.ts`

`inline_complete` — low-latency single-line or short-span code completion, optimized for speed using the `fast` model tier.

### `CopilotTools.ts`

Copilot-style completion tools with context-aware suggestions based on the current file and cursor position.

### `TransformerLikeContext.ts`

Not a tool handler — used internally. Implements a simplified multi-head attention mechanism over conversation history or code chunks to rank which context is most relevant to the current task. Called by `AgentManager.enrichAgentContext()`.

### `toolAliases.ts`

Maps short/alternate tool names to canonical names (e.g. `"gen"` → `"generate_code"`). Allows Cursor to call tools with abbreviated names.

### `toolHelper.ts`

Shared utilities used across tool handlers: input parsing, response formatting, error wrapping.

### `ToolDependencies.ts`

Wires shared dependencies (providers, registries, services) into tool handler constructors. Avoids circular imports by centralizing dependency injection.

---

## `src/indexing/` — Codebase Understanding

### `CodebaseIndexer.ts`

The main indexer. On `indexWorkspace()` it walks the workspace directory recursively, skipping `node_modules`, `.git`, and binary files. For each source file it calls `CodeChunker` to split it into symbol-level chunks, then `EmbeddingService` to generate a vector embedding. All chunks are stored in a JSON sidecar file (`.codebase-index.json`) for persistence across restarts.

The `search(query, k)` method computes cosine similarity between the query embedding and all stored chunk embeddings, returning the top-k most relevant chunks.

### `CodebaseIndexerRegistry.ts`

A singleton registry that holds one `CodebaseIndexer` per workspace path. Prevents duplicate indexing of the same workspace when multiple agents run concurrently.

### `CodeChunker.ts`

Splits source files into meaningful chunks at the function/class/export boundary level. Uses a lightweight AST-aware approach: it looks for `function`, `class`, `const`, `export` declarations and splits there, rather than splitting by line count. Each chunk has `filePath`, `symbolName`, `symbolType`, `startLine`, `endLine`, `code`.

### `EmbeddingService.ts`

Generates vector embeddings for text (used for semantic search). By default uses Ollama's embedding endpoint (`/api/embeddings`) with a small embedding model. Returns a `number[]` vector.

### `SymbolResolver.ts`

Given a symbol name (function or class name), finds all definitions and usages in the index. Used by `IDETools` and `SearchTools` to answer "where is X defined?" queries.

### `types.ts`

TypeScript types for the indexing layer: `CodeChunk`, `IndexedSymbol`, `SearchHit`, `IndexStatus`.

---

## `src/semantic/` — NLP and Vector Search

### `VectorStore.ts`

An in-memory vector store with two capabilities:

1. **Intent classification** via `parseIntent(text)` — uses a set of intent templates with pre-computed embeddings. Compares the input text against all templates by cosine similarity and returns `{ intent, confidence, target }`. Intents include: `create_directory`, `create_file`, `implement_feature`, `fix_code`, `generate_tests`, `refactor`, `analyze`, `unknown`.
2. **Semantic search** — stores arbitrary text entries as embeddings and supports nearest-neighbor lookup.

Used by `intentRouter.ts` as the first classification pass before falling back to regex-based `inferTaskType()`.

---

## `src/workflows/` — Workflow Engine

### `WorkflowTemplates.ts`

Defines predefined multi-step workflow templates for common task types. For example, an `implement` template has three steps: analyze (file agent), implement (code agent), verify (project agent). Templates are parameterized by language and project type. When a template matches, `AgentManager.planWorkflow()` uses it directly instead of doing LLM planning.

### `WorkflowExecutor.ts`

Receives a `WorkflowPlan` and executes it step by step. For each step it looks up the correct agent from the agents map, calls `agent.executeStep()`, collects results, and tracks progress via the `progressCallback`. Returns a complete `AgentResult` when done.

---

## `src/verify/` — Build and Test Verification

### `ProjectVerifier.ts`

Runs the real build and test commands inside the workspace directory. It auto-detects the project type (checks for `package.json`, `Makefile`, `pyproject.toml`, etc.) and picks the appropriate commands (`npm run build`, `npm test`, `pytest`, `make`, etc.).

Each check produces a `VerificationCheck` with: `name`, `command`, `passed`, `exitCode`, `stdout`, `stderr`, `skipped`.

`formatFailureForRepair(result)` renders the failure output into a concise string that can be sent to the `CodeAgent` as context for auto-repair.

---

## `src/quality/` — Output Quality and Hallucination Control

### `HallucinationDetector.ts`

The `measureAgentPayload()` function scores an agent result for hallucination risk. It checks:
- **File path validity** — do the `proposedChanges` file paths actually exist or are plausible in the workspace?
- **Content groundedness** — does the generated code reference symbols/patterns that were in the input context?
- **Self-consistency** — do the step results contradict each other?

Returns a `HallucinationSummary`: `{ hallucinationRate, groundedScore, flagCount, flags[], samplesAnalyzed, measuredAt }`.

### `HallucinationMetrics.ts`

Tracks and aggregates hallucination scores over time. Can be used to compute rolling averages per model or task type for observability.

### `QualityFilter.ts`

A pre-return filter that blocks or flags responses that are obviously low-quality: empty code blobs, placeholder implementations (`// TODO`, `// Implementation needed`), or outputs that contain obvious injection patterns.

---

## `src/context/` — Context Enrichment

### `EnhancedContextManager.ts`

The `enhanceWithSemanticContext(description, context)` method is called for the `semantic_agent` routing strategy. It:
1. Runs `VectorStore.parseIntent()` on the description to get a confidence score and semantic intent
2. Searches the codebase index for similar code patterns
3. Returns an enriched context object with `intent`, `confidence`, `semanticMatches`, `similarCode`

If confidence ≥ 0.65, `AgentManager` short-circuits to `executeWithIntegratedSemantics()` instead of the full autonomous pipeline.

---

## `src/scaling/` — Performance and Reliability

### `CacheLayer.ts`

An LRU (Least Recently Used) in-memory cache for LLM responses. The cache key is a hash of `(model, prompt)`. Dramatically reduces latency for repeated or near-identical requests. Cache size and TTL are configurable.

### `LoadBalancer.ts`

Distributes generation requests across multiple Ollama instances (configured as an array of URLs). Uses a round-robin strategy with health checks — if an instance fails, it's temporarily removed from rotation.

### `RequestQueue.ts`

A FIFO queue with a configurable concurrency limit. Prevents Ollama from being overwhelmed when many parallel tool calls arrive simultaneously. Requests that exceed the limit wait in the queue rather than being rejected.

### `ScaledOllamaProvider.ts`

Combines all three: wraps `OllamaProvider` with `CacheLayer` → `RequestQueue` → `LoadBalancer`. This is what the server uses in production mode instead of plain `OllamaProvider`.

---

## `src/security/` — Safety

### `SecurityScanner.ts`

Scans code content and user inputs for security issues before processing or writing:
- Secret detection (API keys, tokens, passwords in code)
- Prompt injection patterns (attempts to override system instructions)
- Dangerous shell command patterns in generated code
- Path traversal attempts in file paths

Returns a list of flagged issues with severity levels. Used by tool handlers to validate inputs and by the quality filter to catch generated code with hardcoded secrets.

---

## `src/services/` — External Integrations

### `GitHubService.ts`

A GitHub REST API client. Provides typed methods for: getting repo info, listing issues, creating issues, listing pull requests, getting file contents at a specific ref, and listing releases.

### `GitHubRepositoryAnalyzer.ts`

A deep analyzer for remote GitHub repositories. Given a repo URL, it fetches key files and produces a structured analysis: detected language, framework, dependency list, directory structure, key entry points, and a summary suitable for LLM context.

---

## `src/lsp/` — Language Intelligence

### `LSPClient.ts`

Connects to a Language Server Protocol server (e.g. `typescript-language-server`, `pylsp`) via JSON-RPC over stdio or TCP. Exposes:
- `getDiagnostics(filePath)` — compile errors, type errors, lint warnings
- `getHover(filePath, line, column)` — type info and documentation for a symbol
- `getDefinition(filePath, line, column)` — go-to-definition location
- `getCompletions(filePath, line, column)` — completion candidates

Used by `IDETools` to power the `get_diagnostics` and `get_symbols` tools.

---

## `src/utils/` — Shared Utilities

### `Logger.ts`

A simple leveled logger (`info`, `warn`, `error`, `debug`). Prefixes messages with timestamp and level. In production, writes to stdout with structured fields.

### `CacheManager.ts`

A generic key-value cache with TTL support. Used by various components that need short-lived memoization. Backed by a `Map` with periodic expiry sweeps.

### `ContextManager.ts`

Manages the conversation history for multi-turn chat. Keeps a sliding window of recent messages that fit within a configurable token budget. Formats messages for Ollama's chat API format.

### `ErrorAnalyzer.ts`

Parses raw error output (from compilers, test runners, linters) into structured `ErrorEntry` objects with `file`, `line`, `column`, `message`, `severity`. Supports TypeScript, ESLint, Python traceback, and Jest output formats.

### `DynamicConfig.ts`

A runtime configuration store that can be updated via the HTTP API without restarting the server. Stores settings like model names, temperature, timeout values, and feature flags. Persists changes to a `config.json` sidecar file.

### `OllamaDefaults.ts`

Centralized constants for Ollama integration: default model names per tier, default `temperature`, `num_ctx` (context window), `top_p`, `repeat_penalty`, and request timeout values.

### `TimeoutManager.ts`

A wrapper that races any async operation against a configurable timeout. Throws a descriptive error if the operation exceeds the limit. Used throughout the codebase for LLM calls, build commands, and file I/O.

### `LargeCodebaseAnalyzer.ts`

Handles analysis of very large repositories (>10k files) without hitting memory limits. Uses streaming iteration over the file tree, chunk-by-chunk processing, and summarization to avoid loading the entire codebase into memory at once.

### `changeSummary.ts`

Given a list of modified files and their before/after contents, generates a human-readable summary of what changed. Used to build the `summary` field in `AgentResult` and for commit message generation.

---

## `src/config/` — Static Configuration

### `AppConfig.ts`

App-wide static configuration loaded from environment variables and `config.json`. Covers: HTTP port, MCP port, Ollama base URL, model names per agent type, workspace root, feature flags (`enableCache`, `enableLoadBalancing`, `enableSecurityScanner`, etc.), and logging level.

---

## `src/types/` — TypeScript Type Definitions

### `types/agent.ts`

The central shared type file. Key types:

**`AgentTask`** — the input to any agent operation.
Fields: `id`, `type` (`implement | fix | test | refactor | analyze`), `description`, `context`, `priority`, `status`.

**`WorkflowPlan`** — a sequence of steps to execute.
Fields: `taskId`, `steps[]`, `estimatedTime`, `requiredApprovals[]`.

**`WorkflowStep`** — one step in a plan.
Fields: `id`, `action`, `tool`, `params`, `status`, `result`, `error`.

**`AgentResult`** — the output of any agent operation.
Fields: `taskId`, `success`, `steps[]`, `summary`, `filesModified[]`, `proposedChanges[]`, `executionTime`, `autonomous`, `verified`, `verification`, `corrections`, `hallucination`.

**`HallucinationSummary`** — Fields: `hallucinationRate`, `groundedScore`, `flagCount`, `flags[]`, `samplesAnalyzed`, `measuredAt`.

### `types/index.ts`

Re-exports all shared types for cleaner imports across the codebase.

---

## `src/formatters/` — Output Formatting

### `CodeFormatter.ts`

Post-processes LLM-generated code before it's written to disk or returned to the client. Handles: stripping markdown fences (` ```typescript `), fixing common indentation issues, removing the LLM's commentary that sometimes leaks into code blocks, and language-specific cleanups (semicolons, trailing newlines).

---

## `src/tests/` — Test Suite

| File | What it tests |
|---|---|
| `intentRouter.test.ts` | All routing cases: fast_fs, semantic, autonomous; task type inference; `isChatOnlyQuestion` |
| `simpleFsTasks.test.ts` | mkdir and create_file parsing across many natural language phrasings |
| `llmPlanner.test.ts` | Plan JSON parsing, step mapping, rejection logic for bad plans |
| `resolveTargetFiles.test.ts` | File targeting from `relevantChunks` and context files |
| `workflowRouting.test.ts` | `inferAgentTool` and `classifyTask` rule logic |
| `contextualChat.test.ts` | Context injection, history management, multi-turn conversations |
| `symbolResolution.test.ts` | Symbol lookup from index across TypeScript and Python files |
| `toolAliases.test.ts` | Alias resolution, canonical name lookup |
| `liveIntegration.test.ts` | End-to-end tests that actually call Ollama — skipped in CI unless `OLLAMA_URL` is set |

---

## How a Typical Request Flows — End to End

1. Cursor calls the `execute_autonomously` MCP tool with `{ description: "add rate limiting to the API", workspacePath: "..." }`
2. `MCPServer` receives it and calls `AgentTools.executeAutonomously()`
3. `AgentTools` calls `AgentManager.executeAutonomously(description, context)`
4. `AgentManager` sanitizes inputs, calls `routeCommand()` → strategy is `autonomous`
5. `AgentManager.enrichAgentContext()` runs: indexes the workspace, searches for relevant chunks, runs attention ranking
6. `AutonomousAgent.executeAutonomously()` is called with the enriched context
7. Phase 1 — Analyze: `routeCommand()` → `taskType: 'implement'`, `tool: 'code'`, `riskLevel: 'low'`
8. Phase 2 — Plan: `isComplexTask()` returns `true`, `generateLlmPlan()` asks Ollama for a JSON plan, gets back 3 steps: `edit_file: middleware/rateLimit.ts`, `edit_file: routes/api.ts`, `run_tests`
9. Phase 3 — Execute: step 1 → `CodeAgent.executeStep()` → Ollama generates the rate limiting middleware → file written → `validateStepResult()` passes. Step 2 → `CodeAgent` modifies the API route to use the middleware → passes. Step 3 → `TestAgent` runs `npm test`
10. Phase 4 — Verify: `ProjectVerifier.verify()` runs `npm run build` + `npm test` → both pass
11. Result is assembled: `AgentResult { success: true, filesModified: [...], verified: true, hallucination: {...} }`
12. `AgentManager.mapAutonomousResult()` wraps it, attaches hallucination metrics
13. `MCPServer` serializes the result as a JSON-RPC response back to Cursor

---

## Routing Strategy Decision Tree

```
User command
    │
    ▼
routeCommand()
    ├── fast_fs      → direct mkdir/touch (no LLM) ──────────────────► done
    ├── semantic_agent (confidence ≥ 0.7)
    │       └── enhanceWithSemanticContext()
    │               └── executeWithIntegratedSemantics() ──────────────► done
    └── autonomous pipeline:
            ├── enrichAgentContext() (codebase index + attention)
            ├── analyzeIntentAndContext()
            ├── createExecutionPlan()
            │       ├── isComplexTask() → generateLlmPlan() (Ollama)
            │       └── simple task    → rule-based plan
            ├── executeWithSelfCorrection()
            │       └── for each step:
            │               ├── executeStepWithAgent()
            │               ├── validateStepResult() (heuristic → Ollama fallback)
            │               └── generateCorrection() on failure (Ollama)
            ├── verifyAndRepair() → ProjectVerifier → CodeAgent repair loop
            └── measureAndRecordHallucination()
```

---

## Task Status Lifecycle

| Status | Meaning |
|---|---|
| `pending` | Created, not yet started |
| `analyzing` | Running intent analysis and context enrichment |
| `planning` | Building execution plan (rule-based or LLM) |
| `executing` | Running steps with self-correction loop |
| `validating` | ProjectVerifier running build/tests |
| `completed` | All steps done and verification passed |
| `failed` | A critical step failed or verification could not be repaired |
| `paused` | Execution suspended mid-step, waiting for `resumeTask()` |

---

## Risk Level Classification

| Level | Triggered by | Effect |
|---|---|---|
| `high` | delete, remove, drop, production | Requires ≥ 80% step success rate |
| `medium` | modify, update, change | Standard validation threshold |
| `low` | Everything else | Permissive threshold, faster execution |

---

## LLM Plan Step Types (llmPlanner)

| Kind | Path required | Tool | Description |
|---|---|---|---|
| `mkdir` | Yes | code | Create a directory in the workspace |
| `create_file` | Yes | code | Create a new source file |
| `edit_file` | Yes | code | Modify an existing source file |
| `generate_tests` | Optional | test | Generate unit tests for a target file |
| `run_tests` | No | test | Execute the full test suite (at most once, last step) |
| `review` | No | code | Review code and produce findings |

---

## Per-Agent Ollama Model Tiers

| Agent key | Model tier | Purpose |
|---|---|---|
| `orchestrator` | Full / high-capability | Overall planning and coordination |
| `code` | Code-specialized | Code generation, fixes, refactoring |
| `test` | Code-specialized | Test generation and analysis |
| `project` | Fast | Build commands, project ops |
| `autonomous` | Full | Autonomous pipeline orchestration |
| *(validation)* | Fast | `validateStepResult` VALID/INVALID calls |
