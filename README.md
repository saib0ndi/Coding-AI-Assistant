# Coding AI Assistant

Private, local-first AI coding assistant powered by [Ollama](https://ollama.com) and the Model Context Protocol (MCP). Ships as an MCP server plus a VS Code extension (**SmartCode AI Assist**) with chat, inline completion, and verified multi-agent edits.

## Architecture

```
VS Code  →  mcp-ollama/vscode-extension  (SmartCode AI Assist)
                ↓ MCP / HTTP
           mcp-ollama server  (tools, agents, verification)
                ↓
           Ollama  (local LLM)
```

The retired `packages/orchestrator` and `packages/vscode-ext` paths were consolidated into `mcp-ollama/`. See [packages/README.md](packages/README.md).

## Quick start

**Prerequisites:** Node.js 18+, [Ollama](https://ollama.com), VS Code 1.109+

```bash
# 1. Start Ollama and pull a model
ollama serve
ollama pull llama3.1:8b-instruct-q4_K_M

# 2. Build and run the MCP server
cd mcp-ollama
npm install && npm run build && npm start

# 3. Install the VS Code extension (from repo)
cd vscode-extension
npm install && npm run compile
code --install-extension smartcode-aiassist-*.vsix   # or F5 “Run Extension” for dev
```

Open chat with **Ctrl+Shift+M**. Agent commands (`/dev`, `/test`, `/review`) plan workflows and preview diffs before applying edits.

Detailed guides: [mcp-ollama/QUICK_START_GUIDE.md](mcp-ollama/QUICK_START_GUIDE.md) · [mcp-ollama/docs/](mcp-ollama/docs/)

## Repository layout

| Path | Description |
|------|-------------|
| `mcp-ollama/` | MCP server, agents, tools, tests |
| `mcp-ollama/vscode-extension/` | VS Code extension (published as SmartCode AI Assist) |
| `tools/mcp-servers/` | Optional legacy Python MCP server |
| `packages/` | Deprecated placeholder — see [packages/README.md](packages/README.md) |
| `ROADMAP.md` | Product roadmap and consolidation plan |

## Development

```bash
# Server unit tests
cd mcp-ollama && npm test

# Extension compile
npm run build:ext        # from repo root

# Server build
npm run build:server     # from repo root
```

Configuration: copy `mcp-ollama/.env.example` to `mcp-ollama/.env` and set `OLLAMA_HOST`, server port, etc.

## Features

- **MCP tools** — code completion, explanation, refactoring, tests, docs, security scan, workspace analysis
- **Multi-agent workflows** — file, code, test, and project agents with rule-based planning
- **Verified edits** — build/test checks after autonomous changes; review panel before apply
- **Local-only** — runs against your Ollama instance; no cloud API required

## Documentation

- [Tools reference](mcp-ollama/TOOLS_REFERENCE.md)
- [Architecture overview](mcp-ollama/ARCHITECTURE_OVERVIEW.md)
- [Agent capabilities](mcp-ollama/AGENT_CAPABILITIES.md)
- [Roadmap](ROADMAP.md)
- Historical one-off reports: [mcp-ollama/docs/archive/](mcp-ollama/docs/archive/) (not maintained)

## License

MIT — see package manifests in `mcp-ollama/` and `mcp-ollama/vscode-extension/`.
