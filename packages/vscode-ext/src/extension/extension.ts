import * as vscode from "vscode";

function cfgServerUrl(): string {
  const cfg = vscode.workspace.getConfiguration();
  return cfg.get<string>("codingAiAssistant.serverUrl") || "http://localhost:8787";
}

export function activate(context: vscode.ExtensionContext) {
  // OPEN PANEL
  const openCmd = vscode.commands.registerCommand("aiassist.open", () => {
    const panel = vscode.window.createWebviewPanel(
      "aiassistChat",
      "AI Assist",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = `<!doctype html>
<html>
<body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem;">
  <h2 style="margin-top:0">AI Assist</h2>
  <p>Click ping to check the orchestrator status at <code>${cfgServerUrl()}</code>.</p>
  <button id="ping">Ping Orchestrator</button>
  <pre id="out" style="white-space:pre-wrap;border:1px solid var(--vscode-editorWidget-border);padding:.5rem;border-radius:.5rem;margin-top:1rem;"></pre>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('ping').onclick = () => vscode.postMessage({type:'ping'});
    window.addEventListener('message', (event) => {
      const {type, payload} = event.data || {};
      const out = document.getElementById('out');
      if(type==='status'){ out.textContent = JSON.stringify(payload,null,2); }
      if(type==='error'){ out.textContent = String(payload); }
    });
  </script>
</body>
</html>`;

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "ping") {
        try {
          const resp = await fetch(`${cfgServerUrl()}/status`);
          const json = (await resp.json()) as any;
          panel.webview.postMessage({ type: "status", payload: json });
        } catch (err: any) {
          panel.webview.postMessage({ type: "error", payload: err?.message || String(err) });
        }
      }
    });
  });

  // SET TOKEN (stored securely; not used by the demo /chat yet)
  const setTokCmd = vscode.commands.registerCommand("aiassist.setToken", async () => {
    const token = await vscode.window.showInputBox({
      prompt: "Enter API token (stored securely)",
      password: true,
      placeHolder: "sk-..."
    });
    if (token) {
      await context.secrets.store("aiassist.token", token);
      vscode.window.showInformationMessage("AI Assist: token saved securely.");
    }
  });

  // PROPOSE NEXT EDIT (asks orchestrator for an edit and applies it)
  const proposeCmd = vscode.commands.registerCommand("aiassist.proposeEdit", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("Open a file to propose an edit.");
      return;
    }
    const doc = editor.document;
    const body = {
      fileName: doc.fileName,
      languageId: doc.languageId,
      text: doc.getText()
    };

    try {
      const resp = await fetch(`${cfgServerUrl()}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await resp.json()) as any;
      if (!json?.ok) throw new Error(json?.message || "Server error");

      await editor.edit((eb) => {
        if (json.type === "append" && typeof json.text === "string") {
          const end = new vscode.Position(doc.lineCount, 0);
          eb.insert(end, json.text);
        } else if (json.type === "replace" && json.range && typeof json.text === "string") {
          const r = json.range;
          const range = new vscode.Range(
            new vscode.Position(r.start.line, r.start.character),
            new vscode.Position(r.end.line, r.end.character)
          );
          eb.replace(range, json.text);
        }
      });

      vscode.window.showInformationMessage("AI Assist applied a proposed edit.");
    } catch (err: any) {
      vscode.window.showErrorMessage(`AI Assist failed: ${err?.message || String(err)}`);
    }
  });

  context.subscriptions.push(openCmd, setTokCmd, proposeCmd);
}

export function deactivate() {}
