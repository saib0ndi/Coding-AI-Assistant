import * as vscode from "vscode";
import fetch, { RequestInit, Response } from "node-fetch";

/* ----------------- small safety helpers ----------------- */
const ONE_LINE = /[\r\n\x00-\x1F\x7F-\x9F]/g;
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]); // add others if you trust them

function oneLine(s: unknown): string {
  return String(s ?? "").replace(ONE_LINE, " ").replace(/\s{2,}/g, " ").trim();
}

async function assertSafeBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid serverUrl");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https allowed");
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Host not allowed: ${url.hostname}. Update the allowlist in extension.ts if intended.`);
  }
  // normalize: strip trailing slash
  return url.toString().replace(/\/$/, "");
}

async function safeFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
    return res;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${init.timeoutMs ?? 8000}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON (${text.slice(0, 200)}…)`);
  }
}

function getNonce(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
}

function webviewHtml(panel: vscode.WebviewPanel, title: string, code: string, body: string) {
  const nonce = getNonce();
  const css = `
    body{font-family:Arial, sans-serif; padding:20px;}
    .code{background:#f5f5f5; padding:10px; border-radius:4px; margin:10px 0; white-space:pre-wrap;}
    .mono{white-space:pre-wrap;}
  `;
  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style nonce="${nonce}">${css}</style>
</head>
<body>
  <h2>${title}</h2>
  <div class="code"><pre id="code" class="mono"></pre></div>
  <div id="body" class="mono"></div>
  <script nonce="${nonce}">
    const code = ${JSON.stringify(code)};
    const body = ${JSON.stringify(body)};
    document.getElementById('code').textContent = code;
    document.getElementById('body').textContent = body;
  </script>
</body>
</html>`;
}

/* ----------------- helper functions ----------------- */
function validateEditor(): vscode.TextEditor | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor found");
    return null;
  }
  return editor;
}

function getSelectedText(editor: vscode.TextEditor): string | null {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  if (!selectedText) {
    vscode.window.showWarningMessage("Please select code first");
    return null;
  }
  return selectedText;
}

async function makeApiCall(baseUrl: string, endpoint: string, payload: any, timeoutMs = 10000): Promise<any> {
  const res = await safeFetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await readJson(res);
}

function handleApiError(operation: string, error: unknown): void {
  vscode.window.showErrorMessage(`${operation} failed: ${oneLine((error as Error).message)}`);
}

/* ----------------- core commands ----------------- */
export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("MCP Ollama Assistant");
  outputChannel.appendLine("MCP Ollama Assistant activated");

  let baseUrl: string;
  try {
    const configured = vscode.workspace.getConfiguration("mcpOllama").get<string>("serverUrl", "http://localhost:3002");
    baseUrl = await assertSafeBaseUrl(configured);
  } catch (e) {
    vscode.window.showErrorMessage(`Invalid/unsafe serverUrl: ${oneLine((e as Error).message)}`);
    return;
  }

  const fixErrorCommand = vscode.commands.registerCommand("mcpOllama.fixError", async () => {
    const editor = validateEditor();
    if (!editor) return;

    const selectedText = getSelectedText(editor);
    if (!selectedText) return;

    try {
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      const errorMessage = diagnostics.length > 0 ? diagnostics[0].message : "Code analysis requested";
      const result = await makeApiCall(baseUrl, "/api/fix-error", {
        errorMessage,
        code: selectedText,
        language: editor.document.languageId,
      });

      if (result?.success && result?.data?.recommendedFix) {
        const title = oneLine(result.data.recommendedFix.title ?? "Fix");
        const action = await vscode.window.showInformationMessage(`Fix found: ${title}`, "Apply Fix", "Show Details");
        if (action === "Apply Fix") {
          await editor.edit((ed) => ed.replace(editor.selection, String(result.data.recommendedFix.fixedCode ?? "")));
          vscode.window.showInformationMessage("Fix applied successfully!");
        } else if (action === "Show Details") {
          const panel = vscode.window.createWebviewPanel("fixDetails", "Fix Details", vscode.ViewColumn.Beside, {});
          webviewHtml(panel, "Fix Details", selectedText, String(result.data.recommendedFix.fixedCode ?? ""));
        }
      } else {
        vscode.window.showWarningMessage("No fix found for the selected code");
      }
    } catch (e) {
      handleApiError("Error fixing", e);
    }
  });

  const explainCodeCommand = vscode.commands.registerCommand("mcpOllama.explainCode", async () => {
    const editor = validateEditor();
    if (!editor) return;

    const selectedText = getSelectedText(editor);
    if (!selectedText) return;

    try {
      const result = await makeApiCall(baseUrl, "/api/analyze-code", {
        code: selectedText,
        language: editor.document.languageId,
        analysisType: "explanation",
      }, 15000);
      if (result?.success) {
        const panel = vscode.window.createWebviewPanel("codeExplanation", "Code Explanation", vscode.ViewColumn.Beside, {});
        webviewHtml(panel, "Code Explanation", selectedText, String(result?.data?.analysis ?? ""));
      } else {
        vscode.window.showWarningMessage("No explanation returned");
      }
    } catch (e) {
      handleApiError("Code explanation", e);
    }
  });

  const generateCommand = vscode.commands.registerCommand("mcpOllama.generateCode", async () => {
    const prompt = await vscode.window.showInputBox({
      prompt: "Describe the code you want to generate",
      placeHolder: "e.g., Create a function to sort an array",
    });
    if (!prompt) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    try {
      const result = await makeApiCall(baseUrl, "/api/analyze-code", {
        code: `// ${prompt}`,
        language: editor.document.languageId,
        analysisType: "generation",
      }, 15000);
      if (result?.success) {
        const action = await vscode.window.showInformationMessage("Code generated successfully!", "Insert at Cursor");
        if (action === "Insert at Cursor") {
          await editor.edit((ed) => {
            ed.insert(editor.selection.active, `\n// Generated for: ${prompt}\n${String(result?.data?.analysis ?? "")}\n`);
          });
        }
      } else {
        vscode.window.showWarningMessage("Generation did not return a success payload");
      }
    } catch (e) {
      handleApiError("Code generation", e);
    }
  });

  const diagnoseCommand = vscode.commands.registerCommand("mcpOllama.diagnoseCode", async () => {
    const editor = validateEditor();
    if (!editor) return;

    try {
      const visibleRange = editor.visibleRanges[0];
      const codeToAnalyze = visibleRange ? editor.document.getText(visibleRange) : editor.document.getText();
      const result = await makeApiCall(baseUrl, "/api/analyze-code", {
        code: codeToAnalyze,
        language: editor.document.languageId,
        analysisType: "bugs",
      }, 20000);
      if (result?.success) {
        const msg = oneLine(String(result?.data?.analysis ?? "Analysis complete."));
        vscode.window.showInformationMessage(`Code analysis: ${msg}`);
      } else {
        vscode.window.showWarningMessage("Diagnosis did not return a success payload");
      }
    } catch (e) {
      handleApiError("Code diagnosis", e);
    }
  });

  const refactorCommand = vscode.commands.registerCommand("mcpOllama.refactorCode", async () => {
    const editor = validateEditor();
    if (!editor) return;

    const selectedText = getSelectedText(editor);
    if (!selectedText) return;

    try {
      const result = await makeApiCall(baseUrl, "/api/analyze-code", {
        code: selectedText,
        language: editor.document.languageId,
        analysisType: "refactoring",
      }, 15000);
      if (result?.success) {
        const panel = vscode.window.createWebviewPanel("refactoringSuggestions", "Refactoring Suggestions", vscode.ViewColumn.Beside, {});
        webviewHtml(panel, "Refactoring Suggestions", selectedText, String(result?.data?.analysis ?? ""));
      } else {
        vscode.window.showWarningMessage("No refactoring suggestions returned");
      }
    } catch (e) {
      handleApiError("Refactoring", e);
    }
  });

  context.subscriptions.push(fixErrorCommand, explainCodeCommand, generateCommand, diagnoseCommand, refactorCommand);
}

export function deactivate() {
  // Cleanup resources if needed
}
