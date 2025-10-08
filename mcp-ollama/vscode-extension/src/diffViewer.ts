import * as vscode from 'vscode';

export interface FileDiff {
    filePath: string;
    original: string;
    modified: string;
    status: 'added' | 'modified' | 'deleted';
}

export class DiffViewer {
    private panel: vscode.WebviewPanel | undefined;
    private diffs: FileDiff[] = [];
    private onAcceptCallback?: (filePath: string) => void;
    private onRejectCallback?: (filePath: string) => void;

    constructor(private context: vscode.ExtensionContext) {}

    showDiffs(diffs: FileDiff[], onAccept?: (filePath: string) => void, onReject?: (filePath: string) => void) {
        this.diffs = diffs;
        this.onAcceptCallback = onAccept;
        this.onRejectCallback = onReject;

        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = vscode.window.createWebviewPanel(
            'diffViewer',
            'Code Changes Review',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getDiffHTML();
        this.setupMessageHandling();
    }

    private getDiffHTML(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Code Changes Review</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 0;
        }
        .header {
            padding: 16px 20px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .title {
            font-size: 16px;
            font-weight: 600;
        }
        .actions {
            display: flex;
            gap: 8px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
        }
        .accept-all {
            background: #4CAF50;
            color: white;
        }
        .reject-all {
            background: #f44336;
            color: white;
        }
        .file-diff {
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .file-header {
            padding: 12px 20px;
            background: var(--vscode-sideBar-background);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .file-path {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            font-weight: 500;
        }
        .file-status {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }
        .status-added { background: #4CAF50; color: white; }
        .status-modified { background: #2196F3; color: white; }
        .status-deleted { background: #f44336; color: white; }
        .file-actions {
            display: flex;
            gap: 8px;
        }
        .accept-file {
            background: #4CAF50;
            color: white;
        }
        .reject-file {
            background: #f44336;
            color: white;
        }
        .diff-container {
            display: flex;
            height: 400px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .diff-side {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .diff-side-header {
            padding: 8px 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-size: 12px;
            font-weight: 600;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .original { border-right: 1px solid var(--vscode-panel-border); }
        .diff-content {
            flex: 1;
            overflow: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            line-height: 1.4;
            padding: 0;
        }
        .line {
            display: flex;
            min-height: 20px;
        }
        .line-number {
            width: 40px;
            padding: 0 8px;
            background: var(--vscode-editorGutter-background);
            color: var(--vscode-editorLineNumber-foreground);
            text-align: right;
            font-size: 11px;
            border-right: 1px solid var(--vscode-panel-border);
            user-select: none;
        }
        .line-content {
            flex: 1;
            padding: 0 8px;
            white-space: pre;
        }
        .line-added {
            background: rgba(76, 175, 80, 0.2);
        }
        .line-removed {
            background: rgba(244, 67, 54, 0.2);
        }
        .line-unchanged {
            background: transparent;
        }
        .no-changes {
            padding: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🔍 Code Changes Review (${this.diffs.length} files)</div>
        <div class="actions">
            <button class="btn accept-all" onclick="acceptAll()">✓ Accept All</button>
            <button class="btn reject-all" onclick="rejectAll()">✗ Reject All</button>
        </div>
    </div>
    
    <div id="diffs">
        ${this.diffs.length === 0 ? '<div class="no-changes">No changes to review</div>' : 
          this.diffs.map((diff, index) => this.getFileDiffHTML(diff, index)).join('')}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function acceptFile(filePath) {
            vscode.postMessage({ command: 'acceptFile', filePath });
        }
        
        function rejectFile(filePath) {
            vscode.postMessage({ command: 'rejectFile', filePath });
        }
        
        function acceptAll() {
            vscode.postMessage({ command: 'acceptAll' });
        }
        
        function rejectAll() {
            vscode.postMessage({ command: 'rejectAll' });
        }
        
        // Sync scroll between diff sides
        document.querySelectorAll('.diff-content').forEach((content, index) => {
            content.addEventListener('scroll', (e) => {
                const otherIndex = index % 2 === 0 ? index + 1 : index - 1;
                const otherContent = document.querySelectorAll('.diff-content')[otherIndex];
                if (otherContent) {
                    otherContent.scrollTop = e.target.scrollTop;
                }
            });
        });
    </script>
</body>
</html>`;
    }

    private getFileDiffHTML(diff: FileDiff, index: number): string {
        const lines = this.generateDiffLines(diff.original, diff.modified);
        
        return `
            <div class="file-diff">
                <div class="file-header">
                    <div>
                        <span class="file-path">${diff.filePath}</span>
                        <span class="file-status status-${diff.status}">${diff.status.toUpperCase()}</span>
                    </div>
                    <div class="file-actions">
                        <button class="btn accept-file" onclick="acceptFile('${diff.filePath}')">✓ Accept</button>
                        <button class="btn reject-file" onclick="rejectFile('${diff.filePath}')">✗ Reject</button>
                    </div>
                </div>
                <div class="diff-container">
                    <div class="diff-side original">
                        <div class="diff-side-header">Original</div>
                        <div class="diff-content">
                            ${this.renderDiffSide(lines, 'original')}
                        </div>
                    </div>
                    <div class="diff-side modified">
                        <div class="diff-side-header">Modified</div>
                        <div class="diff-content">
                            ${this.renderDiffSide(lines, 'modified')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private generateDiffLines(original: string, modified: string): any[] {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');
        const lines: any[] = [];

        // Simple diff algorithm - in production, use a proper diff library
        const maxLines = Math.max(originalLines.length, modifiedLines.length);
        
        for (let i = 0; i < maxLines; i++) {
            const origLine = originalLines[i] || '';
            const modLine = modifiedLines[i] || '';
            
            if (origLine === modLine) {
                lines.push({
                    type: 'unchanged',
                    original: origLine,
                    modified: modLine,
                    originalLineNum: i + 1,
                    modifiedLineNum: i + 1
                });
            } else if (origLine && !modLine) {
                lines.push({
                    type: 'removed',
                    original: origLine,
                    modified: '',
                    originalLineNum: i + 1,
                    modifiedLineNum: null
                });
            } else if (!origLine && modLine) {
                lines.push({
                    type: 'added',
                    original: '',
                    modified: modLine,
                    originalLineNum: null,
                    modifiedLineNum: i + 1
                });
            } else {
                lines.push({
                    type: 'modified',
                    original: origLine,
                    modified: modLine,
                    originalLineNum: i + 1,
                    modifiedLineNum: i + 1
                });
            }
        }

        return lines;
    }

    private renderDiffSide(lines: any[], side: 'original' | 'modified'): string {
        return lines.map(line => {
            const content = side === 'original' ? line.original : line.modified;
            const lineNum = side === 'original' ? line.originalLineNum : line.modifiedLineNum;
            const cssClass = line.type === 'added' ? 'line-added' : 
                           line.type === 'removed' ? 'line-removed' : 'line-unchanged';
            
            return `
                <div class="line ${cssClass}">
                    <div class="line-number">${lineNum || ''}</div>
                    <div class="line-content">${this.escapeHtml(content)}</div>
                </div>
            `;
        }).join('');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private setupMessageHandling() {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'acceptFile':
                    this.onAcceptCallback?.(message.filePath);
                    break;
                case 'rejectFile':
                    this.onRejectCallback?.(message.filePath);
                    break;
                case 'acceptAll':
                    this.diffs.forEach(diff => this.onAcceptCallback?.(diff.filePath));
                    break;
                case 'rejectAll':
                    this.diffs.forEach(diff => this.onRejectCallback?.(diff.filePath));
                    break;
            }
        });
    }

    dispose() {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}