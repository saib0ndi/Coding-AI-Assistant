import * as vscode from 'vscode';
import { ChatHistory, ChatMessage } from './chatHistory';
import { ConversationContext } from './conversationContext';

export class ContextualChat {
    private chatHistory: ChatHistory;
    private conversationContext: ConversationContext;
    private mcpClient: any; // Replace with actual MCP client type

    constructor(
        private context: vscode.ExtensionContext,
        mcpClient: any
    ) {
        this.chatHistory = new ChatHistory(context);
        this.conversationContext = new ConversationContext(context);
        this.mcpClient = mcpClient;
    }

    /**
     * Send contextual message to AI with conversation history
     */
    async sendContextualMessage(userMessage: string): Promise<string> {
        try {
            // Add user message to history
            const userMsgId = this.chatHistory.addMessage('user', userMessage);
            
            // Check for GitHub requests - detect GitHub URLs in the message
            const githubMatch = userMessage.match(/github\.com\/([^\s\/]+\/[^\s\/]+)/i);
            const isReadmeRequest = /readme|read\s*me/i.test(userMessage);
            const isFileRequest = /file|content|get.*file/i.test(userMessage) && !isReadmeRequest;
            const isDirectoryRequest = /directory|folder|list.*files|files.*in|what.*files|show.*files/i.test(userMessage);
            
            if (githubMatch && this.mcpClient) {
                try {
                    await this.mcpClient.connect();
                    const repoUrl = `https://${githubMatch[0]}`;
                    
                    let response: string = '';
                    
                    if (isReadmeRequest) {
                        // Get repository info first to determine correct branch
                        console.log(`[ContextualChat] Getting repo info for: ${repoUrl}`);
                        const repoInfo = await this.mcpClient.getGitHubRepoInfo(repoUrl);
                        
                        if (repoInfo.success) {
                            const defaultBranch = repoInfo.repository?.defaultBranch || 'main';
                            console.log(`[ContextualChat] Using branch: ${defaultBranch}`);
                            
                            // Try multiple README variations and branches
                            const readmeVariations = ['README.md', 'readme.md', 'README', 'readme'];
                            const branchesToTry = [defaultBranch, 'main', 'master', 'develop'];
                            
                            let readmeFound = false;
                            for (const readmeName of readmeVariations) {
                                for (const branch of branchesToTry) {
                                    try {
                                        const readmeContent = await this.mcpClient.getGitHubFileContent(repoUrl, readmeName, branch);
                                        if (readmeContent.success) {
                                            response = `# ${readmeName} (${branch} branch)\n\n${readmeContent.file.content}`;
                                            readmeFound = true;
                                            break;
                                        }
                                    } catch {
                                        continue;
                                    }
                                }
                                if (readmeFound) break;
                            }
                            
                            if (!readmeFound) {
                                response = `❌ README file not found in repository ${repoUrl} across branches: ${branchesToTry.join(', ')}`;
                            }
                        } else {
                            response = `❌ Failed to access repository: ${repoInfo.error}`;
                        }
                    } else if (isDirectoryRequest) {
                        // Fetch directory listing
                        console.log(`[ContextualChat] Fetching directory listing for: ${repoUrl}`);
                        const dirContent = await this.mcpClient.getGitHubDirectoryContents(repoUrl, '');
                        if (dirContent.success) {
                            const files = dirContent.contents.map((item: any) => 
                                `${item.type === 'dir' ? '📁' : '📄'} ${item.name} (${item.type})`
                            ).join('\n');
                            response = `# Directory Contents for ${repoUrl}\n\n${files}`;
                        } else {
                            response = `❌ Failed to fetch directory contents: ${dirContent.error}`;
                        }
                    } else {
                        // Fetch repository info - REAL API CALL
                        console.log(`[ContextualChat] Fetching real-time repo info for: ${repoUrl}`);
                        const repoInfo = await this.mcpClient.getGitHubRepoInfo(repoUrl);
                        
                        if (repoInfo.success && repoInfo.repository) {
                            const repo = repoInfo.repository;
                            response = `# ${repo.name}\n\n**${repo.description || 'No description'}**\n\n` +
                                      `⭐ **${repo.stars}** stars | 🍴 **${repo.forks}** forks | 🐛 **${repo.openIssues}** open issues\n\n` +
                                      `**Language:** ${repo.language || 'Not specified'}\n` +
                                      `**License:** ${repo.license}\n` +
                                      `**Owner:** ${repo.owner.login} (${repo.owner.type})\n` +
                                      `**Created:** ${new Date(repo.createdAt).toLocaleDateString()}\n` +
                                      `**Last Updated:** ${new Date(repo.updatedAt).toLocaleDateString()}\n` +
                                      `**Size:** ${repo.size} KB\n\n` +
                                      `**Topics:** ${repo.topics && repo.topics.length > 0 ? repo.topics.join(', ') : 'None'}\n\n` +
                                      `**Default Branch:** ${repo.defaultBranch}\n` +
                                      `**Repository URL:** ${repoUrl}`;
                        } else {
                            response = `❌ Failed to fetch repository information: ${repoInfo.error || 'Unknown error'}\n\nRepository: ${repoUrl}`;
                        }
                    }
                    
                    this.chatHistory.addMessage('assistant', response);
                    return response;
                } catch (error) {
                    const errorResponse = `❌ Error fetching GitHub data from ${githubMatch[0]}: ${error}`;
                    this.chatHistory.addMessage('assistant', errorResponse);
                    return errorResponse;
                }
            }
            
            // Get conversation history
            const history = this.chatHistory.getMessages();
            
            // Build contextual prompt
            const contextualPrompt = this.conversationContext.buildContextualPrompt(
                userMessage, 
                history
            );

            // Ensure MCP client is connected
            if (this.mcpClient) {
                try {
                    await this.mcpClient.connect();
                    
                    // Send to MCP server with context
                    const response = await this.mcpClient.callTool('chat_assistant', {
                        query: contextualPrompt,
                        context: this.getConversationMetadata(),
                        language: 'general'
                    });

                    // Extract response text
                    const assistantResponse = this.extractResponseText(response);
                    
                    // Add assistant response to history
                    this.chatHistory.addMessage('assistant', assistantResponse);
                    
                    return assistantResponse;
                } catch (mcpError) {
                    // Fallback to contextual response without MCP
                    const fallbackResponse = this.generateContextualFallback(userMessage, history);
                    this.chatHistory.addMessage('assistant', fallbackResponse);
                    return fallbackResponse;
                }
            } else {
                // No MCP client available, use contextual fallback
                const fallbackResponse = this.generateContextualFallback(userMessage, history);
                this.chatHistory.addMessage('assistant', fallbackResponse);
                return fallbackResponse;
            }

        } catch (error) {
            const errorMsg = `Error in contextual chat: ${error}`;
            this.chatHistory.addMessage('assistant', errorMsg);
            return errorMsg;
        }
    }

