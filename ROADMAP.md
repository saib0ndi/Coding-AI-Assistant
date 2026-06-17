# Coding AI Assistant — Differentiation Roadmap

**Wedge:** Trust — private AI that only ships diffs that build and test.  
**Status:** Phase 1 done · Phase 2 in progress (real repository context).

---

## Architecture target (single product path)

```
VS Code: mcp-ollama/vscode-extension  (SmartCode AI Assist)
    ↓ MCP / HTTP
mcp-ollama server (MCPServer + agents)
    ↓
Ollama (+ optional ScaledOllamaProvider)
```

**Consolidate (Phase 0):**

| Action | Path |
|--------|------|
| Keep | `mcp-ollama/` server + `mcp-ollama/vscode-extension/` |
| Removed | `packages/orchestrator/` — see [packages/README.md](packages/README.md) |
| Removed | `packages/vscode-ext/` — see [packages/README.md](packages/README.md) |
| Document only | `tools/mcp-servers/` Python MCP (use if already deployed) |

---

## Phase 1 — Verified edit loop (weeks 1–2) ✅ started

**Goal:** After agent edits, run real project checks; retry on failure.

| Task | Files | Status |
|------|-------|--------|
| Project verifier (typecheck / build / test) | `mcp-ollama/src/verify/ProjectVerifier.ts` | Done |
| Wire into autonomous execution | `mcp-ollama/src/agents/AutonomousAgent.ts` | Done |
| Route AgentManager through verified agent | `mcp-ollama/src/agents/AgentManager.ts` | Done |
| Result types | `mcp-ollama/src/types/agent.ts` | Done |
| MCP tool exposes verification | `autonomous_execute` response | Done |

**Usage:** Pass `workspacePath` in context. Set `verify: false` to skip checks. Set `fast: true` for legacy 15s single-shot mode.

**Next in Phase 1:**

- [x] Extension: send `workspacePath` from `vscode.workspace.workspaceFolders[0]`
- [x] Chat UI shows `verification` checks in agent responses
- [x] `verify_workspace` MCP tool + post-accept verification in diff flow
- [x] `agent_execute` routes implement/fix/test through verified autonomous path
- [ ] Feed verifier stderr into `generateCorrection` (not only LLM validator)
- [ ] Diff panel "Accept all" should trigger post-accept verify (if not wired yet)

---

## Phase 2 — Real repository context (weeks 3–5) ✅ started

**Goal:** Replace fake semantic stack with accurate retrieval.

| Task | Files | Status |
|------|-------|--------|
| Ollama embeddings (`/api/embed`) | `src/indexing/EmbeddingService.ts` | Done |
| Symbol-aware chunking | `src/indexing/CodeChunker.ts` | Done |
| Persist index per workspace | `.coding-ai/index.json` via `CodebaseIndexer.ts` | Done |
| MCP `index_codebase`, `search_codebase`, `index_status` | `MCPServer.ts` | Done |
| Agent context from search | `AgentManager.attachCodebaseContext` | Done |
| Extension background index | `SemanticProvider.ts`, `extension.ts` | Done |
| VectorStore facade | `semantic/VectorStore.ts` → indexer | Done |

**Next in Phase 2:**

- [x] tree-sitter / TS compiler API in extension (replace regex `astParser.ts`)
- [x] Incremental index on file save (watcher)
- [ ] SQLite for large repos (optional)

**Deprecated (do not extend):**

- Char-frequency `VectorStore.embed` — removed; use `search_codebase`
- `mcp-ollama/src/lsp/LSPClient.ts` — Phase 3 (IDE-native)

---

## Phase 3 — IDE-native intelligence (weeks 5–7)

**Goal:** Stop reimplementing the IDE in the server.

| Task | Where |
|------|--------|
| Diagnostics from VS Code | `vscode-extension/src/lsp/LSPIntegration.ts` → real API |
| Symbols / references | `executeDocumentSymbolProvider`, `executeReferenceProvider` |
| Send structured context to MCP | `mcpClient.ts` payload: open files, diagnostics, symbols |

**Server role:** LLM + policy + verify only.

---

## Phase 4 — GitLab + org policy (weeks 8–12)

**Goal:** Enterprise moat for NuvoAI / private GitLab.

| Task | Files |
|------|-------|
| GitLab API service | New `src/services/GitLabService.ts` (mirror `GitHubService.ts`) |
| MR / pipeline context | `GitLabRepositoryAnalyzer.ts` |
| Policy rules engine | New `src/policy/PolicyEngine.ts` |
| Audit log | New `src/audit/AuditLog.ts` |
| Block writes on policy violation | `CodeAgent` before `writeFile` |

**Differentiator:** Copilot/Q won’t encode your internal libs and GitLab CI rules.

---

## Phase 5 — Model routing & ops (ongoing)

| Task | Files |
|------|-------|
| Task-based model selection | `OllamaProvider.ts`, new `ModelRouter.ts` |
| Metrics per route | `ScaledOllamaProvider.ts`, `telemetry` tool |
| Per-team quotas | orchestrator or new `packages/gateway` |

---

## Tool surface hygiene (parallel)

`MCPServer.ts` is ~4800 lines with many thin wrappers.

| Action | Criteria |
|--------|----------|
| Keep | Tools used by extension or agents |
| Merge | Multiple prompts → one `code_transform` with `operation` enum |
| Remove | `enterprise_tools`, duplicate chat tools, mock UI placeholders |

Target: **< 30 well-tested tools**, not 80+ one-liners.

---

## Success metrics

| Metric | Phase 1 target |
|--------|----------------|
| Autonomous tasks with `verification.passed === true` | > 60% on mcp-ollama repo |
| False-positive “success” without build | < 10% |
| P95 verify latency (npm test) | < 120s (configurable skip) |

---

## Quick reference — agent flow (after Phase 1)

```
User /dev fix login bug
  → AgentManager.executeAutonomously
  → AutonomousAgent (unless fast: true)
      analyze → plan → executeWithSelfCorrection
      → ProjectVerifier.verify(workspacePath)
      → on failure: CodeAgent fix with stderr (up to 2 retries)
  → AgentResult { verification, filesModified, proposedChanges }
  → Extension diff viewer
```

---

## Commands

```bash
cd mcp-ollama
npm run build
npm test

# Start server
npm start

# Extension
cd vscode-extension && npm run compile
```
