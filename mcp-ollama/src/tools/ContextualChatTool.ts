import { Logger } from '../utils/Logger.js';

export interface ContextualRequest {
    query: string;
    conversationHistory?: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
    }>;
    contextMetadata?: {
        messageCount: number;
        estimatedTokens: number;
        conversationAge: number;
        lastMessageTime: number;
    };
    language?: string;
}

export class ContextualChatTool {
    private logger: Logger;
    private readonly maxContextLength = 8000;

    constructor() {
        this.logger = new Logger();
    }

    /**
     * Process contextual chat request with conversation history
     */
    async processContextualChat(request: ContextualRequest): Promise<any> {
        try {
            this.logger.info('Processing contextual chat request');

            // Extract relevant context
            const relevantContext = this.extractRelevantContext(
                request.query,
                request.conversationHistory || []
            );

            // Build contextual prompt
            const contextualPrompt = this.buildContextualPrompt(
                request.query,
                relevantContext,
                request.contextMetadata
            );

            // Return structured response for MCP
            return {
                contextualPrompt,
                relevantMessages: relevantContext.length,
                contextSummary: this.buildContextSummary(relevantContext),
                metadata: {
                    originalQuery: request.query,
                    contextUsed: relevantContext.map(msg => ({
                        role: msg.role,
                        preview: msg.content.substring(0, 100) + '...',
                        timestamp: msg.timestamp
                    })),
                    processingTime: Date.now()
                }
            };

        } catch (error) {
            this.logger.error('Error in contextual chat processing:', error);
            throw error;
        }
    }

    /**
     * Extract relevant context from conversation history
     */
    private extractRelevantContext(
        query: string,
        history: Array<{ role: string; content: string; timestamp: number }>
    ): Array<{ role: string; content: string; timestamp: number }> {
        
        if (history.length === 0) {
            return [];
        }

        const queryKeywords = this.extractKeywords(query.toLowerCase());
        const recentMessages = history.slice(-20); // Last 20 messages

        // Score messages by relevance
        const scoredMessages = recentMessages.map(msg => ({
            message: msg,
            relevance: this.calculateRelevance(msg.content.toLowerCase(), queryKeywords, msg.timestamp)
        }));

        // Filter and sort by relevance
        return scoredMessages
            .filter(item => item.relevance > 0.1)
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 10)
            .map(item => item.message);
    }

    /**
     * Calculate relevance score for a message
     */
    private calculateRelevance(content: string, queryKeywords: string[], timestamp: number): number {
        const contentKeywords = this.extractKeywords(content);
        
        // Keyword overlap score
        const overlap = queryKeywords.filter(word => contentKeywords.includes(word)).length;
        const keywordScore = overlap / Math.max(queryKeywords.length, 1);
        
        // Recency score
        const now = Date.now();
        const age = now - timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const recencyScore = Math.max(0, 1 - (age / maxAge));
        
        // Position score (recent messages get slight boost)
        const positionScore = 0.1;
        
        return (keywordScore * 0.6) + (recencyScore * 0.3) + (positionScore * 0.1);
    }

    /**
     * Extract keywords from text
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
            .slice(0, 15);
    }

    /**
     * Build contextual prompt for AI model
     */
    private buildContextualPrompt(
        query: string,
        relevantContext: Array<{ role: string; content: string; timestamp: number }>,
        metadata?: any
    ): string {
        
        let prompt = `## Conversation Context\n`;
        
        if (relevantContext.length === 0) {
            prompt += `This is the start of our conversation.\n\n`;
        } else {
            prompt += `Previous relevant discussion (${relevantContext.length} messages):\n\n`;
            
            relevantContext.forEach((msg, index) => {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                const content = msg.content.length > 300 
                    ? msg.content.substring(0, 300) + '...'
                    : msg.content;
                prompt += `${index + 1}. ${role}: ${content}\n\n`;
            });
        }

        if (metadata) {
            prompt += `## Conversation Metadata\n`;
            prompt += `- Total messages in conversation: ${metadata.messageCount || 0}\n`;
            prompt += `- Conversation tokens: ~${metadata.estimatedTokens || 0}\n\n`;
        }

        prompt += `## Current Query\n${query}\n\n`;
        
        prompt += `## Instructions\n`;
        prompt += `Based on the conversation context above, provide a response that:\n`;
        prompt += `1. References relevant previous discussion points when appropriate\n`;
        prompt += `2. Maintains conversational continuity and flow\n`;
        prompt += `3. Addresses the current query accurately and completely\n`;
        prompt += `4. Uses appropriate technical depth based on the conversation level\n`;
        prompt += `5. Acknowledges context when building on previous topics\n\n`;
        
        prompt += `Response:`;

        return prompt;
    }

    /**
     * Build context summary
     */
    private buildContextSummary(relevantContext: Array<{ role: string; content: string; timestamp: number }>): string {
        if (relevantContext.length === 0) {
            return "No previous context available.";
        }

        const topics = this.extractTopics(relevantContext);
        const timespan = this.calculateTimespan(relevantContext);

        return `Context includes ${relevantContext.length} relevant messages spanning ${timespan}. Key topics: ${topics.join(', ')}.`;
    }

    /**
     * Extract main topics from context
     */
    private extractTopics(context: Array<{ role: string; content: string; timestamp: number }>): string[] {
        const allText = context.map(msg => msg.content).join(' ').toLowerCase();
        const keywords = this.extractKeywords(allText);
        
        // Group similar keywords and return top topics
        return keywords.slice(0, 5);
    }

    /**
     * Calculate timespan of context
     */
    private calculateTimespan(context: Array<{ role: string; content: string; timestamp: number }>): string {
        if (context.length === 0) return "0 minutes";
        
        const oldest = Math.min(...context.map(msg => msg.timestamp));
        const newest = Math.max(...context.map(msg => msg.timestamp));
        const diffMs = newest - oldest;
        
        const minutes = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''}`;
        } else {
            return `${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
    }
}