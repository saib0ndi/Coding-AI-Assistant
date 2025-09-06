# Quick Test Guide for MCP Ollama Extension

## 🚀 Step-by-Step Testing

### 1. Open VS Code Extension Development
```bash
# Navigate to extension directory
cd /home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama/vscode-extension

# Open in VS Code
code .
```

### 2. Launch Extension Development Host
- In VS Code, press `F5` or go to `Run > Start Debugging`
- This opens a new "Extension Development Host" window
- Your extension is now loaded in this new window

### 3. Test Extension Commands

#### Method 1: Command Palette
1. In the Extension Development Host window, press `Ctrl+Shift+P`
2. Type "MCP Ollama" - you should see:
   - `MCP Ollama: Generate Code from Description`
   - `MCP Ollama: Diagnose Code Issues`

#### Method 2: Right-Click Menu
1. Open the `test.js` file in Extension Development Host
2. Select some buggy code (like `console.log(user.name);`)
3. Right-click - you should see:
   - `Fix Error with AI`
   - `Explain Code`
   - `Suggest Refactoring`

### 4. Verify Extension is Active
Check VS Code's Output panel:
- `View > Output`
- Select "Log (Extension Host)" from dropdown
- Look for: "MCP Ollama Assistant is now active!"

### 5. Test with MCP Server
Make sure MCP server is running:
```bash
# In another terminal
cd /home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama
npm start
```

## 🔍 Troubleshooting

### Extension Not Visible?
1. **Check Extension Host Console:**
   - `Help > Toggle Developer Tools` in Extension Development Host
   - Look for errors in Console tab

2. **Verify Activation:**
   - Extension activates on startup (`onStartupFinished`)
   - Should work immediately when Extension Development Host opens

3. **Check Package.json:**
   - Commands should be registered in `contributes.commands`
   - Menus should be in `contributes.menus`

### Commands Not Working?
1. **Server Connection:**
   ```bash
   curl http://localhost:3002/api/health
   ```

2. **Check Settings:**
   - `File > Preferences > Settings`
   - Search "MCP Ollama"
   - Verify server URL: `http://localhost:3002`

## 🎯 Expected Behavior

### When Working Correctly:
1. **Command Palette:** Shows MCP Ollama commands
2. **Right-Click Menu:** Shows AI options when text selected
3. **Error Fixing:** Sends code to server, shows fix suggestions
4. **Code Explanation:** Opens webview panel with explanation

### Visual Confirmation:
- Commands appear in Command Palette with "MCP Ollama:" prefix
- Right-click context menu has "MCP Ollama" section
- Progress notifications show "Fixing error with AI..."
- Results display in webview panels or notifications

## 🚀 Quick Demo Script

1. Open Extension Development Host (`F5`)
2. Create new file: `demo.js`
3. Type: `const x = undefinedVariable;`
4. Select the line
5. Right-click → "Fix Error with AI"
6. Should show fix suggestion or error message

If you see the commands but get errors, the extension is working - just need to ensure MCP server is running!