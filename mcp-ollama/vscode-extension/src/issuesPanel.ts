import * as vscode from 'vscode';

export interface CodeIssue {
    id: string;
    filePath: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    category: 'security' | 'performance' | 'quality' | 'style';
    title: string;
    description: string;
    suggestion?: string;
    fixable: boolean;
}

export class IssuesPanel implements vscode.TreeDataProvider<CodeIssue> {
    private _onDidChangeTreeData: vscode.EventEmitter<CodeIssue | undefined | null | void> = new vscode.EventEmitter<CodeIssue | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CodeIssue | undefined | null | void> = this._onDidChangeTreeData.event;

    private issues: CodeIssue[] = [];
    private panel: vscode.WebviewPanel | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CodeIssue): vscode.TreeItem {
        const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
        
        item.iconPath = this.getSeverityIcon(element.severity);
        item.description = `${element.filePath}:${element.line}`;
        item.tooltip = element.description;
        item.command = {
            command: 'vscode.open',
            title: 'Open',
            arguments: [
                vscode.Uri.file(element.filePath),
                { selection: new vscode.Range(element.line - 1, element.column, element.line - 1, element.column) }
            ]
        };
        
        return item;
    }

    getChildren(element?: CodeIssue): Thenable<CodeIssue[]> {
        return Promise.resolve(this.issues);
    }

    private getSeverityIcon(severity: string): vscode.ThemeIcon {
        switch (severity) {
            case 'error': return new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
            case 'warning': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
            case 'info': return new vscode.ThemeIcon('info', new vscode.ThemeColor('list.highlightForeground'));
            default: return new vscode.ThemeIcon('lightbulb', new vscode.ThemeColor('editorLightBulb.foreground'));
        }
    }

    showIssues(issues: CodeIssue[]) {
        this.issues = issues;
        this.refresh();
        this.showIssuesPanel();
    }

    private showIssuesPanel() {
        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = vscode.window.createWebviewPanel(
            'codeIssues',
            'Code Issues',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getIssuesHTML();
        this.setupMessageHandling();
    }

    private getIssuesHTML(): string {
        const groupedIssues = this.groupIssuesByCategory();
        
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Code Issues</title>
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
        .summary {
            display: flex;
            gap: 16px;
            font-size: 12px;
        }
        .count {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .error-count { color: var(--vscode-list-errorForeground); }
        .warning-count { color: var(--vscode-list-warningForeground); }
        .info-count { color: var(--vscode-list-highlightForeground); }
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
        .fix-all {
            background: #4CAF50;
            color: white;
        }
        .refresh {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .category {
            margin-bottom: 24px;
        }
        .category-header {
            padding: 12px 20px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .category-title {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .category-count {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
        }
        .issue {
            padding: 12px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .issue:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .issue-header {
            display: flex;
            justify-content: between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 8px;
        }
        .issue-icon {
            width: 16px;
            height: 16px;
            margin-top: 2px;
        }
        .issue-content {
            flex: 1;
        }
        .issue-title {
            font-weight: 500;
            margin-bottom: 4px;
        }
        .issue-location {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family);
        }
        .issue-description {
            margin-top: 8px;
            font-size: 13px;
            line-height: 1.4;
            color: var(--vscode-descriptionForeground);
        }
        .issue-suggestion {
            margin-top: 8px;
            padding: 8px 12px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
        }
        .issue-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .fix-btn {
            background: #4CAF50;
            color: white;
            padding: 4px 8px;
            border: none;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
        }
        .ignore-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 4px 8px;
            border: none;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
        }
        .no-issues {
            padding: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
        .severity-error { border-left: 4px solid var(--vscode-list-errorForeground); }
        .severity-warning { border-left: 4px solid var(--vscode-list-warningForeground); }
        .severity-info { border-left: 4px solid var(--vscode-list-highlightForeground); }
        .severity-hint { border-left: 4px solid var(--vscode-editorLightBulb-foreground); }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🔍 Code Issues</div>
        <div class="summary">
            <div class="count error-count">
                <span>❌</span>
                <span>${this.getIssueCount('error')}</span>
            </div>
            <div class="count warning-count">
                <span>⚠️</span>
                <span>${this.getIssueCount('warning')}</span>
            </div>
            <div class="count info-count">
                <span>ℹ️</span>
                <span>${this.getIssueCount('info')}</span>
            </div>
        </div>
        <div class="actions">
            <button class="btn fix-all" onclick="fixAll()">🔧 Fix All</button>
            <button class="btn refresh" onclick="refresh()">🔄 Refresh</button>
        </div>
    </div>
    
    <div id="issues">
        ${this.issues.length === 0 ? '<div class="no-issues">✅ No issues found!</div>' : 
          Object.entries(groupedIssues).map(([category, issues]) => 
            this.getCategoryHTML(category, issues as CodeIssue[])).join('')}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function openIssue(filePath, line, column) {
            vscode.postMessage({ 
                command: 'openIssue', 
                filePath, 
                line: parseInt(line), 
                column: parseInt(column) 
            });
        }
        
        function fixIssue(issueId) {
            vscode.postMessage({ command: 'fixIssue', issueId });
        }
        
        function ignoreIssue(issueId) {
            vscode.postMessage({ command: 'ignoreIssue', issueId });
        }
        
        function fixAll() {
            vscode.postMessage({ command: 'fixAll' });
        }
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
    }

    private groupIssuesByCategory(): Record<string, CodeIssue[]> {
        const grouped: Record<string, CodeIssue[]> = {};
        
        this.issues.forEach(issue => {
            if (!grouped[issue.category]) {
                grouped[issue.category] = [];
            }
            grouped[issue.category].push(issue);
        });
        
        return grouped;
    }

    private getCategoryHTML(category: string, issues: CodeIssue[]): string {
        const categoryIcons = {
            security: '🔒',
            performance: '⚡',
            quality: '✨',
            style: '🎨'
        };
        
        return `
            <div class="category">
                <div class="category-header">
                    <div class="category-title">
                        <span>${categoryIcons[category as keyof typeof categoryIcons] || '📋'}</span>
                        <span>${category.charAt(0).toUpperCase() + category.slice(1)}</span>
                    </div>
                    <div class="category-count">${issues.length}</div>
                </div>
                ${issues.map(issue => this.getIssueHTML(issue)).join('')}
            </div>
        `;
    }

    private getIssueHTML(issue: CodeIssue): string {
        const severityIcons = {
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️',
            hint: '💡'
        };
        
        return `
            <div class="issue severity-${issue.severity}" onclick="openIssue('${issue.filePath}', ${issue.line}, ${issue.column})">
                <div class="issue-header">
                    <div class="issue-icon">${severityIcons[issue.severity]}</div>
                    <div class="issue-content">
                        <div class="issue-title">${issue.title}</div>
                        <div class="issue-location">${issue.filePath}:${issue.line}:${issue.column}</div>
                        <div class="issue-description">${issue.description}</div>
                        ${issue.suggestion ? `<div class="issue-suggestion">💡 ${issue.suggestion}</div>` : ''}
                        ${issue.fixable ? `
                            <div class="issue-actions">
                                <button class="fix-btn" onclick="event.stopPropagation(); fixIssue('${issue.id}')">🔧 Fix</button>
                                <button class="ignore-btn" onclick="event.stopPropagation(); ignoreIssue('${issue.id}')">🙈 Ignore</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    private getIssueCount(severity: string): number {
        return this.issues.filter(issue => issue.severity === severity).length;
    }

    private setupMessageHandling() {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'openIssue':
                    const uri = vscode.Uri.file(message.filePath);
                    const document = await vscode.workspace.openTextDocument(uri);
                    const editor = await vscode.window.showTextDocument(document);
                    const position = new vscode.Position(message.line - 1, message.column);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                    break;
                case 'fixIssue':
                    await this.fixIssue(message.issueId);
                    break;
                case 'ignoreIssue':
                    this.ignoreIssue(message.issueId);
                    break;
                case 'fixAll':
                    await this.fixAllIssues();
                    break;
                case 'refresh':
                    await this.refreshIssues();
                    break;
            }
        });
    }

    private async fixIssue(issueId: string) {
        const issue = this.issues.find(i => i.id === issueId);
        if (!issue || !issue.fixable) return;

        // Implement fix logic here
        vscode.window.showInformationMessage(`Fixing issue: ${issue.title}`);
        
        // Remove from issues list after fixing
        this.issues = this.issues.filter(i => i.id !== issueId);
        this.refresh();
    }

    private ignoreIssue(issueId: string) {
        this.issues = this.issues.filter(i => i.id !== issueId);
        this.refresh();
    }

    private async fixAllIssues() {
        const fixableIssues = this.issues.filter(i => i.fixable);
        
        if (fixableIssues.length === 0) {
            vscode.window.showInformationMessage('No fixable issues found');
            return;
        }

        const result = await vscode.window.showWarningMessage(
            `Fix ${fixableIssues.length} issues automatically?`,
            'Yes', 'No'
        );

        if (result === 'Yes') {
            for (const issue of fixableIssues) {
                await this.fixIssue(issue.id);
            }
            vscode.window.showInformationMessage(`Fixed ${fixableIssues.length} issues`);
        }
    }

    private async refreshIssues() {
        // Implement refresh logic - scan for new issues
        vscode.window.showInformationMessage('Refreshing code issues...');
    }

    dispose() {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}