import { ConversationContext } from '../vscode-extension/src/conversationContext';
import { ChatMessage } from '../vscode-extension/src/chatHistory';

export class ContextualChatTest {
    private context: any;
    private conversationContext: ConversationContext;

    constructor() {
        this.context = { globalState: new Map(), workspaceState: new Map() };
        this.conversationContext = new ConversationContext(this.context);
    }

    testKeywordRelevance(): void {
        console.log('\n=== Test 1: Keyword Relevance ===');
        
        const history: ChatMessage[] = [
            { id: '1', role: 'user', content: 'How do I create a React component?', timestamp: Date.now() - 3600000 },
            { id: '2', role: 'assistant', content: 'To create a React component, use function syntax...', timestamp: Date.now() - 3500000 },
            { id: '3', role: 'user', content: 'What about TypeScript interfaces?', timestamp: Date.now() - 1800000 },
            { id: '4', role: 'assistant', content: 'TypeScript interfaces define object shapes...', timestamp: Date.now() - 1700000 }
        ];

        const query = 'Can you show me React TypeScript component example?';
        const prompt = this.conversationContext.buildContextualPrompt(query, history);
        
        console.log('Query:', query);
        console.log('Generated Prompt:', prompt.substring(0, 500) + '...');
        console.log('✓ Should include React and TypeScript context');
    }

    testRecencyBalance(): void {
        console.log('\n=== Test 2: Recency vs Relevance ===');
        
        const history: ChatMessage[] = [
            { id: '1', role: 'user', content: 'Python machine learning with scikit-learn', timestamp: Date.now() - 86400000 },
            { id: '2', role: 'user', content: 'JavaScript array methods', timestamp: Date.now() - 3600000 },
            { id: '3', role: 'user', content: 'Python data analysis pandas', timestamp: Date.now() - 1800000 },
            { id: '4', role: 'user', content: 'CSS flexbox layout', timestamp: Date.now() - 300000 }
        ];

        const query = 'How to use Python for data science?';
        const prompt = this.conversationContext.buildContextualPrompt(query, history);
        
        console.log('Query:', query);
        console.log('Generated Prompt:', prompt.substring(0, 500) + '...');
        console.log('✓ Should prioritize Python content despite recency');
    }

    testConversationContinuity(): void {
        console.log('\n=== Test 3: Conversation Continuity ===');
        
        const history: ChatMessage[] = [
            { id: '1', role: 'user', content: 'I need help with my Express.js API', timestamp: Date.now() - 1800000 },
            { id: '2', role: 'assistant', content: 'I can help with Express.js. What specific issue?', timestamp: Date.now() - 1700000 },
            { id: '3', role: 'user', content: 'The authentication middleware is not working', timestamp: Date.now() - 1600000 },
            { id: '4', role: 'assistant', content: 'Let me help debug the auth middleware', timestamp: Date.now() - 1500000 }
        ];

        const query = 'It still gives 401 errors';
        const prompt = this.conversationContext.buildContextualPrompt(query, history);
        
        console.log('Query:', query);
        console.log('Generated Prompt:', prompt.substring(0, 500) + '...');
        console.log('✓ Should maintain Express.js auth context');
    }

    runAllTests(): void {
        console.log('🚀 Starting Conversational Context Tests\n');
        this.testKeywordRelevance();
        this.testRecencyBalance();
        this.testConversationContinuity();
        console.log('\n✅ All tests completed!');
    }
}

// Usage examples
export const examples = {
    codingAssistance: `
User: "I'm building a REST API with Node.js"
Assistant: "Great! What framework would you like to use?"

User: "Let's use Express.js"  
Assistant: "Perfect! What endpoints do you need?"

User: "I need CRUD operations for users"
Assistant: [With context] "For your Express.js REST API, here's the user controller..."
    `,
    
    debugging: `
User: "My React component is not rendering"
Assistant: "Can you share the component code?"

User: "function MyComponent() { return <div>Hello</div> }"
Assistant: "The component looks correct. How are you using it?"

User: "I'm getting 'Cannot read property of undefined'"
Assistant: [With context] "Based on your React component, this error suggests..."
    `
};