    /**
     * Get conversation metadata for context
     */
    private getConversationMetadata(): any {
        const metadata = this.conversationContext.getContextMetadata();
        return {
            messageCount: metadata.messageCount,
            estimatedTokens: metadata.estimatedTokens,
            conversationAge: metadata.oldestMessage ? 
                Date.now() - metadata.oldestMessage.getTime() : 0,
            lastMessageTime: metadata.newestMessage?.getTime() || 0
        };
    }

    /**
     * Extract response text from MCP response
     */
    private extractResponseText(response: any): string {
        if (typeof response === 'string') {
            return response;
        }
        
        if (response?.response) {
            return response.response;
        }
        
        if (response?.content?.[0]?.text) {
            return response.content[0].text;
        }
        
        return JSON.stringify(response);
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.chatHistory.clearHistory();
        this.conversationContext.clearContext();
    }

    /**
     * Get conversation summary
     */
    getConversationSummary(): string {
        const messages = this.chatHistory.getRecentMessages(10);
        const metadata = this.conversationContext.getContextMetadata();
        
        return `
## Conversation Summary
- Total Messages: ${metadata.messageCount}
- Estimated Tokens: ${metadata.estimatedTokens}
- Recent Messages: ${messages.length}

## Recent Context:
${messages.map((msg, i) => `${i+1}. ${msg.role}: ${msg.content.substring(0, 100)}...`).join('\n')}
        `.trim();
    }

