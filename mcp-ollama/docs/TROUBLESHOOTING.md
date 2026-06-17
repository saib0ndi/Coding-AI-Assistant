# Troubleshooting Guide

## Common Issues and Solutions

### Issue: "command 'mcp-ollama.showChatPanel' not found"

This means the extension is not properly activated or compiled.

**Solution:**

1. **Compile the extension:**
```bash
cd vscode-extension
npm install
npm run compile
```

2. **Reinstall the extension:**
```bash
code --uninstall-extension smartcode-aiassist
code --install-extension smartcode-aiassist-3.10.2.vsix --force
```

3. **Restart VSCode completely:**
- Close all VSCode windows
- Reopen VSCode
- Try the command again

4. **Check extension status:**
```bash
# List installed extensions
code --list-extensions | grep smartcode

# Check if extension is active
# Press Ctrl+Shift+P and type "Developer: Reload Window"
```

### Alternative Commands to Try

If `mcp-ollama.showChatPanel` doesn't work, try these:

```
SmartCode: Open AI Chat
SmartCode: Explain Code
SmartCode: Fix Code Issues
SmartCode: Generate Tests
```

### Manual Activation

1. Press `Ctrl+Shift+P`
2. Type "Extensions: Show Installed Extensions"
3. Find "SmartCode AI Assistant"
4. Click "Reload" or "Enable"

### Check Extension Logs

1. Press `Ctrl+Shift+P`
2. Type "Developer: Toggle Developer Tools"
3. Go to Console tab
4. Look for MCP-Ollama related errors

### Server Connection Test

```bash
# Test if server is accessible
curl http://localhost:3078/health

# Expected response:
# {"status":"healthy","timestamp":"..."}
```

### Reset Extension Settings

1. Open VSCode Settings (`Ctrl+,`)
2. Search for "mcp-ollama"
3. Reset all settings to default
4. Set server URL to: `http://localhost:3078`

### Complete Reinstall

```bash
# Remove extension
code --uninstall-extension smartcode-aiassist

# Clear VSCode cache (optional)
rm -rf ~/.vscode/extensions/smartcode*

# Reinstall
cd vscode-extension
code --install-extension smartcode-aiassist-3.10.2.vsix --force

# Restart VSCode
```

### Check Extension Activation

1. Press `Ctrl+Shift+P`
2. Type "mcp-ollama.status"
3. This should show extension component status

### If Nothing Works

Try using the extension through right-click context menu:
1. Select some code
2. Right-click
3. Look for SmartCode options in context menu

Or use keyboard shortcuts:
- `Ctrl+Shift+M` - Open AI Chat
- `Ctrl+Shift+E` - Explain Code