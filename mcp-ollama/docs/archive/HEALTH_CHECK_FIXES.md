# Health Check and Hardcoded Response Fixes

## Issues Fixed

### 1. Continuous Health Check Problem
**Issue**: The OllamaProvider was running a `setInterval` every 30 seconds to check memory usage, causing continuous background activity.

**Solution**:
- ✅ Made memory monitoring optional via `ENABLE_MEMORY_MONITORING` environment variable
- ✅ Changed interval from 30 seconds to 5 minutes (300,000ms) when enabled
- ✅ Added `stopResourceMonitoring()` method to properly cleanup intervals
- ✅ Added cleanup call in MCPServer.stop() method

### 2. Hardcoded Responses Problem
**Issue**: Many tool handlers were returning hardcoded values instead of sending requests to the Ollama provider.

**Solution**:
- ✅ Fixed GitHub integration tools to actually call Ollama for PR suggestions and commit messages
- ✅ Fixed IDE-specific tools to use Ollama for VS Code integration and IntelliSense
- ✅ Added logging throughout the request chain to track when requests are sent to Ollama
- ✅ Enhanced RequestRouter with detailed logging
- ✅ Enhanced OllamaProvider.handleGenericRequest with logging

## Files Modified

### `/src/providers/OllamaProvider.ts`
- Added `monitoringInterval` property to track the interval
- Made `startResourceMonitoring()` conditional on `ENABLE_MEMORY_MONITORING=true`
- Changed monitoring interval from 30s to 5min
- Added `stopResourceMonitoring()` method
- Enhanced `handleGenericRequest()` with detailed logging

### `/src/server/MCPServer.ts`
- Fixed `createGitHubIntegrationTools()` to use Ollama instead of hardcoded responses
- Fixed `createIDESpecificTools()` to use Ollama instead of hardcoded responses
- Added cleanup call to `stop()` method

### `/src/server/RequestRouter.ts`
- Added detailed logging to `handleSimpleRequest()` method
- Added console.log statements to track request routing

## Environment Variables

### New Environment Variable
- `ENABLE_MEMORY_MONITORING`: Set to `'true'` to enable memory monitoring (disabled by default)

### Existing Variables (unchanged)
- `OLLAMA_HOST`: Ollama server URL
- `OLLAMA_MODEL`: Model to use
- `OLLAMA_TIMEOUT_MS`: Request timeout

## Testing

Run the test script to verify fixes:
```bash
node test-fixes.js
```

The test will:
1. ✅ Verify continuous health check is disabled
2. ✅ Check that requests are properly logged and routed to Ollama
3. ✅ Test server startup and shutdown
4. ✅ Confirm no continuous monitoring messages appear

## Usage

### To disable memory monitoring (default):
```bash
# No environment variable needed - monitoring is disabled by default
npm start
```

### To enable memory monitoring:
```bash
ENABLE_MEMORY_MONITORING=true npm start
```

## Verification

After applying these fixes:

1. **No more continuous health checks**: The server will not run background intervals unless explicitly enabled
2. **Actual AI responses**: Tools will send requests to Ollama instead of returning hardcoded values
3. **Better logging**: You can track when requests are being sent to the Ollama provider
4. **Clean shutdown**: Resource monitoring intervals are properly cleaned up when the server stops

## Logs to Look For

When the fixes are working correctly, you should see:
```
[RequestRouter] Processing simple request: explain_code
[RequestRouter] Calling explainCode for typescript
[OllamaProvider] Making actual request to Ollama for explain_code
[OllamaProvider] Prompt: You are a helpful AI assistant...
[OllamaProvider] Received response from Ollama: This TypeScript code...
```

You should NOT see:
```
Memory usage high: 512MB
Triggering memory cleanup...
```
(Unless you explicitly enable monitoring with `ENABLE_MEMORY_MONITORING=true`)