import * as vscode from 'vscode';

export interface CommandServices {
    mcpClient: any;
    suggestionProvider: any;
    inlineCompletionProvider: any;
    chatProvider: any;
    streamingClient: any;
    workspaceAnalyzer: any;
    chatUI: any;
    telemetryManager: any;
    multiLineGenerator: any;
    astParser: any;
    serverManager: any;
    outputChannel: vscode.OutputChannel;
}
