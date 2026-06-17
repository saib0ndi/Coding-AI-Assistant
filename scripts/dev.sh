#!/usr/bin/env bash
# Start the active MCP server for local development.
# Legacy packages/orchestrator was removed — see packages/README.md.
set -e
kill -9 $(lsof -ti:3078) 2>/dev/null || true
(cd mcp-ollama && npm run build && npm start) &
wait
