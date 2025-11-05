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

    // Fast execution capability
    async execute(params: { action: string; params: any; context: any }): Promise<any> {
        const { action, params: stepParams } = params;
        
        try {
            // Fast code generation using phi4
            const prompt = `Create ${stepParams.language || 'TypeScript'} code for: ${action}`;
            const code = await this.ollamaProvider.generateText({
                prompt,
                model: 'phi4:latest'
            });
            
            return {
                success: true,
                code,
                filesModified: [`generated.${stepParams.language === 'python' ? 'py' : 'ts'}`],
                action
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: `// Error generating code for: ${action}`,
                filesModified: []
            };
        }
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

    private async analyzeCodeAction(description: string, context: any): Promise<any> {
        const files = context.files || [];
        const analysisResults = [];
        
        for (const file of files.slice(0, 5)) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file);
                const exists = await this.fileExists(sanitizedPath);
                
                if (!exists) continue;
                
                const content = await this.fileSystemTool.readFile(sanitizedPath);
                const analysis = await this.ollamaProvider.analyzeCode({
                    code: content.substring(0, 8000),
                    language: context.language || 'typescript',
                    analysisType: 'bugs'
                });
                
                analysisResults.push({
                    file: sanitizedPath,
                    analysis: analysis.analysis,
                    suggestions: analysis.suggestions
                });
            } catch (error) {
                this.logger.warn(`Failed to analyze ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        
        return {
            success: true,
            results: analysisResults,
            description: `Analyzed ${analysisResults.length} files`,
            type: 'analysis'
        };
    }

    private async implementCode(description: string, context: any): Promise<any> {
        const sanitizedDesc = this.sanitizeInput(description);
        const fileName = this.generateFileName(sanitizedDesc, context);
        const filePath = this.sanitizeFilePath(`${context?.workspacePath || '.'}/src/${fileName}`);
        
        const exists = await this.fileExists(filePath);
        if (exists) {
            this.logger.warn(`File ${filePath} already exists, will be overwritten`);
        }

        const prompt = `Implement: ${sanitizedDesc}\nLanguage: ${context?.language || 'typescript'}\n\nGenerate complete, working code with proper error handling.`;

        try {
            const code = await this.ollamaProvider.generateText({
                prompt,
                model: 'deepseek-r1:70b'
            });

            const sanitizedCode = this.sanitizeInput(code);
            await this.fileSystemTool.writeFile(filePath, sanitizedCode);

            return {
                success: true,
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
        const fixes: any[] = [];

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
                    this.logger.warn(`File ${sanitizedPath} too large, skipping`);
                    failedFiles.push(file);
                    continue;
                }
                
                // Create backup
                const backupPath = `${sanitizedPath}.backup.${Date.now()}`;
                await this.fileSystemTool.writeFile(backupPath, content);
                
                const prompt = `Fix code issues: ${sanitizedDesc}\nFile: ${sanitizedPath}\nContent:\n${content.substring(0, 10000)}\n\nProvide corrected code with explanations.`;

                const fixedCode = await this.ollamaProvider.generateText({
                    prompt,
                    model: 'deepseek-r1:70b'
                });

                const sanitizedCode = this.sanitizeInput(fixedCode);
                await this.fileSystemTool.writeFile(sanitizedPath, sanitizedCode);
                
                fixedFiles.push(sanitizedPath);
                fixes.push({
                    file: sanitizedPath,
                    backup: backupPath,
                    changes: 'Code fixed and improved'
                });
                
                this.logger.info(`Successfully fixed: ${sanitizedPath}`);
            } catch (error) {
                this.logger.error(`Failed to fix file: ${file}`, error);
                this.trackFailure('fix', file, error);
                failedFiles.push(file);
            }
        }

        return {
            success: failedFiles.length === 0,
            filesModified: fixedFiles,
            failedFiles,
            fixes,
            description: `Fixed ${fixedFiles.length} files, ${failedFiles.length} failed`,
            rollback: () => this.rollbackFixes(fixes)
        };
    }

    private async rollbackFixes(fixes: any[]): Promise<void> {
        for (const fix of fixes) {
            try {
                const backupContent = await this.fileSystemTool.readFile(fix.backup);
                await this.fileSystemTool.writeFile(fix.file, backupContent);
                this.logger.info(`Rolled back: ${fix.file}`);
            } catch (error) {
                this.logger.error(`Failed to rollback: ${fix.file}`);
            }
        }
    }

    private async refactorCode(description: string, context: any): Promise<any> {
        const files = (context?.files || []).slice(0, 5);
        const sanitizedDesc = this.sanitizeInput(description);
        const refactoredFiles: string[] = [];
        const failedFiles: string[] = [];
        const refactorings: any[] = [];

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
                    this.logger.warn(`File ${sanitizedPath} too large for refactoring, skipping`);
                    failedFiles.push(file);
                    continue;
                }
                
                // Create backup
                const backupPath = `${sanitizedPath}.backup.${Date.now()}`;
                await this.fileSystemTool.writeFile(backupPath, content);
                
                const prompt = `Refactor code for better maintainability: ${sanitizedDesc}\nFile: ${sanitizedPath}\nContent:\n${content.substring(0, 8000)}\n\nProvide refactored code with improvements.`;

                const refactoredCode = await this.ollamaProvider.generateText({
                    prompt,
                    model: 'deepseek-r1:70b'
                });

                const sanitizedCode = this.sanitizeInput(refactoredCode);
                await this.fileSystemTool.writeFile(sanitizedPath, sanitizedCode);
                
                refactoredFiles.push(sanitizedPath);
                refactorings.push({
                    file: sanitizedPath,
                    backup: backupPath,
                    improvements: 'Code refactored for better maintainability'
                });
                
                this.logger.info(`Successfully refactored: ${sanitizedPath}`);
            } catch (error) {
                this.logger.error(`Failed to refactor file: ${file}`, error);
                this.trackFailure('refactor', file, error);
                failedFiles.push(file);
            }
        }

        return {
            success: failedFiles.length === 0,
            filesModified: refactoredFiles,
            failedFiles,
            refactorings,
            description: `Refactored ${refactoredFiles.length} files, ${failedFiles.length} failed`,
            rollback: () => this.rollbackRefactorings(refactorings)
        };
    }

    private async rollbackRefactorings(refactorings: any[]): Promise<void> {
        for (const refactoring of refactorings) {
            try {
                const backupContent = await this.fileSystemTool.readFile(refactoring.backup);
                await this.fileSystemTool.writeFile(refactoring.file, backupContent);
                this.logger.info(`Rolled back refactoring: ${refactoring.file}`);
            } catch (error) {
                this.logger.error(`Failed to rollback refactoring: ${refactoring.file}`);
            }
        }
    }

    private async generateCode(description: string, context: any): Promise<any> {
        const sanitizedDesc = this.sanitizeInput(description);
        const language = context.language || 'typescript';
        const workspacePath = context.workspacePath || '.';
        
        try {
            // Generate filename if not provided
            const fileName = context.fileName || this.generateFileName(sanitizedDesc, context);
            const filePath = this.sanitizeFilePath(`${workspacePath}/src/${fileName}`);
            
            const prompt = `Generate ${language} code for: ${sanitizedDesc}\n\nRequirements:\n- Complete, working code\n- Proper error handling\n- Clear documentation\n- Follow best practices\n\nProvide only the code without explanations.`;

            const code = await this.ollamaProvider.generateText({
                prompt,
                model: 'deepseek-r1:70b'
            });

            const sanitizedCode = this.sanitizeInput(code);
            
            // Write to file if workspace path is provided
            if (context.writeToFile !== false) {
                await this.fileSystemTool.writeFile(filePath, sanitizedCode);
                
                return {
                    success: true,
                    code: sanitizedCode,
                    filePath,
                    filesModified: [filePath],
                    description: `Generated ${language} code for: ${sanitizedDesc}`,
                    language,
                    type: 'generation'
                };
            }
            
            return {
                success: true,
                code: sanitizedCode,
                description: `Generated ${language} code for: ${sanitizedDesc}`,
                language,
                type: 'generation'
            };
        } catch (error) {
            this.logger.error(`Code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return {
                success: false,
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
            .replace(/^\//, '')
            .replace(/[<>:"|?*]/g, '_');
        
        if (!sanitized || sanitized.includes('~') || sanitized.length > 200) {
            throw new Error(`Invalid file path: ${filePath}`);
        }
        
        return sanitized;
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>"'&;\\`$(){}[\]|]/g, '').substring(0, 10000);
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

    // Enhanced capabilities for autonomous execution
    getCapabilities(): any {
        return {
            actions: ['implement', 'fix', 'refactor', 'analyze', 'generate'],
            languages: ['typescript', 'javascript', 'python', 'java', 'go', 'rust'],
            features: {
                backup: true,
                rollback: true,
                validation: true,
                fileOperations: true
            },
            limits: {
                maxFileSize: 30000,
                maxFiles: 10,
                maxCodeLength: 10000
            }
        };
    }

    async validateExecution(result: any): Promise<boolean> {
        if (!result || result.error) return false;
        if (result.success === false) return false;
        
        // Additional validation for code operations
        if (result.filesModified && result.filesModified.length > 0) {
            for (const file of result.filesModified) {
                try {
                    const exists = await this.fileExists(file);
                    if (!exists) return false;
                } catch {
                    return false;
                }
            }
        }
        
        return true;
    }
}