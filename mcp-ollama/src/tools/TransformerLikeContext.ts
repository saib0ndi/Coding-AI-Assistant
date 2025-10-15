import { Logger } from '../utils/Logger.js';

/**
 * Transformer-inspired context selection using lightweight attention-like mechanisms
 * Mimics Claude's approach but optimized for local deployment
 */
export class TransformerLikeContext {
    private logger: Logger;
    private readonly embeddingDim = 384; // Smaller than Claude's ~12K
    private readonly maxContextTokens = 8000;

    constructor() {
        this.logger = new Logger();
    }

    /**
     * Compute attention-like scores for context selection
     * Simplified version of transformer attention
     */
    async computeContextAttention(
        query: string,
        conversationHistory: Array<{role: string; content: string; timestamp: number}>
    ): Promise<Array<{message: any; attentionScore: number}>> {

        // Step 1: Create query embedding (simplified)
        const queryEmbedding = this.createSimpleEmbedding(query);
        
        // Step 2: Create embeddings for all messages
        const messageEmbeddings = conversationHistory.map(msg => ({
            message: msg,
            embedding: this.createSimpleEmbedding(msg.content),
            timestamp: msg.timestamp
        }));

        // Step 3: Compute attention scores (Q·K^T / √d_k)
        const attentionScores = messageEmbeddings.map(msgEmb => {
            const dotProduct = this.dotProduct(queryEmbedding, msgEmb.embedding);
            const scaledScore = dotProduct / Math.sqrt(this.embeddingDim);
            
            // Add positional encoding (recency bias)
            const recencyBoost = this.computeRecencyBoost(msgEmb.timestamp);
            
            return {
                message: msgEmb.message,
                attentionScore: scaledScore + recencyBoost
            };
        });

        // Step 4: Apply softmax-like normalization
        return this.applySoftmaxNormalization(attentionScores);
    }

    /**
     * Create simple embedding using TF-IDF-like approach
     * Much lighter than Claude's learned embeddings
     */
    private createSimpleEmbedding(text: string): number[] {
        const words = this.tokenize(text);
        const embedding = new Array(this.embeddingDim).fill(0);
        
        // Simple hash-based embedding
        words.forEach((word, index) => {
            const hash1 = this.simpleHash(word) % this.embeddingDim;
            const hash2 = this.simpleHash(word + '_pos') % this.embeddingDim;
            
            // TF-IDF inspired weighting
            const tf = 1 / Math.sqrt(words.length); // Term frequency normalization
            const idf = Math.log(100 / (this.getWordFrequency(word) + 1)); // Inverse document frequency
            
            embedding[hash1] += tf * idf;
            embedding[hash2] += tf * idf * 0.5; // Positional component
        });

        // L2 normalization
        return this.normalizeVector(embedding);
    }

    /**
     * Compute dot product (Q·K in attention)
     */
    private dotProduct(vec1: number[], vec2: number[]): number {
        return vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    }

    /**
     * Add recency bias (like positional encoding)
     */
    private computeRecencyBoost(timestamp: number): number {
        const age = Date.now() - timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        return Math.max(0, 0.5 * (1 - age / maxAge)); // Max boost of 0.5
    }

    /**
     * Apply softmax-like normalization to attention scores
     */
    private applySoftmaxNormalization(
        scores: Array<{message: any; attentionScore: number}>
    ): Array<{message: any; attentionScore: number}> {
        
        // Find max for numerical stability
        const maxScore = Math.max(...scores.map(s => s.attentionScore));
        
        // Compute exponentials
        const expScores = scores.map(s => ({
            message: s.message,
            expScore: Math.exp(s.attentionScore - maxScore)
        }));
        
        // Compute sum for normalization
        const sumExp = expScores.reduce((sum, s) => sum + s.expScore, 0);
        
        // Normalize (softmax)
        return expScores.map(s => ({
            message: s.message,
            attentionScore: s.expScore / sumExp
        }));
    }

    /**
     * Select top-k messages based on attention scores
     */
    selectContextMessages(
        attentionResults: Array<{message: any; attentionScore: number}>,
        maxMessages: number = 10
    ): Array<{message: any; attentionScore: number}> {
        
        return attentionResults
            .filter(result => result.attentionScore > 0.01) // Threshold filtering
            .sort((a, b) => b.attentionScore - a.attentionScore)
            .slice(0, maxMessages);
    }

    /**
     * Multi-head attention simulation
     * Multiple "attention heads" focus on different aspects
     */
    async computeMultiHeadAttention(
        query: string,
        conversationHistory: Array<{role: string; content: string; timestamp: number}>,
        numHeads: number = 4
    ): Promise<Array<{message: any; attentionScore: number}>> {
        
        const headResults: Array<Array<{message: any; attentionScore: number}>> = [];
        
        // Simulate different attention heads
        for (let head = 0; head < numHeads; head++) {
            const headQuery = this.createHeadSpecificQuery(query, head);
            const headAttention = await this.computeContextAttention(headQuery, conversationHistory);
            headResults.push(headAttention);
        }
        
        // Combine results from all heads
        return this.combineMultiHeadResults(headResults);
    }

    /**
     * Create head-specific queries (different aspects of attention)
     */
    private createHeadSpecificQuery(query: string, headIndex: number): string {
        const aspects = [
            query, // Original query
            `technical aspects of: ${query}`, // Technical focus
            `context related to: ${query}`, // Context focus
            `recent discussion about: ${query}` // Recency focus
        ];
        
        return aspects[headIndex % aspects.length];
    }

    /**
     * Combine results from multiple attention heads
     */
    private combineMultiHeadResults(
        headResults: Array<Array<{message: any; attentionScore: number}>>
    ): Array<{message: any; attentionScore: number}> {
        
        const messageScores = new Map<string, number>();
        const messageObjects = new Map<string, any>();
        
        // Aggregate scores across heads
        headResults.forEach(headResult => {
            headResult.forEach(result => {
                const messageId = this.getMessageId(result.message);
                const currentScore = messageScores.get(messageId) || 0;
                messageScores.set(messageId, currentScore + result.attentionScore);
                messageObjects.set(messageId, result.message);
            });
        });
        
        // Convert back to array format
        const combinedResults: Array<{message: any; attentionScore: number}> = [];
        messageScores.forEach((score, messageId) => {
            combinedResults.push({
                message: messageObjects.get(messageId),
                attentionScore: score / headResults.length // Average across heads
            });
        });
        
        return combinedResults.sort((a, b) => b.attentionScore - a.attentionScore);
    }

    // Utility methods
    private tokenize(text: string): string[] {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2);
    }

    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    private getWordFrequency(word: string): number {
        // Simplified frequency estimation
        const commonWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
        return commonWords.has(word) ? 50 : 5;
    }

    private normalizeVector(vector: number[]): number[] {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? vector.map(val => val / magnitude) : vector;
    }

    private getMessageId(message: any): string {
        return `${message.timestamp}_${message.content.substring(0, 50)}`;
    }
}