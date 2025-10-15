import { ConversationContext } from '../vscode-extension/src/conversationContext';
import { ChatMessage } from '../vscode-extension/src/chatHistory';

export class InteractiveDemo {
    private context: any;
    private conversationContext: ConversationContext;
    private chatHistory: ChatMessage[] = [];

    constructor() {
        this.context = { globalState: new Map(), workspaceState: new Map() };
        this.conversationContext = new ConversationContext(this.context);
    }

    addMessage(role: 'user' | 'assistant', content: string): void {
        const message: ChatMessage = {
            id: `msg-${Date.now()}`,
            role,
            content,
            timestamp: Date.now()
        };
        this.chatHistory.push(message);
        this.conversationContext.addToContext(message);
    }

    processQuery(query: string): string {
        console.log(`\n👤 User: ${query}`);
        
        // Add user message
        this.addMessage('user', query);
        
        // Build contextual prompt
        const prompt = this.conversationContext.buildContextualPrompt(query, this.chatHistory);
        
        // Show context analysis
        console.log('\n🧠 Context Analysis:');
        const metadata = this.conversationContext.getContextMetadata();
        console.log(`- Messages in context: ${metadata.messageCount}`);
        console.log(`- Estimated tokens: ${metadata.estimatedTokens}`);
        
        // Show relevant context (first 300 chars)
        console.log('\n📝 Contextual Prompt (preview):');
        console.log(prompt.substring(0, 300) + '...\n');
        
        // Simulate AI response based on context
        const response = this.simulateAIResponse(query, prompt);
        console.log(`🤖 Assistant: ${response}`);
        
        // Add assistant response
        this.addMessage('assistant', response);
        
        return response;
    }

    private simulateAIResponse(query: string, contextualPrompt: string): string {
        // Simple simulation based on context keywords
        const lowerQuery = query.toLowerCase();
        const lowerPrompt = contextualPrompt.toLowerCase();
        
        if (lowerPrompt.includes('react') && lowerPrompt.includes('typescript')) {
            return 'Based on our React and TypeScript discussion, here\'s a typed component example...';
        }
        
        if (lowerPrompt.includes('express') && lowerPrompt.includes('auth')) {
            return 'Continuing with your Express.js authentication issue, let\'s check the middleware...';
        }
        
        if (lowerPrompt.includes('python') && lowerPrompt.includes('data')) {
            return 'For your Python data science work, I recommend using pandas and numpy...';
        }
        
        return `I understand you're asking about "${query}". Let me help with that...`;
    }

    runDemo(): void {
        console.log('🎬 Interactive Conversational Context Demo\n');
        console.log('This demo shows how context builds up over multiple interactions:\n');
        
        // Scenario 1: React development
        console.log('=== Scenario 1: React Development ===');
        this.processQuery('How do I create a React component?');
        this.processQuery('What about adding TypeScript?');
        this.processQuery('Can you show me a typed component example?');
        
        // Scenario 2: API debugging
        console.log('\n=== Scenario 2: API Debugging ===');
        this.processQuery('I have an Express.js API with authentication issues');
        this.processQuery('The JWT middleware returns 401 errors');
        this.processQuery('How do I debug this auth problem?');
        
        // Show final context state
        console.log('\n📊 Final Context State:');
        const metadata = this.conversationContext.getContextMetadata();
        console.log(`- Total messages: ${metadata.messageCount}`);
        console.log(`- Estimated tokens: ${metadata.estimatedTokens}`);
        console.log(`- Conversation span: ${metadata.oldestMessage} to ${metadata.newestMessage}`);
        
        console.log('\n✨ Demo completed! Context successfully maintained conversation continuity.');
    }
}

// Run demo if called directly
if (require.main === module) {
    const demo = new InteractiveDemo();
    demo.runDemo();
}