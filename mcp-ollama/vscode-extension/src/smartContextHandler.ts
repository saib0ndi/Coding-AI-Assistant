import { ChatMessage } from './chatHistory';

export interface ContextStrategy {
    useContext: boolean;
    hasReferences: boolean;
    topicSimilarity: number;
    contextMessages: ChatMessage[];
    reason: string;
}

export class SmartContextHandler {
    private readonly referenceWords = [
        'this', 'that', 'these', 'those', 'it', 'they', 'them',
        'previous', 'last', 'earlier', 'before', 'above',
        'previous question', 'last question', 'that question',
        'which', 'what', 'how', 'why', 'where', 'when',
        'more', 'explain', 'elaborate', 'details', 'further',
        'algorithm', 'method', 'approach', 'technique', 'solution'
    ];

    analyzeContextRelevance(query: string, history: ChatMessage[]): ContextStrategy {
        const hasReferences = this.hasReferenceWords(query);
        const recentMessages = history.slice(-10);
        const topicSimilarity = this.calculateTopicSimilarity(query, recentMessages);
        
        // Force context if reference words found
        const useContext = hasReferences || topicSimilarity > 0.3;
        
        return {
            useContext,
            hasReferences,
            topicSimilarity,
            contextMessages: useContext ? recentMessages : [],
            reason: this.getContextReason(hasReferences, topicSimilarity)
        };
    }

    generatePrompt(query: string, strategy: ContextStrategy): string {
        if (!strategy.useContext) {
            return query;
        }

        const contextSummary = this.buildContextSummary(strategy.contextMessages);
        
        return `## Previous Conversation
${contextSummary}

## Current Question
${query}

## Instructions
${strategy.hasReferences ? 
    'This question contains references to previous discussion. Use the conversation context to understand what "this", "that", "previous question", etc. refer to.' : 
    'Use the conversation context to provide a relevant response.'
}

Response:`;
    }

    private hasReferenceWords(query: string): boolean {
        const lowerQuery = query.toLowerCase();
        return this.referenceWords.some(word => lowerQuery.includes(word));
    }

    private calculateTopicSimilarity(query: string, messages: ChatMessage[]): number {
        if (messages.length === 0) return 0;
        
        const queryWords = this.extractKeywords(query);
        const recentContent = messages.slice(-3).map(m => m.content).join(' ');
        const contextWords = this.extractKeywords(recentContent);
        
        const overlap = queryWords.filter(word => contextWords.includes(word)).length;
        return overlap / Math.max(queryWords.length, 1);
    }

    private extractKeywords(text: string): string[] {
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));
    }

    private buildContextSummary(messages: ChatMessage[]): string {
        if (messages.length === 0) return 'No previous context.';
        
        return messages
            .slice(-5)
            .map((msg, i) => `${i + 1}. ${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? '...' : ''}`)
            .join('\n');
    }

    private getContextReason(hasReferences: boolean, similarity: number): string {
        if (hasReferences) return 'Reference words detected';
        if (similarity > 0.3) return `Topic similarity: ${Math.round(similarity * 100)}%`;
        return 'No context needed';
    }
}