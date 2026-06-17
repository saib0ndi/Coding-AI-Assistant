import * as vscode from 'vscode';
import { ChatHistory, ChatMessage } from './chatHistory';
import { ConversationContext } from './conversationContext';
import * as fs from 'fs/promises';
import * as path from 'path';

interface LocalFileContext {
    filePath: string;
    language: string;
    content: string;
}

export class ContextualChat {
    private chatHistory: ChatHistory;
    private conversationContext: ConversationContext;
    private mcpClient: any; // Replace with actual MCP client type
    private currentReadmeContext: string = '';

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
    async sendContextualMessage(userMessage: string, model?: string): Promise<string> {
        try {
            // Add user message to history
            const userMsgId = this.chatHistory.addMessage('user', userMessage);
            const userMessageRecord = this.chatHistory.getMessages().find(m => m.id === userMsgId);
            if (userMessageRecord) {
                this.conversationContext.addToContext(userMessageRecord);
            }
            
            // Check for GitHub requests - detect GitHub URLs or patterns in the message
            let repoPath = '';
            const githubUrlMatch = userMessage.match(/github\.com\/([^\s\/]+\/[^\s\/]+)/i);
            if (githubUrlMatch) {
                repoPath = githubUrlMatch[1];
            } else {
                const ownerRepoMatch = userMessage.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
                if (ownerRepoMatch && /github/i.test(userMessage)) {
                    repoPath = ownerRepoMatch[1];
                }
            }

            // Only fall back to last discussed repo if the current message is EXPLICITLY about GitHub/a repo.
            // This prevents "Explain this code" or "Fix this" from accidentally triggering repo fetches.
            const isExplicitGitHubRequest = /github|\brepo\b|repository|pull.?request|\bpr\b|\bcommit\b|\bbranch\b/i.test(userMessage);
            if (!repoPath && isExplicitGitHubRequest) {
                repoPath = this.getLastRepoPath();
            }

            // Normalize repo path (remove trailing .git)
            if (repoPath) {
                repoPath = repoPath.replace(/\.git$/, '');
            }

            const isReadmeRequest = /readme|read\s*me|about\s+this\s+repo|about\s+the\s+repo|what\s+is\s+this\s+repo|explain\s+this\s+repo/i.test(userMessage);
            const isImagesRequest = /get.*images|fetch.*images|show.*images/i.test(userMessage) || (/images/i.test(userMessage) && !isReadmeRequest);
            const isFileRequest = (isImagesRequest || /file|content|get.*file/i.test(userMessage)) && !isReadmeRequest;
            const isDirectoryRequest = /directory|folder|list.*files|files.*in|what.*files|show.*files/i.test(userMessage) && !isReadmeRequest && !isImagesRequest;

            const localFile = await this.tryReadLocalFileFromMessage(userMessage);
            if (localFile) {
                const response = await this.handleLocalFileMessage(userMessage, localFile);
                const assistantMsgId = this.chatHistory.addMessage('assistant', response);
                const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                if (assistantMessageRecord) {
                    this.conversationContext.addToContext(assistantMessageRecord);
                }
                return response;
            }
            
            let githubContext = '';
            
            // Handle README request (GitHub or Local fallback)
            if (isReadmeRequest) {
                let readmeFetched = false;
                
                // 1. Try to fetch from GitHub if repoPath is set
                if (repoPath && this.mcpClient) {
                    try {
                        await this.mcpClient.connect();
                        const repoUrl = `https://github.com/${repoPath}`;
                        console.log(`[ContextualChat] Getting repo info for: ${repoUrl}`);
                        const repoInfo = await this.mcpClient.getGitHubRepoInfo(repoUrl);
                        
                        if (repoInfo.success) {
                            const defaultBranch = repoInfo.repository?.defaultBranch || 'main';
                            console.log(`[ContextualChat] Using branch: ${defaultBranch}`);
                            
                            const readmeVariations = ['README.md', 'readme.md', 'README', 'readme'];
                            const branchesToTry = [defaultBranch, 'main', 'master', 'develop'];
                            
                            for (const readmeName of readmeVariations) {
                                for (const branch of branchesToTry) {
                                    try {
                                        const readmeContent = await this.mcpClient.getGitHubFileContent(repoUrl, readmeName, branch);
                                        if (readmeContent.success) {
                                            const rawContent = readmeContent.file.content;
                                            const absoluteContent = this.makeMarkdownUrlsAbsolute(rawContent, repoPath, branch);
                                            githubContext = `[GitHub Repository README Context - ${readmeName} (${branch} branch)]\n${absoluteContent}\n\n`;
                                            this.currentReadmeContext = githubContext;
                                            readmeFetched = true;
                                            break;
                                        }
                                    } catch {
                                        continue;
                                    }
                                }
                                if (readmeFetched) break;
                            }
                        }
                    } catch (err) {
                        console.error('[ContextualChat] Failed to fetch remote README:', err);
                    }
                }

                // 2. Try to fetch from local workspace if remote failed or wasn't attempted
                if (!readmeFetched) {
                    console.log(`[ContextualChat] Fetching local workspace README`);
                    const folders = vscode.workspace.workspaceFolders || [];
                    const readmeNames = ['README.md', 'readme.md', 'README', 'README.txt', 'readme.txt'];
                    for (const folder of folders) {
                        for (const name of readmeNames) {
                            try {
                                const localPath = path.join(folder.uri.fsPath, name);
                                const content = await fs.readFile(localPath, 'utf8');
                                if (content) {
                                    githubContext = `[Local Repository README Context - ${name}]\n${content}\n\n`;
                                    this.currentReadmeContext = githubContext;
                                    readmeFetched = true;
                                    break;
                                }
                            } catch {
                                continue;
                            }
                        }
                        if (readmeFetched) break;
                    }
                }

                // If README could not be found anywhere, return a user-friendly error response
                if (!readmeFetched) {
                    const response = `❌ README file not found in repository or local workspace.`;
                    const assistantMsgId = this.chatHistory.addMessage('assistant', response);
                    const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                    if (assistantMessageRecord) {
                        this.conversationContext.addToContext(assistantMessageRecord);
                    }
                    return response;
                }
            }

            // If we have a cached README context, keep it in the prompt context
            if (!githubContext && this.currentReadmeContext) {
                githubContext = this.currentReadmeContext;
            }

            // Handle other GitHub requests (Images, Files, Directories, Repo Info)
            // Only enter this block when the message is an explicit GitHub request with a repo path.
            if (repoPath && isExplicitGitHubRequest && this.mcpClient && !isReadmeRequest) {
                try {
                    await this.mcpClient.connect();
                    const repoUrl = `https://github.com/${repoPath}`;
                    
                    let response: string = '';
                    let shouldReturnResponse = false;
                    
                    if (isImagesRequest) {
                        // Fetch repository info first to determine default branch
                        console.log(`[ContextualChat] Fetching images for: ${repoUrl}`);
                        let defaultBranch = 'main';
                        try {
                            const repoInfo = await this.mcpClient.getGitHubRepoInfo(repoUrl);
                            if (repoInfo.success) {
                                defaultBranch = repoInfo.repository?.defaultBranch || 'main';
                            }
                        } catch {}

                        const imageFiles = ['schema.png', 'pcb.png', 'clock_face.png', 'mobile_app.png', 'web_interface.png'];
                        let imageMarkdown = '';
                        for (const img of imageFiles) {
                            const imageUrl = `https://raw.githubusercontent.com/${repoPath}/${defaultBranch}/${img}`;
                            imageMarkdown += `### 🖼️ ${img.replace('.png', '').replace('_', ' ').toUpperCase()}\n\n![${img}](${imageUrl})\n\n`;
                        }
                        response = `# Repository Images for ${repoPath}\n\nHere are the images fetched from the repository:\n\n${imageMarkdown}`;
                        shouldReturnResponse = true;
                    } else if (isFileRequest) {
                        // Extract single file path
                        let filePath = '';
                        const filePathPatterns = [
                            /(?:get|show|fetch|view|download|read)\s+([\w\-\/\.]+\.[a-z0-9]+)/i,
                            /file\s+([\w\-\/\.]+\.[a-z0-9]+)/i,
                            /([\w\-\/\.]+\.[a-z0-9]+)\s+file/i
                        ];
                        for (const pattern of filePathPatterns) {
                            const match = userMessage.match(pattern);
                            if (match) {
                                filePath = match[1];
                                break;
                            }
                        }

                        if (filePath) {
                            console.log(`[ContextualChat] Fetching file: ${filePath} from: ${repoUrl}`);
                            let defaultBranch = 'main';
                            try {
                                const repoInfo = await this.mcpClient.getGitHubRepoInfo(repoUrl);
                                if (repoInfo.success) {
                                    defaultBranch = repoInfo.repository?.defaultBranch || 'main';
                                }
                            } catch {}

                            const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(filePath);
                            if (isImage) {
                                const imageUrl = `https://raw.githubusercontent.com/${repoPath}/${defaultBranch}/${filePath}`;
                                response = `# ${path.basename(filePath)}\n\n![${path.basename(filePath)}](${imageUrl})`;
                                shouldReturnResponse = true;
                            } else {
                                const fileContent = await this.mcpClient.getGitHubFileContent(repoUrl, filePath, defaultBranch);
                                if (fileContent.success) {
                                    const ext = path.extname(filePath).substring(1);
                                    response = `# ${filePath} (${fileContent.file.branch || defaultBranch} branch)\n\n\`\`\`${ext}\n${fileContent.file.content}\n\`\`\``;
                                    shouldReturnResponse = true;
                                } else {
                                    // Try master branch fallback
                                    const fallbackContent = await this.mcpClient.getGitHubFileContent(repoUrl, filePath, 'master');
                                    if (fallbackContent.success) {
                                        const ext = path.extname(filePath).substring(1);
                                        response = `# ${filePath} (master branch)\n\n\`\`\`${ext}\n${fallbackContent.file.content}\n\`\`\``;
                                        shouldReturnResponse = true;
                                    } else {
                                        response = `❌ Failed to fetch file content: ${fileContent.error || 'File not found'}`;
                                        shouldReturnResponse = true;
                                    }
                                }
                            }
                        } else {
                            response = `❌ Please specify the file name or path you want to fetch (e.g., "get package.json").`;
                            shouldReturnResponse = true;
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
                        shouldReturnResponse = true;
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
                        shouldReturnResponse = true;
                    }
                    
                    if (shouldReturnResponse) {
                        const assistantMsgId = this.chatHistory.addMessage('assistant', response);
                        const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                        if (assistantMessageRecord) {
                            this.conversationContext.addToContext(assistantMessageRecord);
                        }
                        return response;
                    }
                } catch (error) {
                    const errorResponse = `❌ Error fetching GitHub data for ${repoPath}: ${error}`;
                    const assistantMsgId = this.chatHistory.addMessage('assistant', errorResponse);
                    const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                    if (assistantMessageRecord) {
                        this.conversationContext.addToContext(assistantMessageRecord);
                    }
                    return errorResponse;
                }
            }
            
            // Get conversation history — last 10 messages, filter out bad fallback responses
            const history = this.chatHistory.getMessages();
            const cleanHistory = history
                .slice(-10)
                .filter(m => m.id !== userMsgId)
                .filter(m => !m.content.includes('MCP server is not reachable') &&
                             !m.content.includes('I am a coding assistant designed to help'))
                .map(m => ({ role: m.role, content: m.content }));

            // Send to MCP server with clean history for memory
            if (this.mcpClient) {
                try {
                    const folder = vscode.workspace.workspaceFolders?.[0];
                    const workspacePath = folder?.uri.fsPath || process.cwd();
                    
                    // Check for Git requests
                    const isGitQuery = /\bgit\b/i.test(userMessage);
                    const gitOpMatch = userMessage.match(/\bgit\s+(status|diff|log|branch)\b/i) ||
                                       (isGitQuery && userMessage.match(/\b(status|diff|log|branch|history|changes)\b/i));
                    
                    let gitContext = '';
                    if (gitOpMatch) {
                        try {
                            await this.mcpClient.connect();
                            let op = gitOpMatch[1].toLowerCase();
                            if (op === 'history') op = 'log';
                            if (op === 'changes') op = 'diff';
                            
                            if (['status', 'diff', 'log', 'branch'].includes(op)) {
                                console.log(`[ContextualChat] Fetching Git context via MCP: ${op}`);
                                const result = await this.mcpClient.callTool('git_operation', {
                                    operation: op,
                                    workspacePath
                                });
                                const output = result?.result || result?.stdout || JSON.stringify(result);
                                gitContext = `[Local Git Context - git ${op}]\n${output}\n\n`;
                            }
                        } catch (gitErr) {
                            console.error('[ContextualChat] Failed to fetch Git context:', gitErr);
                        }
                    }
                    
                    const editor = vscode.window.activeTextEditor;
                    const editorContext = editor ? {
                        code: editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection),
                        language: editor.document.languageId,
                        activeFilePath: editor.document.uri.fsPath,
                        activeFileName: path.basename(editor.document.uri.fsPath)
                    } : undefined;

                    let promptQuery = userMessage;
                    if (gitContext || githubContext) {
                        promptQuery = `${gitContext}${githubContext}User Question: ${userMessage}`;
                    }
                    
                    if (githubContext && (isReadmeRequest || /next|continue|walkthrough|step|part|section|go on/i.test(userMessage))) {
                        promptQuery = `${githubContext}
[INSTRUCTION] The user is doing a step-by-step walkthrough of the repository based on the README provided above.
1. If this is the start (e.g. they asked "tell me about this repo"), provide a concise high-level overview of the repository, list its main sections/topics, explain the first section/topic in detail, and invite them to move to the next section when ready.
2. If they are continuing (e.g. saying "next", "continue", or asking about subsequent parts), identify from the conversation history which section was last explained, explain the next section/topic in detail, and invite them to continue.
3. Keep the walkthrough structured and easy to digest by explaining only one main section/topic at a time. Do not dump the entire README explanation at once.

User Query: ${userMessage}`;
                    }

                    const response = await this.mcpClient.callTool('chat_assistant', {
                        query: promptQuery,
                        messages: cleanHistory,
                        context: {
                            ...this.getConversationMetadata(),
                            ...editorContext
                        },
                        language: editor ? editor.document.languageId : 'general',
                        model,
                        ...(workspacePath ? { workspacePath } : {})
                    });

                    const assistantResponse = this.extractResponseText(response);
                    const assistantMsgId = this.chatHistory.addMessage('assistant', assistantResponse);
                    const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                    if (assistantMessageRecord) {
                        this.conversationContext.addToContext(assistantMessageRecord);
                    }
                    return assistantResponse;
                } catch (mcpError: any) {
                    console.error('[ContextualChat] callTool failed:', mcpError?.message || mcpError);
                    const fallbackResponse = this.generateContextualFallback(userMessage, history);
                    const assistantMsgId = this.chatHistory.addMessage('assistant', fallbackResponse);
                    const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                    if (assistantMessageRecord) {
                        this.conversationContext.addToContext(assistantMessageRecord);
                    }
                    return fallbackResponse;
                }
            } else {
                // No MCP client available, use contextual fallback
                const fallbackResponse = this.generateContextualFallback(userMessage, history);
                const assistantMsgId = this.chatHistory.addMessage('assistant', fallbackResponse);
                const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
                if (assistantMessageRecord) {
                    this.conversationContext.addToContext(assistantMessageRecord);
                }
                return fallbackResponse;
            }

        } catch (error) {
            const errorMsg = `Error in contextual chat: ${error}`;
            const assistantMsgId = this.chatHistory.addMessage('assistant', errorMsg);
            const assistantMessageRecord = this.chatHistory.getMessages().find(m => m.id === assistantMsgId);
            if (assistantMessageRecord) {
                this.conversationContext.addToContext(assistantMessageRecord);
            }
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

    private async tryReadLocalFileFromMessage(message: string): Promise<LocalFileContext | null> {
        const filePath = this.extractLocalFilePath(message);
        if (!filePath || !this.isPathInsideWorkspace(filePath)) {
            return null;
        }

        try {
            const stat = await fs.stat(filePath);
            if (!stat.isFile() || stat.size > 250_000) {
                return null;
            }

            const content = await fs.readFile(filePath, 'utf8');
            return {
                filePath,
                language: this.inferLanguage(filePath),
                content
            };
        } catch {
            return null;
        }
    }

    private extractLocalFilePath(message: string): string | null {
        const candidates = [
            ...(message.match(/(?:[A-Za-z]:[\\/]|\/)[^\s`'"]+/g) || []),
            ...(message.match(/(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+/g) || [])
        ];

        for (const candidate of candidates) {
            const cleaned = candidate.replace(/[),.;\]]+$/, '');
            if (!path.extname(cleaned)) {
                continue;
            }

            if (path.isAbsolute(cleaned)) {
                return path.resolve(cleaned);
            }

            const workspacePath = this.resolveWorkspaceRelativePath(cleaned);
            if (workspacePath) {
                return workspacePath;
            }
        }

        return null;
    }

    private resolveWorkspaceRelativePath(relativePath: string): string | null {
        const folders = vscode.workspace.workspaceFolders || [];
        for (const folder of folders) {
            const resolved = path.resolve(folder.uri.fsPath, relativePath);
            if (this.isPathInsideWorkspace(resolved)) {
                return resolved;
            }
        }

        return null;
    }

    private isPathInsideWorkspace(filePath: string): boolean {
        const folders = vscode.workspace.workspaceFolders || [];
        const resolved = path.resolve(filePath);

        return folders.some(folder => {
            const root = path.resolve(folder.uri.fsPath);
            return resolved === root || resolved.startsWith(root + path.sep);
        });
    }

    private inferLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languages: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.mjs': 'javascript',
            '.cjs': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.json': 'json',
            '.md': 'markdown'
        };
        return languages[ext] || 'text';
    }

    private async handleLocalFileMessage(userMessage: string, file: LocalFileContext): Promise<string> {
        const history = this.chatHistory.getMessages();
        const recentText = history.slice(-6).map(m => m.content).join('\n').toLowerCase();
        const wantsReview = /review|analy[sz]e|audit|feedback|issues|bugs/.test(`${recentText}\n${userMessage}`.toLowerCase());
        const truncatedContent = file.content.length > 30_000
            ? `${file.content.slice(0, 30_000)}\n\n/* Content truncated for review. */`
            : file.content;

        if (!this.mcpClient) {
            return `Loaded ${path.basename(file.filePath)} (${file.language}, ${file.content.length} chars), but the MCP server is not connected.`;
        }

        try {
            await this.mcpClient.connect();

            if (wantsReview) {
                const review = await this.mcpClient.callTool('code_review', {
                    code: truncatedContent,
                    language: file.language,
                    aspects: ['bugs', 'security', 'performance', 'maintainability', 'best-practices'],
                    filePath: file.filePath
                });

                const reviewText = review?.review || review?.result || this.extractResponseText(review);
                return `Reviewing \`${file.filePath}\`:\n\n${reviewText}`;
            }

            const folder = vscode.workspace.workspaceFolders?.[0];
            const workspacePath = folder?.uri.fsPath;
            const response = await this.mcpClient.callTool('chat_assistant', {
                query: `The user referenced this local file: ${file.filePath}\n\nFile language: ${file.language}\n\nFile contents:\n\`\`\`${file.language}\n${truncatedContent}\n\`\`\`\n\nUser message: ${userMessage}`,
                messages: [],
                context: this.getConversationMetadata(),
                language: file.language,
                ...(workspacePath ? { workspacePath } : {})
            });

            return this.extractResponseText(response);
        } catch (error) {
            return `I loaded \`${file.filePath}\`, but the MCP request failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /**
     * Get the last discussed repository path in chat history
     */
    private getLastRepoPath(): string {
        const messages = this.chatHistory.getMessages();
        for (let i = messages.length - 1; i >= 0; i--) {
            const content = messages[i].content;
            
            // Check for explicit GitHub URLs
            const githubUrlMatch = content.match(/github\.com\/([^\s\/]+\/[^\s\/:]+)/i);
            if (githubUrlMatch) {
                const pathStr = githubUrlMatch[1].replace(/^\.?\//, '').replace(/\.git$/, '');
                const parts = pathStr.split('/');
                if (parts.length >= 2) {
                    return `${parts[0]}/${parts[1]}`;
                }
            }

            // Check if repoPath was used in logs or errors
            const repoPathMatch = content.match(/Error fetching GitHub data for ([^\s:]+)/i) ||
                                  content.match(/Directory Contents for https:\/\/github\.com\/([^\s\/]+\/[^\s\/]+)/i) ||
                                  content.match(/Repository Images for ([^\s\n]+)/i);
            if (repoPathMatch) {
                return repoPathMatch[1].trim().replace(/\.git$/, '');
            }
        }
        return '';
    }

    /**
     * Rewrite relative markdown/HTML URLs to absolute GitHub URLs
     */
    private makeMarkdownUrlsAbsolute(markdown: string, repoPath: string, branch: string): string {
        // 1. Rewrite markdown images: ![alt](relative_path)
        // Avoid matching absolute URLs starting with http://, https://, data:, or mailto:
        markdown = markdown.replace(
            /!\[([^\]]*)\]\(((?!\w+:\/\/|data:)[^\)]+)\)/g,
            (match, alt, relPath) => {
                const cleanPath = relPath.replace(/^\.?\//, '');
                return `![${alt}](https://raw.githubusercontent.com/${repoPath}/${branch}/${cleanPath})`;
            }
        );

        // 2. Rewrite markdown links: [text](relative_path)
        // Avoid matching absolute URLs or section links like #something
        markdown = markdown.replace(
            /\[([^\]]*)\]\(((?!\w+:\/\/|data:|#)[^\)]+)\)/g,
            (match, text, relPath) => {
                const cleanPath = relPath.replace(/^\.?\//, '');
                return `[${text}](https://github.com/${repoPath}/blob/${branch}/${cleanPath})`;
            }
        );

        // 3. Rewrite HTML img tags: <img src="relative_path" ...> or <img ... src="relative_path">
        markdown = markdown.replace(
            /<img\s+([^>]*?)src=["']((?!\w+:\/\/|data:)[^"']+)["']([^>]*?)>/g,
            (match, prefix, relPath, suffix) => {
                const cleanPath = relPath.replace(/^\.?\//, '');
                return `<img ${prefix}src="https://raw.githubusercontent.com/${repoPath}/${branch}/${cleanPath}"${suffix}>`;
            }
        );

        return markdown;
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.chatHistory.clearHistory();
        this.conversationContext.clearContext();
        this.currentReadmeContext = '';
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
        return `⚠️ **MCP server is not reachable.**

Your message: "${query}"

Start the server first:
\`\`\`bash
cd ~/Coding-AI-Assistant/mcp-ollama
npm start
\`\`\`
Then verify: \`curl http://localhost:3078/health\``;
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
