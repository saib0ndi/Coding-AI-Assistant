# MCP-Ollama — Architecture Documentation

> Canonical, diagram-driven reference for the entire system. Covers the server,
> agent runtime, workflow engine, provider/resilience stack, semantic memory,
> configuration, observability, and the VS Code extension — down to the small
> concepts that make it work.

- **Package:** `mcp-ollama` v2.0.0
- **Runtime:** Node.js + TypeScript (ESM)
- **Role:** A local-first, agentic coding assistant exposed as an MCP server (stdio) and an HTTP API, backed by self-hosted Ollama models, with a companion VS Code extension.

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [System context](#2-system-context)
3. [Layered architecture](#3-layered-architecture)
4. [Module reference](#4-module-reference)
5. [Request lifecycle](#5-request-lifecycle)
6. [Agent execution & workflow engine](#6-agent-execution--workflow-engine)
7. [Autonomous self-correction loop](#7-autonomous-self-correction-loop)
8. [Provider stack: routing, resilience, scaling](#8-provider-stack-routing-resilience-scaling)
9. [Semantic memory / RAG](#9-semantic-memory--rag)
10. [Quality & verification](#10-quality--verification)
11. [Configuration & bootstrap order](#11-configuration--bootstrap-order)
12. [Observability & HTTP surface](#12-observability--http-surface)
13. [VS Code extension](#13-vs-code-extension)
14. [External integrations](#14-external-integrations)
15. [Concept glossary](#15-concept-glossary)
16. [Operations runbook](#16-operations-runbook)
17. [Known limitations & roadmap](#17-known-limitations--roadmap)

---

## 1. What this project is

MCP-Ollama is an **agent**, not just a prompt wrapper. It has:

- **Tool use that changes the world** — file read/write/exec, git, build, search.
- **Planning** — LLM-generated and template-based multi-step plans.
- **A control loop** — execute → validate → correct → retry, with rollback.
- **Memory / retrieval** — a semantic code index (RAG) injected into prompts.
- **Resilience & autonomy** — circuit breakers, queues, dead-letter capture,
  pause/resume, persisted tasks.

It speaks two protocols:

- **MCP (Model Context Protocol)** over stdio — tools usable by MCP clients.
- **HTTP** on port `3078` — used by the VS Code extension and for webhooks.

---

## 2. System context

```mermaid
graph LR
    subgraph IDE["VS Code Extension (client)"]
        CHATUI["chatUI / streamingClient"]
        INLINE["inlineCompletionProvider"]
        DIFF["diffViewer / workflowProgressView"]
        MCPC["mcpClient"]
    end

    subgraph SRV["MCP-Ollama Server (Node/TS)"]
        HTTP["HTTPServer :3078"]
        MCP["MCPServer (stdio + tools)"]
    end

    subgraph LLM["Ollama backends"]
        REMOTE["Inference host(s)\nper-role models"]
        EMBED["Dedicated embed host\nnomic-embed-text"]
    end

    EXT_MCP["External MCP servers\n(federated tools)"]
    GH["GitHub API / Webhooks"]

    CHATUI -->|HTTP /stream/chat| HTTP
    INLINE -->|HTTP /tools/*| HTTP
    MCPC -->|stdio / HTTP| MCP
    HTTP --> MCP
    MCP -->|per-role routing| REMOTE
    MCP -->|embeddings| EMBED
    MCP -->|federate| EXT_MCP
    HTTP -->|/webhook/github| GH
    MCP --> GH
```

**Key design choice:** inference and embeddings are decoupled. Inference uses
`OLLAMA_HOST` (often a big remote box, routed per agent role); embeddings use
`OLLAMA_EMBED_HOST` (a small instance pinned to a free GPU). This prevents a busy
or OOM inference host from silently degrading semantic search.

---

## 3. Layered architecture

```mermaid
graph TB
    subgraph Entry["Entry / Bootstrap"]
        ENV["env.ts (loads .env FIRST)"]
        INDEX["index.ts (main)"]
    end

    subgraph Transport["Transport / Server"]
        HTTPServer["HTTPServer"]
        MCPServer["MCPServer / MCPServerEnhanced"]
        RequestRouter["RequestRouter"]
    end

    subgraph Tools["Tool Layer (src/tools)"]
        CoreTools["CoreTools (chat_assistant, completion)"]
        IndexingTools["IndexingTools"]
        AnalysisTools["AnalysisTools"]
        FileSystemTool["FileSystemTool (run-mode gated)"]
        GitTool["GitTool / GitHubTools / BuildTool / ExecutionTool"]
        AgentToolRegistry["AgentToolRegistry"]
    end

    subgraph Agents["Agent Layer (src/agents)"]
        AgentManager["AgentManager (orchestrator)"]
        AutonomousAgent["AutonomousAgent (self-correction)"]
        SubAgents["CodeAgent / FileAgent / TestAgent / ProjectAgent"]
        Planner["llmPlanner + WorkflowTemplates"]
        Router["intentRouter / intentClassifier / workflowRouting"]
        TaskPersistence["TaskPersistence"]
    end

    subgraph Workflows["Workflow Engine"]
        WorkflowExecutor["WorkflowExecutor (dependency waves, approval gate)"]
        DLQ["DeadLetterQueue"]
    end

    subgraph Memory["Context & Semantic Memory (RAG)"]
        EnhancedContext["EnhancedContextManager"]
        VectorStore["VectorStore"]
        CodebaseIndexer["CodebaseIndexer + Registry"]
        CodeChunker["CodeChunker / SymbolResolver"]
        EmbeddingService["EmbeddingService"]
    end

    subgraph Providers["LLM Providers & Resilience"]
        AgentOllamaRegistry["AgentOllamaRegistry (per-role + breaker)"]
        OllamaProvider["OllamaProvider"]
        CircuitBreaker["CircuitBreaker"]
        ScaledProvider["ScaledOllamaProvider"]
        LoadBalancer["LoadBalancer / RequestQueue / CacheLayer"]
    end

    subgraph Quality["Quality & Verification"]
        SyntaxGate["SyntaxGate (parse + rollback)"]
        Hallucination["HallucinationDetector / Metrics"]
        ProjectVerifier["ProjectVerifier / SecurityScanner"]
    end

    subgraph Cross["Cross-cutting"]
        Config["AppConfig / RulesLoader"]
        Obs["Logger / Metrics / Tracing"]
        MCPClient["McpClientManager (consume external MCP)"]
        Services["GitHubService / PRReviewBot"]
    end

    ENV --> INDEX --> HTTPServer --> MCPServer --> RequestRouter
    RequestRouter --> CoreTools
    RequestRouter --> AgentManager
    MCPServer --> Tools
    AgentManager --> SubAgents --> Tools
    AgentManager --> Planner --> WorkflowExecutor --> SubAgents
    AgentManager --> AutonomousAgent
    WorkflowExecutor --> DLQ
    SubAgents --> SyntaxGate
    AgentManager --> Memory
    SubAgents --> AgentOllamaRegistry --> CircuitBreaker --> ScaledProvider --> LoadBalancer --> OllamaProvider
    AgentManager --> Quality
    MCPServer --> MCPClient
    HTTPServer --> Services
```

---

## 4. Module reference

### `src/` — server

| Directory | Key files | Responsibility |
|---|---|---|
| `server/` | `HTTPServer`, `MCPServer`, `MCPServerEnhanced`, `RequestRouter` | Transport, tool registry, request classification/routing |
| `agents/` | `AgentManager`, `AutonomousAgent`, `CodeAgent`, `FileAgent`, `TestAgent`, `ProjectAgent`, `llmPlanner`, `intentRouter`, `intentClassifier`, `workflowRouting`, `TaskPersistence`, `projectScanner`, `resolveTargetFiles`, `simpleFsTasks` | Orchestration, planning, specialized agents, intent routing |
| `workflows/` | `WorkflowExecutor`, `WorkflowTemplates`, `DeadLetterQueue` | Multi-step execution with dependencies, approvals, failure capture |
| `tools/` | `CoreTools`, `IndexingTools`, `AnalysisTools`, `FileSystemTool`, `GitTool`, `GitHubTools`, `BuildTool`, `ExecutionTool`, `SearchTools`, `ErrorFixTools`, `InlineTools`, `IDETools`, `AgentToolRegistry`, `AgentToolRegistry`, `ToolDependencies`, `toolAliases` | Concrete capabilities exposed to agents and MCP clients |
| `providers/` | `OllamaProvider`, `AgentOllamaRegistry` | LLM calls; per-role host/model/timeout + circuit breaker wiring |
| `scaling/` | `ScaledOllamaProvider`, `LoadBalancer`, `RequestQueue`, `CacheLayer` | Concurrency control, endpoint balancing, request dedup |
| `indexing/` | `CodebaseIndexer`, `CodebaseIndexerRegistry`, `CodeChunker`, `SymbolResolver`, `EmbeddingService`, `types` | Build & query the semantic code index |
| `semantic/` | `VectorStore` | Facade for semantic search (workspace + ephemeral memory scopes) |
| `context/` | `EnhancedContextManager` | Aggregates retrieved context for prompts |
| `quality/` | `HallucinationDetector`, `HallucinationMetrics`, `QualityFilter` | Output grounding/quality signals |
| `verify/` | `SyntaxGate`, `ProjectVerifier` | Deterministic validation of generated code/projects |
| `security/` | `SecurityScanner` | Static safety checks |
| `mcp/` | `McpClientManager` | Consume/federate external MCP servers |
| `services/` | `GitHubService`, `GitHubRepositoryAnalyzer`, `PRReviewBot` | GitHub API, repo analysis, automated PR review |
| `config/` | `AppConfig`, `RulesLoader` | Env-driven config; project rule injection |
| `utils/` | `Logger`, `Metrics`, `Tracing`, `CircuitBreaker`, `CacheManager`, `TimeoutManager`, `ErrorAnalyzer`, `LargeCodebaseAnalyzer`, `ContextManager`, `DynamicConfig`, `OllamaDefaults` | Cross-cutting helpers |
| `lsp/`, `formatters/` | `LSPClient`, `CodeFormatter` | Language tooling |
| `env.ts` | — | Loads `.env` **before** any other module initializes |

---

## 5. Request lifecycle

Every tool call is classified into one of three lanes by `RequestRouter`.

```mermaid
flowchart TD
    A["Tool call: name + params"] --> B{classifyRequest}
    B -->|"name starts with agent_<br/>OR verb+noun in description"| AGENT["AGENT lane"]
    B -->|"chat_assistant / slash_command"| CHAT["CHAT lane"]
    B -->|otherwise| SIMPLE["SIMPLE lane"]

    SIMPLE --> S1["OllamaProvider.explainCode / fixCode /<br/>generateTests / handleGenericRequest"]
    CHAT --> C1{shouldEscalateToAgent?}
    C1 -->|"'implement a', 'build me a'..."| AGENT
    C1 -->|no| C2["OllamaProvider.handleChatRequest (string)"]
    AGENT --> AG1["AgentManager.executeTask(task)"]

    S1 --> OUT["plain-string response"]
    C2 --> OUT
    AG1 --> OUT2["structured result (summary, files, steps)"]
```

**Classification rules (`RequestRouter`):**

- **AGENT** when the tool name starts with `agent_`, or the description contains
  **both** an action verb (`implement`, `build`, `create`, …) **and** a code
  noun (`api`, `service`, `component`, …). Requiring both prevents conversational
  questions from being misrouted into agent tasks.
- **CHAT** for `chat_assistant` / `slash_command`; may escalate to AGENT only on
  explicit multi-step triggers (`implement a`, `build me a`, …).
- **SIMPLE** for everything else — a single direct LLM call.

### Streaming chat path

```mermaid
sequenceDiagram
    participant UI as chatUI (extension)
    participant SC as streamingClient
    participant H as HTTPServer /stream/chat
    participant T as chat_assistant tool
    participant O as Ollama

    UI->>SC: send(message, model, history, language)
    SC->>H: POST /stream/chat {message, messages, model, language}
    H->>T: callTool('chat_assistant', args + RulesLoader context)
    T->>O: generate
    O-->>T: text
    T-->>H: string
    H-->>SC: token stream (whitespace-preserving)
    SC-->>UI: onToken / onComplete (incremental markdown render)
```

---

## 6. Agent execution & workflow engine

```mermaid
flowchart TD
    T["AgentTask {type, description, priority}"] --> P{planWorkflow}
    P -->|LLM available| LP["llmPlanner.generatePlan<br/>(+ RulesLoader context injected)"]
    P -->|fallback| FT["WorkflowTemplates / fallbackPlanning<br/>(template steps + dependencies)"]
    LP --> PLAN["WorkflowPlan {steps[], requiredApprovals[]}"]
    FT --> PLAN

    PLAN --> WE["WorkflowExecutor.execute"]
    WE --> WV["buildDependencyWaves<br/>(topological + cycle detection)"]
    WV --> GATE{step in requiredApprovals<br/>and not pre-approved?}
    GATE -->|yes| PAUSE["return approval_required:stepId"]
    GATE -->|no| RUN["run wave (concurrency-limited,<br/>per-step timeout)"]
    RUN --> AGENTPICK["route step.tool → CodeAgent /<br/>FileAgent / TestAgent / ProjectAgent"]
    AGENTPICK --> TOOLS["FileSystemTool / GitTool / BuildTool..."]
    AGENTPICK --> SG["safeWriteCode → SyntaxGate<br/>(snapshot → validate → rollback on fail)"]
    RUN --> NEXT{more waves?}
    NEXT -->|yes| RUN
    NEXT -->|no| DONE["aggregate AgentResult"]
    RUN -->|step failed| DLQ["DeadLetterQueue"]
```

**Concepts:**

- **Dependency waves** — steps are grouped into topologically-ordered waves; a
  `visiting` set detects cycles to prevent infinite loops. Steps within a wave run
  concurrently up to `WORKFLOW_MAX_CONCURRENT_STEPS`, each bounded by
  `WORKFLOW_STEP_TIMEOUT_MS`.
- **Approval gate** — steps listed in `plan.requiredApprovals` (e.g. high-priority
  or `fix`/`refactor` tasks that write files) pause execution and return
  `approval_required:<stepId>` unless pre-approved via `context.autoApprove` or
  `context.approvedSteps`.
- **Dead-letter queue** — failed steps/tasks are captured for inspection/retry
  and surfaced in `/api/stats`.

---

## 7. Autonomous self-correction loop

This is what elevates the system from a pipeline to an agent.

```mermaid
sequenceDiagram
    participant AA as AutonomousAgent
    participant AG as Sub-agent (Code/Test/...)
    participant V as validateStepResult
    participant LLM as Ollama (role)

    AA->>AA: plan.steps
    loop for each step
        loop while attempts < maxAttempts and not success
            AA->>AG: executeStepWithAgent(step, context)
            AG->>LLM: generate (via breaker→scaled→provider)
            LLM-->>AG: output
            AG-->>AA: stepResult
            AA->>V: validateStepResult(step, result)
            alt valid
                V-->>AA: ok → mark completed
            else invalid
                AA->>LLM: generateCorrection(step, result)
                LLM-->>AA: { params }
                AA->>AA: merge params, attempts++, corrections++
            end
        end
        alt failed and step.critical
            AA->>AA: abort (rollbacks tracked)
        end
    end
    AA-->>AA: summary {successful, corrections, rollbacks}
```

There is also a **fast path** (`executeFastPath`) with a verify/repair loop, and a
**direct path** (`executeDirectly`) for simple tasks. Tasks can be **paused** and
resumed (`waitForResume`).

> **Current limitation:** `generateCorrection` only adjusts step **params**, not
> the **strategy**. Strategy-level re-planning is the highest-leverage future
> improvement (see [Roadmap](#17-known-limitations--roadmap)).

---

## 8. Provider stack: routing, resilience, scaling

Every low-level LLM call flows through this chain, wired in `AgentOllamaRegistry`
via `provider.setRequestGuard(...)`:

```mermaid
flowchart LR
    CALL["agent / tool needs a completion"] --> REG["AgentOllamaRegistry.get(role)"]
    REG --> ROLE{"role:\norchestrator / code /\ntest / project / autonomous"}
    ROLE --> GUARD["provider.requestGuard"]
    GUARD --> CB["CircuitBreaker(role)\nopen → fail fast"]
    CB --> SC["ScaledOllamaProvider.dispatch"]
    SC --> Q["RequestQueue\n(bounded concurrency)"]
    Q --> LB["LoadBalancer\n(pick healthy endpoint)"]
    LB --> CACHE["CacheLayer\n(dedup identical reqs)"]
    CACHE --> PROV["OllamaProvider\n(auth, streaming, retry, timeout)"]
    PROV --> OLL["Ollama /api/generate|chat"]
```

**Concepts:**

- **Per-role providers** — each role (`orchestrator`, `code`, `test`, `project`,
  `autonomous`) gets its own host/model/timeout, overridable via
  `OLLAMA_<ROLE>_HOST` / `_MODEL` / `_TIMEOUT_MS`.
- **Circuit breaker (per role)** — opens after `CIRCUIT_FAILURE_THRESHOLD`
  failures, fails fast for `CIRCUIT_COOLDOWN_MS`, then half-opens and needs
  `CIRCUIT_SUCCESS_THRESHOLD` successes to close. One dead endpoint never blocks
  the others.
- **Scaled dispatch** — a process-wide singleton enforcing bounded concurrency
  (`RequestQueue`), endpoint selection (`LoadBalancer`, health-checked with
  `unref()`'d timers), and identical-request dedup (`CacheLayer`).

### Circuit breaker state machine

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open: failures >= threshold
    Open --> HalfOpen: cooldown elapsed
    HalfOpen --> Closed: successes >= successThreshold
    HalfOpen --> Open: any failure
```

---

## 9. Semantic memory / RAG

```mermaid
flowchart TD
    subgraph Index["Indexing (write path)"]
        FILES["source files"] --> CHUNK["CodeChunker\n(function/class/file chunks)"]
        CHUNK --> SYM["SymbolResolver"]
        CHUNK --> EB["EmbeddingService.embedBatch\n(split-on-400, keep_alive)"]
        EB -->|OLLAMA_EMBED_HOST| EH["embed host\nnomic-embed-text → 768-dim"]
        EB --> STORE["CodebaseIndexer.save\n(embedModel, embedDim, degraded)"]
        STORE --> JSON[".coding-ai/index.json"]
    end

    subgraph Search["Search (read path)"]
        Q["query"] --> QE["EmbeddingService.embed"]
        QE --> COS["cosineSimilarity over chunks"]
        JSON --> LOAD["CodebaseIndexer.load\n(reject if model/dim mismatch\nor degraded)"]
        LOAD --> COS
        COS --> HITS["ranked CodeSearchHit[]"]
    end

    HITS --> CTX["EnhancedContextManager / VectorStore\n→ injected into agent prompts"]
```

**Invariants (hard-won — see [Roadmap](#17-known-limitations--roadmap)):**

- **Embed-host decoupling** — embeddings target `OLLAMA_EMBED_HOST` (defaults to
  `OLLAMA_HOST`). A dedicated instance on a free GPU keeps semantic search working
  even when inference is busy/OOM.
- **Index self-validation on load** — `CodebaseIndexer.load()` rejects an index if
  its `embedModel` differs from the current model, if chunk dimensions are mixed,
  or if it was persisted while `degraded`. A rejected index triggers a clean
  rebuild, so vectors from different models/dimensions can never silently poison
  `cosineSimilarity` (which compares over `min(len)`).
- **Resilient batching** — `embedBatch` splits oversized batches on HTTP 400 and
  skips genuinely un-embeddable chunks (empty vector, excluded from the index)
  rather than falling the whole batch back to hash. True backend outages still
  degrade to hash vectors and flip `backend = 'fallback'`.
- **`keep_alive`** — embed requests keep the model resident, so a full re-index
  doesn't reload the model between batches.

---

## 10. Quality & verification

```mermaid
flowchart LR
    GEN["LLM-generated code"] --> SW["CodeAgent.safeWriteCode"]
    SW --> SNAP["snapshot existing file"]
    SNAP --> SG{"SyntaxGate.validate"}
    SG -->|TS| TS["ts.transpileModule + new Function()"]
    SG -->|JSON| J["JSON.parse"]
    SG -->|py/go| CLI["py_compile / gofmt"]
    SG -->|other| DELIM["delimiter balance check"]
    SG -->|pass| WRITE["write to disk"]
    SG -->|fail| ROLL["rollback to snapshot"]

    WRITE --> HM["HallucinationDetector / Metrics"]
    WRITE --> PV["ProjectVerifier / SecurityScanner"]
```

- **SyntaxGate** — deterministic, parser-based validation before writing. Shifts
  correctness from "hope the model is perfect" to "validate and reject bad output."
- **HallucinationMetrics** — grounding signals aggregated and exposed at `/health`.

---

## 11. Configuration & bootstrap order

### Critical startup order

ES `import` statements are hoisted above inline code, so config must be loaded by
the **first** import or import-time singletons (e.g. `intentRouter` creates a
`VectorStore` → shared `EmbeddingService`) capture default env.

```mermaid
flowchart TD
    E1["import './env.js' (FIRST import)"] --> E2["dotenv.config({ path: ../.env })"]
    E2 --> E3["other imports initialize\nwith correct env"]
    E3 --> E4["main(): registry → agents →\nMCPServer → HTTPServer"]
```

### Key environment variables

| Variable | Purpose |
|---|---|
| `OLLAMA_HOST` | Base inference host |
| `OLLAMA_EMBED_HOST` | Dedicated embeddings host (defaults to `OLLAMA_HOST`) |
| `OLLAMA_EMBED_MODEL` | Embedding model (default `nomic-embed-text`) |
| `OLLAMA_<ROLE>_HOST/_MODEL/_TIMEOUT_MS` | Per-role overrides (`ORCHESTRATOR`/`CODE`/`TEST`/`PROJECT`/`AUTONOMOUS`) |
| `OLLAMA_AUTH_TOKEN` | Bearer token for protected Ollama endpoints |
| `OLLAMA_ALLOWED_HOSTS` | Host allowlist |
| `CIRCUIT_FAILURE_THRESHOLD` / `CIRCUIT_COOLDOWN_MS` / `CIRCUIT_SUCCESS_THRESHOLD` | Circuit breaker tuning |
| `WORKFLOW_MAX_CONCURRENT_STEPS` / `WORKFLOW_STEP_TIMEOUT_MS` | Workflow concurrency/timeouts |
| `PORT` / `MCP_SERVER_PORT` | HTTP port (default `3078`) |
| `HTTP_REQUEST_TIMEOUT_MS` | Socket timeout (default 300s) |
| `RUN_MODE` | `full` / `restricted` / `read-only` for `FileSystemTool` |
| `GITHUB_TOKEN` | GitHub API auth |

`RulesLoader` additionally injects project instructions from `AGENTS.md`,
`.coding-ai/rules/*.md`, and `.cursor/rules/*.mdc` into agent and chat prompts.

---

## 12. Observability & HTTP surface

```mermaid
flowchart TD
    subgraph Endpoints["HTTP surface (:3078)"]
        H1["/health — status + live embeddings probe + hallucination summary"]
        H2["/api/stats — scaling, circuits, dlq, embeddings"]
        H3["/metrics — Prometheus"]
        H4["/api/mcp-health — federated MCP server health"]
        H5["/tools/<name> — invoke a tool"]
        H6["/stream/chat — streaming chat"]
        H7["/webhook/github — PR review bot"]
    end

    subgraph XCut["Cross-cutting"]
        L["Logger (structured)"]
        M["Metrics (httpRequests, circuitState, dlqSize, activeTasks, agentErrors)"]
        TR["Tracing (trace/span ids in logs)"]
    end

    Endpoints --> XCut
```

`/health.embeddings` runs a cached (30s) live embed probe and reports
`{ backend, healthy, host, model, dimensions }`, so degradation to the hash
fallback is observable instead of silent.

---

## 13. VS Code extension

```mermaid
graph TB
    subgraph Activation
        EXT["extension.ts"]
        SM["serverManager (spawns/locates server)"]
        CM["configManager"]
    end

    subgraph Chat
        CHATUI["chatUI"]
        SC["streamingClient"]
        CH["chatHistory / conversationContext"]
        HTML["chat/chatHtml + media/chat.js+css"]
    end

    subgraph Inline
        ICP["inlineCompletionProvider"]
        ISP["inlineSuggestionProvider"]
        MLG["multiLineGenerator"]
    end

    subgraph AgentUX
        AC["agentCommands / commands/*"]
        WPV["workflowProgressView"]
        DV["diffViewer / changeSummary"]
        AR["agentReview / verificationDisplay"]
    end

    subgraph Plumbing
        MCPC["mcpClient"]
        CTX["contextAnalyzer / smartContextHandler / workspaceAnalyzer"]
        RL["rateLimiter / retryManager / telemetryManager"]
        RV["quality/ResponseValidator"]
    end

    EXT --> SM --> MCPC
    EXT --> CHATUI --> SC --> MCPC
    CHATUI --> CH
    CHATUI --> HTML
    EXT --> ICP --> MCPC
    EXT --> AC --> WPV
    AC --> DV
    AC --> AR
    MCPC --> CTX
    MCPC --> RL
    SC --> RV
```

The extension connects to the server over HTTP (and MCP), streams chat tokens
with incremental markdown rendering, provides inline completions, shows workflow
progress, and renders diffs/approvals for agent changes.

---

## 14. External integrations

- **GitHub** — `GitHubService` (PR diff/review/inline comments), `PRReviewBot`
  (webhook-driven automated review using Ollama), `GitHubRepositoryAnalyzer`.
- **External MCP servers** — `McpClientManager` connects to other MCP servers and
  exposes their tools as local federated tools (`server/tool` naming), surfaced in
  `handleListTools` and dispatched in `handleCallTool`.

---

## 15. Concept glossary

| Concept | Where | What it does |
|---|---|---|
| Per-role provider | `AgentOllamaRegistry` | Separate Ollama host+model+timeout per agent role |
| Circuit breaker | `CircuitBreaker` | Per-role fail-fast with cooldown + half-open probing |
| Scaled dispatch | `ScaledOllamaProvider` + `RequestQueue`/`LoadBalancer`/`CacheLayer` | Bounded concurrency, endpoint selection, request dedup |
| Dependency waves | `WorkflowExecutor` | Topological parallel batches; cycle detection |
| Approval gate | `WorkflowExecutor` + `requiredApprovals` | Pause high-risk write steps until approved |
| Run-mode gating | `FileSystemTool` | `full`/`restricted`/`read-only`; command allowlist |
| Syntax gate | `SyntaxGate` | Snapshot → parse-validate → rollback before write |
| Dead-letter queue | `DeadLetterQueue` | Capture failed tasks/steps for inspection/retry |
| Self-correction | `AutonomousAgent` | Validate → LLM correction → retry with backoff |
| Intent routing | `intentRouter` / `RequestRouter` | SIMPLE/CHAT/AGENT classification |
| Rules injection | `RulesLoader` | Loads `AGENTS.md`/`.coding-ai`/`.cursor` rules into prompts |
| Embed-host decoupling | `EmbeddingService` + `OLLAMA_EMBED_HOST` | Embeddings on a dedicated GPU/host |
| Index self-validation | `CodebaseIndexer.load/save` | Reject model/dimension-mismatched or degraded indexes |
| keep_alive / split-on-400 | `EmbeddingService` | Keep embed model resident; recover oversized batches |
| Federation | `McpClientManager` | Expose external MCP tools locally |
| Observability | `Logger`/`Metrics`/`Tracing` | Structured logs, Prometheus metrics, trace correlation |

---

## 16. Operations runbook

### Build & run

```bash
npm install
npm run build        # tsc → dist/
npm run dev          # tsc --watch + nodemon (single instance!)
# or, stable foreground:
node dist/index.js
```

> Run **one** dev watcher. Multiple `npm run dev` instances fight over port 3078
> and can kill in-flight indexing on restart.

### Dedicated embedding server (recommended)

```bash
CUDA_VISIBLE_DEVICES=1 OLLAMA_HOST=127.0.0.1:11533 \
  OLLAMA_MODELS=$HOME/.ollama/models ollama serve
# then in .env:
# OLLAMA_EMBED_HOST=http://127.0.0.1:11533
```

> Not reboot-durable by default — wrap in a systemd unit for persistence.

### Health checks

```bash
curl -s localhost:3078/health   | jq .embeddings   # expect backend: "ollama"
curl -s localhost:3078/api/stats | jq '{circuits, dlq, embeddings}'
curl -s localhost:3078/metrics                      # Prometheus
```

### Re-index a workspace

```bash
curl -s -X POST localhost:3078/tools/index_codebase \
  -H 'Content-Type: application/json' \
  -d '{"workspacePath":"/abs/path","force":true}'
```

### Tests

```bash
npm test   # node:test runner; some live-integration tests require a reachable Ollama
```

---

## 17. Known limitations & roadmap

**Limitations (honest):**

- Self-correction adjusts params, not strategy — no true re-planning on failure.
- Planning is partly template-driven for novel tasks.
- Step validation signals are uneven; weak validators weaken the correction loop.
- Memory is per-task retrieval; no cross-task learning.
- Embedding server isn't reboot-durable out of the box.

**Roadmap (highest leverage first):**

1. **Strategy-level re-planning** in the self-correction loop (biggest "intelligence" gain).
2. **Stronger verification signals** (extend `SyntaxGate` → tests/build as gates).
3. **Cross-task memory** (persistent lessons / outcomes).
4. **Durable embed server** (systemd unit) + auto-reindex on model change.

---

*This document reflects the current wiring in `src/`. When you change routing,
add a tool, or alter the provider/embedding stack, update the relevant diagram
and the [module reference](#4-module-reference).*
