// Simple JavaScript demo of conversational context
class ConversationContextDemo {
    constructor() {
        this.chatHistory = [];
        this.maxContextTokens = 8000;
    }

    addMessage(role, content) {
        const message = {
            id: `msg-${Date.now()}`,
            role,
            content,
            timestamp: Date.now()
        };
        this.chatHistory.push(message);
        return message;
    }

    extractKeywords(text) {
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 20);
    }

    calculateRelevance(content, queryWords, timestamp) {
        const contentWords = this.extractKeywords(content);
        const overlap = queryWords.filter(word => contentWords.includes(word)).length;
        const keywordScore = overlap / Math.max(queryWords.length, 1);
        
        const now = Date.now();
        const age = now - timestamp;
        const maxAge = 24 * 60 * 60 * 1000;
        const recencyScore = Math.max(0, 1 - (age / maxAge));
        
        return (keywordScore * 0.7) + (recencyScore * 0.3);
    }

    buildContextualPrompt(query, history) {
        const queryWords = this.extractKeywords(query);
        const recentMessages = history.slice(-20);
        
        const relevantContext = recentMessages
            .map(msg => ({
                message: msg,
                relevance: this.calculateRelevance(msg.content, queryWords, msg.timestamp)
            }))
            .filter(item => item.relevance > 0.1)
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 10)
            .map(item => item.message);

        const summary = relevantContext.length === 0 
            ? "No previous conversation context."
            : relevantContext
                .map((msg, index) => {
                    const role = msg.role === 'user' ? 'User' : 'Assistant';
                    const content = msg.content.length > 200 
                        ? msg.content.substring(0, 200) + '...'
                        : msg.content;
                    return `${index + 1}. ${role}: ${content}`;
                })
                .join('\n\n');

        return `
## Conversation Context
Previous conversation (${relevantContext.length} relevant messages):

${summary}

## Current Query
${query}

## Instructions
Based on the conversation context above, provide a response that:
1. References relevant previous discussion points
2. Maintains conversational continuity
3. Addresses the current query accurately
4. Uses technical depth appropriate to the conversation level

Response:`;
    }

    processQuery(query) {
        console.log(`\n👤 User: ${query}`);
        
        this.addMessage('user', query);
        const prompt = this.buildContextualPrompt(query, this.chatHistory);
        
        console.log('\n🧠 Context Analysis:');
        console.log(`- Messages in history: ${this.chatHistory.length}`);
        console.log(`- Query keywords: ${this.extractKeywords(query).join(', ')}`);
        
        console.log('\n📝 Contextual Prompt (preview):');
        console.log(prompt.substring(0, 400) + '...\n');
        
        const response = this.simulateResponse(query, prompt);
        console.log(`🤖 Assistant: ${response}`);
        
        this.addMessage('assistant', response);
        return response;
    }

    simulateResponse(query, contextualPrompt) {
        const lowerQuery = query.toLowerCase();
        const lowerPrompt = contextualPrompt.toLowerCase();
        
        if (lowerPrompt.includes('react') && lowerPrompt.includes('typescript')) {
            return 'Based on our React and TypeScript discussion, here\'s a typed component example with proper interfaces...';
        }
        
        if (lowerPrompt.includes('express') && lowerPrompt.includes('auth')) {
            return 'Continuing with your Express.js authentication issue, the 401 error suggests the JWT token validation is failing...';
        }
        
        if (lowerPrompt.includes('python') && lowerPrompt.includes('data')) {
            return 'For your Python data science work, building on our previous discussion, here\'s how to optimize pandas operations...';
        }
        
        return `I understand you're asking about "${query}". Let me help with that based on our conversation...`;
    }

    runDemo() {
        console.log('🎬 Conversational Context Feature Demo\n');
        console.log('This demonstrates how context builds up over multiple interactions:\n');
        
        // Scenario 1: React development progression
        console.log('=== Scenario 1: React Development Progression ===');
        this.processQuery('How do I create a React component?');
        this.processQuery('What about adding TypeScript to React?');
        this.processQuery('Can you show me a typed React component example?');
        
        // Scenario 2: API debugging session
        console.log('\n=== Scenario 2: API Debugging Session ===');
        this.processQuery('I have an Express.js API with authentication issues');
        this.processQuery('The JWT middleware returns 401 errors');
        this.processQuery('How do I debug this specific auth problem?');
        
        // Scenario 3: Cross-topic query (should use relevant context)
        console.log('\n=== Scenario 3: Context Relevance Test ===');
        this.processQuery('What about Python data analysis?');
        this.processQuery('How does this compare to JavaScript for data processing?');
        
        console.log('\n📊 Final Statistics:');
        console.log(`- Total messages: ${this.chatHistory.length}`);
        console.log(`- User messages: ${this.chatHistory.filter(m => m.role === 'user').length}`);
        console.log(`- Assistant messages: ${this.chatHistory.filter(m => m.role === 'assistant').length}`);
        
        console.log('\n✨ Demo completed! Key features demonstrated:');
        console.log('✓ Keyword relevance scoring');
        console.log('✓ Recency vs relevance balance');
        console.log('✓ Conversation continuity');
        console.log('✓ Context-aware responses');
        console.log('✓ Technical depth adaptation');
    }
}

// Run the demo
const demo = new ConversationContextDemo();
demo.runDemo();