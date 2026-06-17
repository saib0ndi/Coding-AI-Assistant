#!/usr/bin/env bash
# Print MCP server base URL (http://localhost:PORT) by probing /health.
set -euo pipefail

START="${MCP_SERVER_PORT:-3078}"
END="${MCP_PORT_SCAN_END:-3085}"

for ((p = START; p <= END; p++)); do
  resp=$(curl -s -m 2 "http://localhost:${p}/health" 2>/dev/null || true)
  if [ -n "$resp" ]; then
    base=$(echo "$resp" | jq -r '.baseUrl // empty' 2>/dev/null || true)
    if [ -n "$base" ] && [ "$base" != "null" ]; then
      echo "$base"
      exit 0
    fi
    if echo "$resp" | jq -e '.status == "healthy"' >/dev/null 2>&1; then
      echo "http://localhost:${p}"
      exit 0
    fi
  fi
done

echo "ERROR: MCP server not found on ports ${START}-${END}. Run: cd mcp-ollama && npm start" >&2
exit 1
