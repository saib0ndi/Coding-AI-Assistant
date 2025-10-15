import * as vscode from 'vscode';
import { ChatMessage } from './chatHistory';
import { SmartContextHandler } from './smartContextHandler';

export interface ContextualResponse {
    response: string;
    contextUsed: string[];
    relevanceScores: { [key: string]: number };
    totalTokens: number;
}

export class ConversationContext {
    private readonly maxContextTokens = 8000; // Adjust based on model limits
    private readonly contextWindow: ChatMessage[] = [];
    private readonly smartHandler = new SmartContextHandler();
    
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Add message to context window with automatic pruning
     */
    addToContext(message: ChatMessage): void {
        this.contextWindow.push(message);
        this.pruneContext();
    }

    /**
     * Build contextual prompt for AI model with smart topic detection
     */
    buildContextualPrompt(currentQuery: string, chatHistory: ChatMessage[]): string {
        // Analyze if context should be used based on topic similarity
        const strategy = this.smartHandler.analyzeContextRelevance(currentQuery, chatHistory);
        
        // Generate appropriate prompt based on strategy
        return this.smartHandler.generatePrompt(currentQuery, strategy);
    }

    /**
     * Extract relevant context using simple keyword matching and recency
     */
    private extractRelevantContext(query: string, history: ChatMessage[]): ChatMessage[] {
        const queryWords = this.extractKeywords(query.toLowerCase());
        const recentMessages = history.slice(-20); // Last 20 messages
        
        return recentMessages
            .map(msg => ({
                message: msg,
                relevance: this.calculateRelevance(msg.content.toLowerCase(), queryWords, msg.timestamp)
            }))
            .filter(item => item.relevance > 0.1)
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 10)
            .map(item => item.message);
    }

    /**
     * Calculate relevance score for a message
     */
    private calculateRelevance(content: string, queryWords: string[], timestamp: number): number {
        const contentWords = this.extractKeywords(content);
        
        // Keyword overlap score
        const overlap = queryWords.filter(word => contentWords.includes(word)).length;
        const keywordScore = overlap / Math.max(queryWords.length, 1);
        
        // Recency score (more recent = higher score)
        const now = Date.now();
        const age = now - timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const recencyScore = Math.max(0, 1 - (age / maxAge));
        
        // Combined score
        return (keywordScore * 0.7) + (recencyScore * 0.3);
    }

    /**
     * Extract meaningful keywords from text
     */
    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 
            'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
        ]);

        return text
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 20); // Limit keywords
    }

    /**
     * Build conversation summary from relevant messages
     */
    private buildConversationSummary(relevantMessages: ChatMessage[]): string {
        if (relevantMessages.length === 0) {
            return "No previous conversation context.";
        }

        const summary = relevantMessages
            .map((msg, index) => {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                const content = msg.content.length > 200 
                    ? msg.content.substring(0, 200) + '...'
                    : msg.content;
                return `${index + 1}. ${role}: ${content}`;
            })
            .join('\n\n');

        return `Previous conversation (${relevantMessages.length} relevant messages):\n\n${summary}`;
    }

    /**
     * Prune context to stay within token limits
     */
    private pruneContext(): void {
        while (this.estimateTokens() > this.maxContextTokens && this.contextWindow.length > 1) {
            this.contextWindow.shift(); // Remove oldest message
        }
    }

    /**
     * Estimate token count (rough approximation)
     */
    private estimateTokens(): number {
        const totalChars = this.contextWindow
            .map(msg => msg.content.length)
            .reduce((sum, len) => sum + len, 0);
        
        return Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
    }

    /**
     * Get conversation metadata with context analysis
     */
    getContextMetadata(): {
        messageCount: number;
        estimatedTokens: number;
        oldestMessage?: Date;
        newestMessage?: Date;
    } {
        const messages = this.contextWindow;
        return {
            messageCount: messages.length,
            estimatedTokens: this.estimateTokens(),
            oldestMessage: messages.length > 0 ? new Date(messages[0].timestamp) : undefined,
            newestMessage: messages.length > 0 ? new Date(messages[messages.length - 1].timestamp) : undefined
        };
    }

    /**
     * Analyze context relevance for debugging
     */
    analyzeContextRelevance(query: string, history: ChatMessage[]) {
        return this.smartHandler.analyzeContextRelevance(query, history);
    }

    /**
     * Clear context window
     */
    clearContext(): void {
        this.contextWindow.length = 0;
    }

    /**
     * Export context for debugging
     */
    exportContext(): string {
        return JSON.stringify({
            messages: this.contextWindow,
            metadata: this.getContextMetadata()
        }, null, 2);
    }
}