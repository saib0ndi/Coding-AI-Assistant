import * as vscode from 'vscode';

export function registerInlineProvider(ctx: vscode.ExtensionContext) {
  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(doc, pos) {
      const server = vscode.workspace.getConfiguration().get<string>('codingAiAssistant.serverUrl') || 'http://127.0.0.1:8787';
      const payload = {
        language: doc.languageId,
        filePath: doc.uri.fsPath,
        cursor: doc.offsetAt(pos),
        text: doc.getText()
      };
      const res = await fetch(`${server}/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const reader = res.body?.getReader(); if (!reader) return;
      const dec = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        const chunk = dec.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) {
            try { const j = JSON.parse(line.slice(5)); if (j.text) acc += j.text; } catch {}
          }
        }
      }
      if (!acc) return;
      return { items: [ new vscode.InlineCompletionItem(acc, new vscode.Range(pos, pos)) ] };
    }
  };
  ctx.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**/*' }, provider));
}
