import * as vscode from 'vscode';

interface TelemetryEvent {
    event: 'accept' | 'reject' | 'partial' | 'timeout' | 'shown';
    suggestionId: string;
    timestamp: number;
    language: string;
    context: {
        lineLength: number;
        fileType: string;
        triggerKind: string;
    };
}

export class TelemetryManager {
    private events: TelemetryEvent[] = [];
    private suggestionCounter = 0;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('MCP-Ollama Telemetry');
    }

    generateSuggestionId(): string {
        return `suggestion_${++this.suggestionCounter}_${Date.now()}`;
    }

    recordEvent(
        event: TelemetryEvent['event'],
        suggestionId: string,
        language: string,
        context: TelemetryEvent['context']
    ) {
        const telemetryEvent: TelemetryEvent = {
            event,
            suggestionId,
            timestamp: Date.now(),
            language,
            context
        };

        this.events.push(telemetryEvent);
        this.outputChannel.appendLine(`[${event.toUpperCase()}] ${suggestionId} - ${language}`);

        // Keep only last 1000 events
        if (this.events.length > 1000) {
            this.events = this.events.slice(-1000);
        }
    }

    getStats() {
        const total = this.events.length;
        const accepted = this.events.filter(e => e.event === 'accept').length;
        const rejected = this.events.filter(e => e.event === 'reject').length;
        const shown = this.events.filter(e => e.event === 'shown').length;

        return {
            total,
            accepted,
            rejected,
            shown,
            acceptanceRate: shown > 0 ? (accepted / shown * 100).toFixed(1) : '0',
            languages: this.getLanguageStats(),
            recentEvents: this.events.slice(-10)
        };
    }

    private getLanguageStats() {
        const langCounts: Record<string, number> = {};
        this.events.forEach(event => {
            langCounts[event.language] = (langCounts[event.language] || 0) + 1;
        });
        return Object.entries(langCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
    }

    showStats() {
        const stats = this.getStats();
        const message = `
MCP-Ollama Statistics:
• Total Suggestions: ${stats.total}
• Accepted: ${stats.accepted}
• Acceptance Rate: ${stats.acceptanceRate}%
• Top Languages: ${stats.languages.map(([lang, count]) => `${lang}(${count})`).join(', ')}
        `.trim();

        vscode.window.showInformationMessage(message, 'View Details').then(selection => {
            if (selection === 'View Details') {
                this.outputChannel.show();
            }
        });
    }

    dispose() {
        this.outputChannel.dispose();
    }
}