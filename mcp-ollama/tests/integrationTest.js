// Integration test showing full conversational context flow
class MCPContextIntegration {
    constructor() {
        this.chatHistory = [];
        this.conversationContext = new ConversationContextSimulator();
    }

    // Simulate the full MCP integration flow
    async simulateContextualChat(userMessage) {
        console.log(`\n👤 User: ${userMessage}`);
        
        // Step 1: Add user message to history
        this.addMessage('user', userMessage);
        
        // Step 2: Build contextual prompt
        const contextualPrompt = this.conversationContext.buildContextualPrompt(
            userMessage, 
            this.chatHistory
        );
        
        // Step 3: Show context analysis
        console.log('\n🧠 Context Processing:');
        const metadata = this.conversationContext.getContextMetadata(this.chatHistory);
        console.log(`- Messages analyzed: ${metadata.messageCount}`);
        console.log(`- Estimated tokens: ${metadata.estimatedTokens}`);
        
        // Step 4: Simulate MCP server call
        console.log('\n📡 MCP Server Call:');
        console.log('Tool: contextual_chat');
        console.log('Parameters: { query, context, language }');
        
        // Step 5: Simulate AI response with context awareness
        const response = this.generateContextualResponse(userMessage, contextualPrompt);
        console.log(`\n🤖 Assistant: ${response}`);
        
        // Step 6: Add response to history
        this.addMessage('assistant', response);
        
        return response;
    }

    addMessage(role, content) {
        const message = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            role,
            content,
            timestamp: Date.now()
        };
        this.chatHistory.push(message);
        return message;
    }

    generateContextualResponse(query, contextualPrompt) {
        const lowerQuery = query.toLowerCase();
        const lowerPrompt = contextualPrompt.toLowerCase();
        
        // Analyze context to generate appropriate response
        if (lowerPrompt.includes('react') && lowerPrompt.includes('component')) {
            if (lowerPrompt.includes('typescript')) {
                return 'Based on our React and TypeScript discussion, here\'s a properly typed component:\n\n```tsx\ninterface Props {\n  name: string;\n  count: number;\n}\n\nconst MyComponent: React.FC<Props> = ({ name, count }) => {\n  const [state, setState] = useState(count);\n  return <div>{name}: {state}</div>;\n};\n```';
            }
            return 'Continuing our React discussion, here\'s a functional component example:\n\n```jsx\nfunction MyComponent({ name, count }) {\n  const [state, setState] = useState(count);\n  return <div>{name}: {state}</div>;\n}\n```';
        }
        
        if (lowerPrompt.includes('express') && lowerPrompt.includes('auth')) {
            return 'For your Express.js authentication issue, let\'s debug the JWT middleware:\n\n```javascript\napp.use((req, res, next) => {\n  const token = req.headers.authorization?.split(\' \')[1];\n  if (!token) return res.status(401).json({ error: \'No token provided\' });\n  \n  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {\n    if (err) return res.status(401).json({ error: \'Invalid token\' });\n    req.user = decoded;\n    next();\n  });\n});\n```';
        }
        
        if (lowerPrompt.includes('python') && lowerPrompt.includes('pandas')) {
            return 'For your pandas DataFrame operations, here\'s how to handle multiple conditions:\n\n```python\n# Multiple conditions with boolean indexing\nfiltered_df = df[(df[\'age\'] > 25) & (df[\'city\'] == \'New York\')]\n\n# Using query method (alternative)\nfiltered_df = df.query(\"age > 25 and city == \'New York\'\")\n```';
        }
        
        // Default contextual response
        return `I understand you're asking about "${query}". Based on our conversation history, I can help you with that. What specific aspect would you like me to focus on?`;
    }

    async runIntegrationDemo() {
        console.log('🔗 MCP-Ollama Conversational Context Integration Demo\n');
        console.log('This simulates the complete flow from VS Code to MCP server with context.\n');
        
        // Scenario: Full development workflow with context
        console.log('=== Development Workflow with Context ===');
        
        await this.simulateContextualChat('I want to build a React application with TypeScript');
        
        await this.simulateContextualChat('How do I create a typed component?');
        
        await this.simulateContextualChat('What about adding props validation?');
        
        await this.simulateContextualChat('Now I need to add an Express.js backend');
        
        await this.simulateContextualChat('How do I implement JWT authentication?');
        
        await this.simulateContextualChat('The authentication is returning 401 errors');
        
        await this.simulateContextualChat('How do I connect my React frontend to this Express backend?');
        
        // Show final context state
        console.log('\n📊 Final Context Analysis:');
        const finalMetadata = this.conversationContext.getContextMetadata(this.chatHistory);
        console.log(`- Total conversation messages: ${finalMetadata.messageCount}`);
        console.log(`- Context tokens used: ${finalMetadata.estimatedTokens}`);
        console.log(`- Topics covered: React, TypeScript, Express.js, JWT, Frontend-Backend integration`);
        
        console.log('\n✅ Integration Demo Complete!');
        console.log('\nKey Features Demonstrated:');
        console.log('✓ Multi-turn conversation continuity');
        console.log('✓ Context-aware code generation');
        console.log('✓ Topic transition handling');
        console.log('✓ Technical depth progression');
        console.log('✓ Cross-technology integration advice');
    }
}

// Simplified conversation context simulator
class ConversationContextSimulator {
    buildContextualPrompt(query, history) {
        const queryWords = this.extractKeywords(query.toLowerCase());
        const recentMessages = history.slice(-20);
        
        const relevantContext = recentMessages
            .map(msg => ({
                message: msg,
                relevance: this.calculateRelevance(msg.content.toLowerCase(), queryWords, msg.timestamp)
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
                .join('\\n\\n');

        return `## Conversation Context\\n${summary}\\n\\n## Current Query\\n${query}`;
    }

    extractKeywords(text) {
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
        return text.replace(/[^\\w\\s]/g, ' ')
            .split(/\\s+/)
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

    getContextMetadata(history) {
        const totalChars = history.map(msg => msg.content.length).reduce((sum, len) => sum + len, 0);
        return {
            messageCount: history.length,
            estimatedTokens: Math.ceil(totalChars / 4)
        };
    }
}

// Run the integration demo
const integration = new MCPContextIntegration();
integration.runIntegrationDemo();