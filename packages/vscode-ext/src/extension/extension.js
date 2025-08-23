"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
function cfgServerUrl() {
    const cfg = vscode.workspace.getConfiguration();
    return cfg.get("codingAiAssistant.serverUrl") || "http://localhost:8787";
}
function activate(context) {
    // OPEN PANEL
    const openCmd = vscode.commands.registerCommand("aiassist.open", () => {
        const panel = vscode.window.createWebviewPanel("aiassistChat", "AI Assist", vscode.ViewColumn.Beside, { enableScripts: true });
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
        panel.webview.onDidReceiveMessage((msg) => __awaiter(this, void 0, void 0, function* () {
            if ((msg === null || msg === void 0 ? void 0 : msg.type) === "ping") {
                try {
                    const resp = yield fetch(`${cfgServerUrl()}/status`);
                    const json = (yield resp.json());
                    panel.webview.postMessage({ type: "status", payload: json });
                }
                catch (err) {
                    panel.webview.postMessage({ type: "error", payload: (err === null || err === void 0 ? void 0 : err.message) || String(err) });
                }
            }
        }));
    });
    // SET TOKEN (stored securely; not used by the demo /chat yet)
    const setTokCmd = vscode.commands.registerCommand("aiassist.setToken", () => __awaiter(this, void 0, void 0, function* () {
        const token = yield vscode.window.showInputBox({
            prompt: "Enter API token (stored securely)",
            password: true,
            placeHolder: "sk-..."
        });
        if (token) {
            yield context.secrets.store("aiassist.token", token);
            vscode.window.showInformationMessage("AI Assist: token saved securely.");
        }
    }));
    // PROPOSE NEXT EDIT (asks orchestrator for an edit and applies it)
    const proposeCmd = vscode.commands.registerCommand("aiassist.proposeEdit", () => __awaiter(this, void 0, void 0, function* () {
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
            const resp = yield fetch(`${cfgServerUrl()}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const json = (yield resp.json());
            if (!(json === null || json === void 0 ? void 0 : json.ok))
                throw new Error((json === null || json === void 0 ? void 0 : json.message) || "Server error");
            yield editor.edit((eb) => {
                if (json.type === "append" && typeof json.text === "string") {
                    const end = new vscode.Position(doc.lineCount, 0);
                    eb.insert(end, json.text);
                }
                else if (json.type === "replace" && json.range && typeof json.text === "string") {
                    const r = json.range;
                    const range = new vscode.Range(new vscode.Position(r.start.line, r.start.character), new vscode.Position(r.end.line, r.end.character));
                    eb.replace(range, json.text);
                }
            });
            vscode.window.showInformationMessage("AI Assist applied a proposed edit.");
        }
        catch (err) {
            vscode.window.showErrorMessage(`AI Assist failed: ${(err === null || err === void 0 ? void 0 : err.message) || String(err)}`);
        }
    }));
    context.subscriptions.push(openCmd, setTokCmd, proposeCmd);
}
function deactivate() { }
