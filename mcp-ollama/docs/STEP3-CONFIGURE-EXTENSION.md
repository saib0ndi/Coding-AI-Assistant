# Step 3: Configure Extension

## Automatic Configuration

The extension is **pre-configured** to use the hosted Docker server:
- **Server URL**: `http://localhost:3078`
- **No manual configuration needed**

## Verify Configuration

1. Open VSCode
2. Press `Ctrl+,` (Settings)
3. Search for "mcp-ollama"
4. Check that `mcp-ollama.serverUrl` is set to: `http://localhost:3078`

## Manual Configuration (Optional)

If you need to change settings:

```json
{
  "mcp-ollama.serverUrl": "http://localhost:3078",
  "mcp-ollama.enabled": true,
  "mcp-ollama.model": "llama3.1:8b-instruct-q4_K_M"
}
```

## Test Configuration

```bash
# Test server connection
curl http://localhost:3078/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2025-11-05T11:10:05.451Z"}
```

## Next Step
➡️ [Step 4: Start Using Extension](STEP4-START-USING.md)