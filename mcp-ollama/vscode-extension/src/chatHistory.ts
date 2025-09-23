import * as vscode from 'vscode';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class ChatHistory {
    private messages: ChatMessage[] = [];
    private context: vscode.ExtensionContext;
    private maxMessages: number;

    constructor(context: vscode.ExtensionContext, maxMessages = 100) {
        this.context = context;
        this.maxMessages = maxMessages;
        this.loadHistory();
    }

    addMessage(role: 'user' | 'assistant', content: string): string {
        const id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const message: ChatMessage = {
            id,
            role,
            content,
            timestamp: Date.now()
        };

        this.messages.push(message);
        
        // Keep only recent messages
        if (this.messages.length > this.maxMessages) {
            this.messages = this.messages.slice(-this.maxMessages);
        }

        this.saveHistory();
        return id;
    }

    getMessages(): ChatMessage[] {
        return [...this.messages];
    }

    getRecentMessages(count: number): ChatMessage[] {
        return this.messages.slice(-count);
    }

    clearHistory(): void {
        this.messages = [];
        this.saveHistory();
    }

    private loadHistory(): void {
        try {
            const saved = this.context.globalState.get<ChatMessage[]>('chatHistory', []);
            this.messages = saved.slice(-this.maxMessages);
        } catch (error) {
            console.error('Failed to load chat history:', error);
            this.messages = [];
        }
    }

    private saveHistory(): void {
        try {
            this.context.globalState.update('chatHistory', this.messages);
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }

    exportHistory(): string {
        return JSON.stringify(this.messages, null, 2);
    }

    importHistory(data: string): boolean {
        try {
            const imported = JSON.parse(data) as ChatMessage[];
            if (Array.isArray(imported)) {
                this.messages = imported.slice(-this.maxMessages);
                this.saveHistory();
                return true;
            }
        } catch (error) {
            console.error('Failed to import chat history:', error);
        }
        return false;
    }
}