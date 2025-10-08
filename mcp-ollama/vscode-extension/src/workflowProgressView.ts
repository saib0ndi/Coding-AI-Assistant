import * as vscode from 'vscode';

export interface WorkflowStep {
    id: string;
    action: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress?: number;
    result?: any;
    error?: string;
}

export class WorkflowProgressView implements vscode.TreeDataProvider<WorkflowStep> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkflowStep | undefined | null | void> = new vscode.EventEmitter<WorkflowStep | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkflowStep | undefined | null | void> = this._onDidChangeTreeData.event;

    private steps: WorkflowStep[] = [];
    private panel: vscode.WebviewPanel | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkflowStep): vscode.TreeItem {
        const item = new vscode.TreeItem(element.action, vscode.TreeItemCollapsibleState.None);
        
        item.iconPath = this.getStatusIcon(element.status);
        item.description = this.getStatusDescription(element);
        item.tooltip = element.error || element.action;
        
        return item;
    }

    getChildren(element?: WorkflowStep): Thenable<WorkflowStep[]> {
        return Promise.resolve(this.steps);
    }

    private getStatusIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'completed': return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case 'running': return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
            case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconUnset'));
        }
    }

    private getStatusDescription(step: WorkflowStep): string {
        switch (step.status) {
            case 'completed': return '✓ Done';
            case 'running': return step.progress ? `${step.progress}%` : '⏳ Running';
            case 'failed': return '❌ Failed';
            default: return '⏸️ Pending';
        }
    }

    showProgressPanel(taskId: string, steps: WorkflowStep[]) {
        this.steps = steps;
        this.refresh();

        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = vscode.window.createWebviewPanel(
            'workflowProgress',
            'Agent Workflow Progress',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        this.panel.webview.html = this.getProgressHTML(taskId, steps);
        this.setupProgressHandling();
    }

    updateStep(stepId: string, updates: Partial<WorkflowStep>) {
        const step = this.steps.find(s => s.id === stepId);
        if (step) {
            Object.assign(step, updates);
            this.refresh();
            this.updateProgressPanel();
        }
    }

    private updateProgressPanel() {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'updateSteps',
                steps: this.steps
            });
        }
    }

    private getProgressHTML(taskId: string, steps: WorkflowStep[]): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Workflow Progress</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .task-id {
            font-size: 18px;
            font-weight: 600;
        }
        .overall-progress {
            flex: 1;
            height: 8px;
            background: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--vscode-progressBar-foreground);
            transition: width 0.3s ease;
        }
        .step {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-left: 4px solid transparent;
        }
        .step.completed { border-left-color: #4CAF50; }
        .step.running { border-left-color: #2196F3; }
        .step.failed { border-left-color: #f44336; }
        .step-icon {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            font-size: 12px;
        }
        .step.completed .step-icon { background: #4CAF50; color: white; }
        .step.running .step-icon { background: #2196F3; color: white; }
        .step.failed .step-icon { background: #f44336; color: white; }
        .step.pending .step-icon { background: var(--vscode-button-secondaryBackground); }
        .step-content {
            flex: 1;
        }
        .step-action {
            font-weight: 500;
            margin-bottom: 4px;
        }
        .step-status {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .step-error {
            color: var(--vscode-errorForeground);
            font-size: 12px;
            margin-top: 4px;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .spinning {
            animation: spin 1s linear infinite;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="task-id">🤖 Agent Task: ${taskId}</div>
        <div class="overall-progress">
            <div class="progress-fill" id="overallProgress"></div>
        </div>
    </div>
    
    <div id="steps">
        ${steps.map(step => this.getStepHTML(step)).join('')}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function updateProgress() {
            const steps = ${JSON.stringify(steps)};
            const completed = steps.filter(s => s.status === 'completed').length;
            const total = steps.length;
            const progress = total > 0 ? (completed / total) * 100 : 0;
            
            document.getElementById('overallProgress').style.width = progress + '%';
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateSteps') {
                const stepsContainer = document.getElementById('steps');
                stepsContainer.innerHTML = message.steps.map(step => getStepHTML(step)).join('');
                updateProgress();
            }
        });
        
        function getStepHTML(step) {
            const icon = step.status === 'completed' ? '✓' : 
                        step.status === 'running' ? '⏳' : 
                        step.status === 'failed' ? '❌' : '⏸️';
            
            return \`
                <div class="step \${step.status}">
                    <div class="step-icon \${step.status === 'running' ? 'spinning' : ''}">\${icon}</div>
                    <div class="step-content">
                        <div class="step-action">\${step.action}</div>
                        <div class="step-status">\${getStatusText(step)}</div>
                        \${step.error ? \`<div class="step-error">\${step.error}</div>\` : ''}
                    </div>
                </div>
            \`;
        }
        
        function getStatusText(step) {
            switch (step.status) {
                case 'completed': return 'Completed successfully';
                case 'running': return step.progress ? \`Running (\${step.progress}%)\` : 'Running...';
                case 'failed': return 'Failed';
                default: return 'Waiting to start';
            }
        }
        
        updateProgress();
    </script>
</body>
</html>`;
    }

    private getStepHTML(step: WorkflowStep): string {
        const icon = step.status === 'completed' ? '✓' : 
                    step.status === 'running' ? '⏳' : 
                    step.status === 'failed' ? '❌' : '⏸️';
        
        return `
            <div class="step ${step.status}">
                <div class="step-icon ${step.status === 'running' ? 'spinning' : ''}">${icon}</div>
                <div class="step-content">
                    <div class="step-action">${step.action}</div>
                    <div class="step-status">${this.getStatusText(step)}</div>
                    ${step.error ? `<div class="step-error">${step.error}</div>` : ''}
                </div>
            </div>
        `;
    }

    private getStatusText(step: WorkflowStep): string {
        switch (step.status) {
            case 'completed': return 'Completed successfully';
            case 'running': return step.progress ? `Running (${step.progress}%)` : 'Running...';
            case 'failed': return 'Failed';
            default: return 'Waiting to start';
        }
    }

    private setupProgressHandling() {
        if (!this.panel) return;
        
        this.panel.webview.onDidReceiveMessage(message => {
            // Handle any messages from the webview if needed
        });
    }

    dispose() {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}