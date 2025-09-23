import * as vscode from 'vscode';

export interface ExtensionConfig {
    enableTelemetry: boolean;
    maxRetries: number;
    retryDelay: number;
    chatHistoryLimit: number;
    rateLimitDelay: number;
    autoSave: boolean;
}

export class ConfigManager {
    private static readonly CONFIG_SECTION = 'mcp-ollama';

    static getConfig(): ExtensionConfig {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        
        return {
            enableTelemetry: config.get('enableTelemetry', false),
            maxRetries: config.get('maxRetries', 3),
            retryDelay: config.get('retryDelay', 1000),
            chatHistoryLimit: config.get('chatHistoryLimit', 100),
            rateLimitDelay: config.get('rateLimitDelay', 500),
            autoSave: config.get('autoSave', true)
        };
    }

    static async updateConfig(key: keyof ExtensionConfig, value: any): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        await config.update(key, value, vscode.ConfigurationTarget.Global);
    }

    static onConfigChange(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.CONFIG_SECTION)) {
                callback();
            }
        });
    }
}