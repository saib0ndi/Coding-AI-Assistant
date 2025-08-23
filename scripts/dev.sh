#!/usr/bin/env bash
set -e
kill -9 $(lsof -ti:10000,8787) 2>/dev/null || true
(cd tools/mcp-servers/aiassist_mcp && source ../.venv/bin/activate && AIASSIST_MCP_TOKEN=${AIASSIST_MCP_TOKEN:-secret} PORT=10000 python3 server.py) &
(cd packages/orchestrator && PORT=8787 MCP_URL=http://127.0.0.1:10000 AIASSIST_MCP_TOKEN=${AIASSIST_MCP_TOKEN:-secret} OLLAMA_BASE_URL=http://127.0.0.1:11434 pnpm dev) &
wait
