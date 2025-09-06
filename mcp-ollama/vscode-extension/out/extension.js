"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;

const vscode = require("vscode");
const node_fetch_1 = require("node-fetch"); // keep your existing dependency

/* ---------------- helpers: safety + webview ---------------- */
const ONE_LINE = /[\r\n\x00-\x1F\x7F-\x9F]/g;
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]); // add trusted hosts if needed

function oneLine(s) {
  return String(s ?? "").replace(ONE_LINE, " ").replace(/\s{2,}/g, " ").trim();
}
function getNonce() {
  return Math.random().toString(36).slice(2);
}
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function assertSafeBaseUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (_e) { throw new Error("Invalid serverUrl"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http/https allowed");
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`Host not allowed: ${u.hostname}. Update ALLOWED_HOSTS if intended.`);
  }
  return u.toString().replace(/\/$/, "");
}

async function safeFetch(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
  const { timeoutMs: _omit, ...rest } = opts;

  try {
    // support both node-fetch v2 (timeout) and AbortController (v3 style)
    const res = await (0, node_fetch_1.default)(url, {
      redirect: "error",
      signal: controller ? controller.signal : undefined,
      timeout: timeoutMs, // harmless if ignored
      ...rest
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${text.slice(0, 200)}…)`);
  }
}

function setWebviewHtml(panel, title, codeText, bodyText) {
  const nonce = getNonce();
  const safeTitle = escapeHtml(title);
  const css = `
    body{font-family:Arial, sans-serif; padding:20px;}
    .code{background:#f5f5f5; padding:10px; border-radius:4px; margin:10px 0; white-space:pre-wrap;}
    .mono{white-space:pre-wrap;}
  `;

  // We assign user content via textContent inside a CSP-locked script to prevent XSS.
  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<style nonce="${nonce}">${css}</style>
</head>
<body>
  <h2>${safeTitle}</h2>
  <div class="code"><pre id="code" class="mono"></pre></div>
  <div id="body" class="mono"></div>
  <script nonce="${nonce}">
    const code = ${JSON.stringify(String(codeText ?? ""))};
    const body = ${JSON.stringify(String(bodyText ?? ""))};
    document.getElementById('code').textContent = code;
    document.getElementById('body').textContent = body;
  </script>
</body>
</html>`;
}

/* ---------------- extension commands ---------------- */
async function activate(context) {
  console.log("MCP Ollama Assistant is now active!");

  let serverUrl = vscode.workspace.getConfiguration("mcpOllama").get("serverUrl", "http://localhost:3002");
  try {
    serverUrl = await assertSafeBaseUrl(serverUrl);
  } catch (e) {
    vscode.window.showErrorMessage(`Invalid/unsafe serverUrl: ${oneLine(e.message || e)}`);
    return;
  }

  // Fix Error
  const fixErrorCommand = vscode.commands.registerCommand("mcpOllama.fixError", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText) {
      vscode.window.showWarningMessage("Please select code to fix");
      return;
    }

    try {
      const res = await safeFetch(`${serverUrl}/api/fix-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          errorMessage: "Selected code error",
          code: selectedText,
          language: editor.document.languageId
        }),
        timeoutMs: 12000
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await readJson(res);

      if (result?.success && result?.data?.recommendedFix) {
        const title = oneLine(result.data.recommendedFix.title ?? "Fix");
        const action = await vscode.window.showInformationMessage(
          `Fix found: ${title}`, "Apply Fix", "Show Details"
        );
        if (action === "Apply Fix") {
          await editor.edit(ed => ed.replace(selection, String(result.data.recommendedFix.fixedCode ?? "")));
          vscode.window.showInformationMessage("Fix applied successfully!");
        } else if (action === "Show Details") {
          const panel = vscode.window.createWebviewPanel(
            "fixDetails", "Fix Details", vscode.ViewColumn.Beside, {}
          );
          setWebviewHtml(panel, "Fix Details", selectedText, String(result.data.recommendedFix.fixedCode ?? ""));
        }
      } else {
        vscode.window.showWarningMessage("No fix found for the selected code");
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error fixing failed: ${oneLine(error.message || error)}`);
    }
  });

  // Explain Code
  const explainCodeCommand = vscode.commands.registerCommand("mcpOllama.explainCode", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText) {
      vscode.window.showWarningMessage("Please select code to explain");
      return;
    }

    try {
      const res = await safeFetch(`${serverUrl}/api/analyze-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: selectedText,
          language: editor.document.languageId,
          analysisType: "explanation"
        }),
        timeoutMs: 15000
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await readJson(res);

      if (result?.success) {
        const panel = vscode.window.createWebviewPanel(
          "codeExplanation", "Code Explanation", vscode.ViewColumn.Beside, {}
        );
        setWebviewHtml(panel, "Code Explanation", selectedText, String(result?.data?.analysis ?? ""));
      } else {
        vscode.window.showWarningMessage("No explanation returned");
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Code explanation failed: ${oneLine(error.message || error)}`);
    }
  });

  // Generate Code
  const generateCommand = vscode.commands.registerCommand("mcpOllama.generateCode", async () => {
    const prompt = await vscode.window.showInputBox({
      prompt: "Describe the code you want to generate",
      placeHolder: "e.g., Create a function to sort an array"
    });
    if (!prompt) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    try {
      const res = await safeFetch(`${serverUrl}/api/analyze-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: `// ${prompt}`,
          language: editor.document.languageId,
          analysisType: "explanation"
        }),
        timeoutMs: 15000
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await readJson(res);

      if (result?.success) {
        const action = await vscode.window.showInformationMessage(
          "Code generated successfully!", "Insert at Cursor"
        );
        if (action === "Insert at Cursor") {
          await editor.edit(ed => {
            ed.insert(editor.selection.active, `\n// Generated for: ${prompt}\n${String(result?.data?.analysis ?? "")}\n`);
          });
        }
      } else {
        vscode.window.showWarningMessage("Generation did not return a success payload");
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Code generation failed: ${oneLine(error.message || error)}`);
    }
  });

  // Diagnose Code
  const diagnoseCommand = vscode.commands.registerCommand("mcpOllama.diagnoseCode", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    try {
      const res = await safeFetch(`${serverUrl}/api/analyze-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editor.document.getText(),
          language: editor.document.languageId,
          analysisType: "bugs"
        }),
        timeoutMs: 20000
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await readJson(res);

      if (result?.success) {
        vscode.window.showInformationMessage(
          `Code analysis: ${oneLine(String(result?.data?.analysis ?? "Analysis complete."))}`
        );
      } else {
        vscode.window.showWarningMessage("Diagnosis did not return a success payload");
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Code diagnosis failed: ${oneLine(error.message || error)}`);
    }
  });

  // Refactor Code
  const refactorCommand = vscode.commands.registerCommand("mcpOllama.refactorCode", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText) {
      vscode.window.showWarningMessage("Please select code to refactor");
      return;
    }

    try {
      const res = await safeFetch(`${serverUrl}/api/analyze-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: selectedText,
          language: editor.document.languageId,
          analysisType: "refactoring"
        }),
        timeoutMs: 15000
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await readJson(res);

      if (result?.success) {
        const panel = vscode.window.createWebviewPanel(
          "refactoringSuggestions", "Refactoring Suggestions", vscode.ViewColumn.Beside, {}
        );
        setWebviewHtml(panel, "Refactoring Suggestions", selectedText, String(result?.data?.analysis ?? ""));
      } else {
        vscode.window.showWarningMessage("No refactoring suggestions returned");
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Refactoring failed: ${oneLine(error.message || error)}`);
    }
  });

  context.subscriptions.push(
    fixErrorCommand, explainCodeCommand, generateCommand, diagnoseCommand, refactorCommand
  );
}
exports.activate = activate;

function deactivate() {}
exports.deactivate = deactivate;
