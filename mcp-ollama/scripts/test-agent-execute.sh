#!/usr/bin/env bash
# Smoke test agent_execute with auto-discovered MCP base URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_BASE="$("${SCRIPT_DIR}/mcp-base-url.sh")"
WORKSPACE="${1:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

echo "MCP_BASE=$MCP_BASE"
echo "WORKSPACE=$WORKSPACE"
echo "Calling agent_execute (may take 1-3 minutes)..."

curl -sS --max-time 300 -X POST "${MCP_BASE}/tools/agent_execute" \
  -H "Content-Type: application/json" \
  -d "{
    \"description\": \"Add a one-line comment above embed() in src/indexing/EmbeddingService.ts\",
    \"type\": \"implement\",
    \"context\": {
      \"workspacePath\": \"${WORKSPACE}\",
      \"files\": [\"src/indexing/EmbeddingService.ts\"],
      \"language\": \"typescript\",
      \"verify\": true,
      \"previewChanges\": true
    }
  }" | jq '{success, verified, filesModified, proposed: [.proposedChanges[]?.filePath], summary}'
