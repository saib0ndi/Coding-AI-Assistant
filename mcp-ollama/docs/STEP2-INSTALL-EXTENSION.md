# Step 2: Install VSCode Extension

## Install the Extension

```bash
# Navigate to extension directory
cd vscode-extension

# Install the extension
code --install-extension smartcode-aiassist-3.10.2.vsix
```

## Alternative Installation Methods

**Force install (if already exists):**
```bash
code --install-extension smartcode-aiassist-3.10.2.vsix --force
```

**Manual installation:**
1. Open VSCode
2. Press `Ctrl+Shift+P`
3. Type "Extensions: Install from VSIX"
4. Select `smartcode-aiassist-3.10.2.vsix`

## Verify Installation

```bash
# Check if extension is installed
code --list-extensions | grep smartcode
```

## Next Step
➡️ [Step 3: Configure Extension](STEP3-CONFIGURE-EXTENSION.md)