    /**
     * Generate contextual fallback response when MCP is unavailable
     */
    private generateContextualFallback(query: string, history: any[]): string {
        const lowerQuery = query.toLowerCase();
        
        // Check for context requests
        if (lowerQuery.includes('context') || lowerQuery.includes('summary') || lowerQuery.includes('total context')) {
            return this.getConversationSummary();
        }
        
        // Use smart context analysis
        const strategy = this.conversationContext.analyzeContextRelevance(query, history);
        
        if (strategy.useContext) {
            const recentTopics = this.extractRecentTopics(strategy.contextMessages);
            return this.buildContextualResponse(query, recentTopics);
        } else {
            return `I understand you're asking about "${query}". \n\n🧠 **New Topic Detected**: This appears to be a different topic from our recent discussion.\n\n💡 I'll provide a focused answer without mixing in unrelated context from previous conversations.`;
        }
    }
    
    private extractRecentTopics(history: any[]): string[] {
        const topics = new Set<string>();
        const recentMessages = history.slice(-10);
        
        recentMessages.forEach(msg => {
            const content = msg.content.toLowerCase();
            if (content.includes('react')) topics.add('React');
            if (content.includes('typescript')) topics.add('TypeScript');
            if (content.includes('python')) topics.add('Python');
            if (content.includes('express')) topics.add('Express.js');
            if (content.includes('auth')) topics.add('Authentication');
            if (content.includes('jwt')) topics.add('JWT');
            if (content.includes('api')) topics.add('API');
            if (content.includes('database')) topics.add('Database');
        });
        
        return Array.from(topics);
    }
    
    private buildContextualResponse(query: string, topics: string[]): string {
        const lowerQuery = query.toLowerCase();
        
        if (topics.length > 0) {
            const topicsStr = topics.join(', ');
            
            if (lowerQuery.includes('how') || lowerQuery.includes('what')) {
                return `Based on our discussion about ${topicsStr}, I can help you with "${query}". \n\nWhile the MCP server isn't available right now, I remember we've been working with ${topicsStr}. \n\n💡 **Contextual suggestions:**\n${this.generateTopicSuggestions(topics, query)}`;
            }
        }
        
        return `I understand you're asking about "${query}". \n\n🧠 **Context available:** ${topics.length > 0 ? `We've been discussing ${topics.join(', ')}` : 'This is the start of our conversation'}\n\n💡 To get the full AI-powered response, please ensure the MCP server is running with \`npm start\`.`;
    }
    
    private generateTopicSuggestions(topics: string[], query: string): string {
        const suggestions = [];
        
        if (topics.includes('React') && topics.includes('TypeScript')) {
            suggestions.push('• Create typed React components with proper interfaces');
            suggestions.push('• Set up React with TypeScript configuration');
        }
        
        if (topics.includes('Express.js') && topics.includes('Authentication')) {
            suggestions.push('• Implement JWT authentication middleware');
            suggestions.push('• Debug authentication issues and 401 errors');
        }
        
        if (topics.includes('Python')) {
            suggestions.push('• Work with pandas DataFrames and data analysis');
            suggestions.push('• Handle Python data processing tasks');
        }
        
        return suggestions.length > 0 ? suggestions.join('\n') : '• Continue our previous discussion topics';
    }

    /**
     * Export conversation for analysis
     */
    exportConversation(): string {
        return JSON.stringify({
            history: this.chatHistory.exportHistory(),
            context: this.conversationContext.exportContext(),
            metadata: this.getConversationMetadata(),
            timestamp: new Date().toISOString()
        }, null, 2);
    }
}