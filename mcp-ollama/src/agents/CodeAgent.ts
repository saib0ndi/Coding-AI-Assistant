import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';

export class CodeAgent {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private failedOperations: Map<string, string[]> = new Map();

    constructor(ollamaProvider: OllamaProvider, fileSystemTool: FileSystemTool) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = fileSystemTool;
    }

    async executeStep(step: WorkflowStep, context: any): Promise<any> {
        const { action } = step;
        
        if (action.includes('implement') || action.includes('create')) {
            return await this.implementCode(action, context);
        }
        
        if (action.includes('fix') || action.includes('error')) {
            return await this.fixCode(action, context);
        }
        
        if (action.includes('refactor')) {
            return await this.refactorCode(action, context);
        }

        return await this.generateCode(action, context);
    }

    private async implementCode(description: string, context: any): Promise<any> {
        const sanitizedDesc = this.sanitizeInput(description);
        const fileName = this.generateFileName(sanitizedDesc, context);
        const filePath = this.sanitizeFilePath(`${context?.workspacePath || '.'}/src/${fileName}`);
        
        const exists = await this.fileExists(filePath);
        if (exists) {
            this.logger.warn(`File ${filePath} already exists, will be overwritten`);
        }

        const prompt = `Implement: ${sanitizedDesc}
Language: ${context?.language || 'typescript'}

Generate complete, working code with proper error handling.`;

        try {
            const code = await this.ollamaProvider.generateText({
                prompt,
                model: 'deepseek-r1:70b'
            });

            const sanitizedCode = this.sanitizeInput(code);
            await this.fileSystemTool.writeFile(filePath, sanitizedCode);

            return {
                filesModified: [filePath],
                code: sanitizedCode,
                description: `Implemented: ${sanitizedDesc}`,
                overwritten: exists
            };
        } catch (error) {
            this.trackFailure('implement', filePath, error);
            throw error;
        }
    }

    private async fixCode(description: string, context: any): Promise<any> {
        const files = (context?.files || []).slice(0, 10);
        const sanitizedDesc = this.sanitizeInput(description);
        const fixedFiles: string[] = [];
        const failedFiles: string[] = [];

        for (const file of files) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file);
                const exists = await this.fileExists(sanitizedPath);
                
                if (!exists) {
                    this.logger.warn(`File ${sanitizedPath} does not exist, skipping`);
                    failedFiles.push(sanitizedPath);
                    continue;
                }

                const content = await this.fileSystemTool.readFile(sanitizedPath);
                if (content.length > 30000) {
                    failedFiles.push(file);
                    continue;
                }
                
                const prompt = `Fix code: ${sanitizedDesc}
File: ${sanitizedPath}
Content:
${content.substring(0, 10000)}

Provide corrected code.`;

                const fixedCode = await this.ollamaProvider.generateText({
                    prompt,
                    model: 'deepseek-r1:70b'
                });

                const sanitizedCode = this.sanitizeInput(fixedCode);
                await this.fileSystemTool.writeFile(sanitizedPath, sanitizedCode);
                fixedFiles.push(sanitizedPath);
            } catch (error) {
                this.logger.error(`Failed to fix file: ${file}`, error);
                this.trackFailure('fix', file, error);
                failedFiles.push(file);
            }
        }

        return {
            filesModified: fixedFiles,
            failedFiles,
            description: `Fixed ${fixedFiles.length} files, ${failedFiles.length} failed`,
            success: failedFiles.length === 0
        };
    }

    private async refactorCode(description: string, context: any): Promise<any> {
        const files = (context?.files || []).slice(0, 5);
        const sanitizedDesc = this.sanitizeInput(description);
        const refactoredFiles: string[] = [];
        const failedFiles: string[] = [];

        for (const file of files) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file);
                const exists = await this.fileExists(sanitizedPath);
                
                if (!exists) {
                    this.logger.warn(`File ${sanitizedPath} does not exist, skipping`);
                    failedFiles.push(sanitizedPath);
                    continue;
                }

                const content = await this.fileSystemTool.readFile(sanitizedPath);
                if (content.length > 20000) {
                    failedFiles.push(file);
                    continue;
                }
                
                const prompt = `Refactor code: ${sanitizedDesc}
File: ${sanitizedPath}
Content:
${content.substring(0, 8000)}

Provide refactored code.`;

                const refactoredCode = await this.ollamaProvider.generateText({
                    prompt,
                    model: 'deepseek-r1:70b'
                });

                const sanitizedCode = this.sanitizeInput(refactoredCode);
                await this.fileSystemTool.writeFile(sanitizedPath, sanitizedCode);
                refactoredFiles.push(sanitizedPath);
            } catch (error) {
                this.logger.error(`Failed to refactor file: ${file}`, error);
                this.trackFailure('refactor', file, error);
                failedFiles.push(file);
            }
        }

        return {
            filesModified: refactoredFiles,
            failedFiles,
            description: `Refactored ${refactoredFiles.length} files, ${failedFiles.length} failed`,
            success: failedFiles.length === 0
        };
    }

    private async generateCode(description: string, context: any): Promise<any> {
        const sanitizedDesc = this.sanitizeInput(description);
        const prompt = `Generate code for: ${sanitizedDesc}

Provide complete, working code.`;

        try {
            const code = await this.ollamaProvider.generateText({
                prompt,
                model: 'deepseek-r1:70b'
            });

            return {
                code: this.sanitizeInput(code),
                description: `Generated code for: ${sanitizedDesc}`
            };
        } catch (error) {
            return {
                code: '',
                description: `Failed to generate code for: ${sanitizedDesc}`,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private generateFileName(description: string, context: any): string {
        const langMap: Record<string, string> = {
            javascript: 'js',
            typescript: 'ts',
            python: 'py',
            java: 'java',
            go: 'go',
            rust: 'rs'
        };
        
        const ext = langMap[context?.language?.toLowerCase()] || 'ts';
        const name = description
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 50);
        
        return `${name || 'generated'}.${ext}`;
    }

    private sanitizeFilePath(filePath: string): string {
        if (!filePath || typeof filePath !== 'string') throw new Error('Valid file path required');
        
        const sanitized = filePath
            .replace(/\.\./g, '')
            .replace(/\/+/g, '/')
            .replace(/^\//g, '')
            .replace(/[<>:"|?*]/g, '_');
        
        if (!sanitized || sanitized.includes('~') || sanitized.length > 200) {
            throw new Error(`Invalid file path: ${filePath}`);
        }
        
        return sanitized;
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>"'&;\\`$(){}\[\]|]/g, '').substring(0, 10000);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await this.fileSystemTool.readFile(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private trackFailure(operation: string, filePath: string, error: unknown): void {
        const key = `${operation}_${Date.now()}`;
        const existing = this.failedOperations.get(key) || [];
        existing.push(`${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        this.failedOperations.set(key, existing);
    }

    getFailureReport(): Record<string, string[]> {
        return Object.fromEntries(this.failedOperations);
    }
}