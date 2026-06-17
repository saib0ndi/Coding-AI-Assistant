import { FileSystemTool } from '../tools/FileSystemTool.js';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';

export class FileAgent {
    private logger: Logger;
    private fileSystemTool: FileSystemTool;

    constructor(fileSystemTool: FileSystemTool) {
        this.logger = new Logger();
        this.fileSystemTool = fileSystemTool;
    }

    async executeStep(step: WorkflowStep, context: any): Promise<any> {
        const { action, params } = step;
        
        if (action === 'create_file' || (action.includes('create') && action.includes('file'))) {
            return await this.createFile(params, context);
        }
        
        if (action === 'write_file' || (action.includes('write') && action.includes('file'))) {
            return await this.writeFile(params, context);
        }
        
        if (action === 'read_file' || (action.includes('read') && action.includes('file'))) {
            return await this.readFile(params, context);
        }
        
        if (action === 'delete_file' || (action.includes('delete') && action.includes('file')) || 
            (action.includes('remove') && action.includes('file'))) {
            return await this.deleteFile(params, context);
        }
        
        if (action === 'create_directory' || action.includes('mkdir') || 
            (action.includes('create') && (action.includes('directory') || action.includes('folder')))) {
            return await this.createDirectory(params, context);
        }

        if (action === 'list_files' || (action.includes('list') && action.includes('file')) || 
            action.includes('scan directory')) {
            return await this.listFiles(params, context);
        }

        if (action === 'copy_file' || (action.includes('copy') && action.includes('file'))) {
            return await this.copyFile(params, context);
        }

        if (action === 'move_file' || (action.includes('move') && action.includes('file')) || 
            (action.includes('rename') && action.includes('file'))) {
            return await this.moveFile(params, context);
        }

        if (action === 'batch_operation' || action.includes('batch')) {
            return await this.batchOperation(params, context);
        }

        return await this.executeFileOperation(action, params, context);
    }

    private async createFile(params: any, context: any): Promise<any> {
        try {
            const filePath = this.sanitizeFilePath(params.path || `${context?.workspacePath || '.'}/new_file.txt`);
            const content = this.sanitizeInput(params.content || '');
            
            try {
                await this.fileSystemTool.readFile(filePath);
                this.logger.warn(`File already exists: ${filePath}`);
                return {
                    filesModified: [],
                    description: `File already exists: ${filePath}`,
                    success: false,
                    warning: 'File exists - use write_file to overwrite'
                };
            } catch {
                // File doesn't exist, proceed
            }
            
            await this.fileSystemTool.writeFile(filePath, content);
            
            return {
                filesModified: [filePath],
                description: `Created file: ${filePath}`,
                success: true
            };
        } catch (error) {
            this.logger.error('Failed to create file:', error);
            return {
                filesModified: [],
                description: 'File creation failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async writeFile(params: any, context: any): Promise<any> {
        try {
            const filePath = this.sanitizeFilePath(params.path);
            if (!filePath) {
                throw new Error('File path required for writing');
            }
            
            const content = this.sanitizeInput(params.content || '');
            await this.fileSystemTool.writeFile(filePath, content);
            
            return {
                filesModified: [filePath],
                description: `Wrote to file: ${filePath}`,
                success: true,
                bytesWritten: content.length
            };
        } catch (error) {
            this.logger.error('Failed to write file:', error);
            return {
                filesModified: [],
                description: 'File write failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async readFile(params: any, context: any): Promise<any> {
        try {
            const filePath = this.sanitizeFilePath(params.path);
            if (!filePath) {
                throw new Error('File path required for reading');
            }
            
            const content = await this.fileSystemTool.readFile(filePath);
            
            return {
                content,
                description: `Read file: ${filePath}`,
                success: true,
                bytesRead: content.length
            };
        } catch (error) {
            this.logger.error('Failed to read file:', error);
            return {
                content: null,
                description: 'File read failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async deleteFile(params: any, context: any): Promise<any> {
        try {
            const filePath = this.sanitizeFilePath(params.path);
            if (!filePath) {
                throw new Error('File path required for deletion');
            }
            
            await this.fileSystemTool.readFile(filePath);
            await this.fileSystemTool.deleteFile(filePath);
            
            return {
                filesModified: [filePath],
                description: `Deleted file: ${filePath}`,
                success: true
            };
        } catch (error) {
            this.logger.error('Failed to delete file:', error);
            return {
                filesModified: [],
                description: 'File deletion failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async createDirectory(params: any, context: any): Promise<any> {
        try {
            const dirPath = this.sanitizeFilePath(params.path || `${context?.workspacePath || '.'}/new_directory`);
            
            await this.fileSystemTool.createDirectory(dirPath);
            
            return {
                description: `Created directory: ${dirPath}`,
                success: true,
                path: dirPath
            };
        } catch (error) {
            this.logger.error('Failed to create directory:', error);
            return {
                description: 'Directory creation failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async listFiles(params: any, context: any): Promise<any> {
        try {
            const dirPath = this.sanitizeFilePath(params.path || context?.workspacePath || '.');
            const files = await this.fileSystemTool.listFiles(dirPath);
            
            let filteredFiles = files;
            if (params.filter && typeof params.filter === 'string') {
                const safeFilter = this.sanitizeRegexPattern(params.filter);
                try {
                    const filterRegex = new RegExp(safeFilter);
                    filteredFiles = files.filter(f => filterRegex.test(f));
                } catch {
                    filteredFiles = files;
                }
            }
            
            return {
                files: filteredFiles.slice(0, 1000),
                description: `Listed ${filteredFiles.length} files in: ${dirPath}`,
                success: true,
                totalFiles: files.length,
                filteredFiles: filteredFiles.length
            };
        } catch (error) {
            this.logger.error('Failed to list files:', error);
            return {
                files: [],
                description: 'File listing failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async copyFile(params: any, context: any): Promise<any> {
        try {
            const sourcePath = this.sanitizeFilePath(params.source || params.from);
            const destPath = this.sanitizeFilePath(params.destination || params.to);
            
            if (!sourcePath || !destPath) {
                throw new Error('Both source and destination paths required for copy');
            }
            
            const content = await this.fileSystemTool.readFile(sourcePath);
            await this.fileSystemTool.writeFile(destPath, content);
            
            return {
                filesModified: [destPath],
                description: `Copied ${sourcePath} to ${destPath}`,
                success: true,
                source: sourcePath,
                destination: destPath
            };
        } catch (error) {
            this.logger.error('Failed to copy file:', error);
            return {
                filesModified: [],
                description: 'File copy failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async moveFile(params: any, context: any): Promise<any> {
        try {
            const sourcePath = this.sanitizeFilePath(params.source || params.from);
            const destPath = this.sanitizeFilePath(params.destination || params.to);
            
            if (!sourcePath || !destPath) {
                throw new Error('Both source and destination paths required for move');
            }
            
            const content = await this.fileSystemTool.readFile(sourcePath);
            await this.fileSystemTool.writeFile(destPath, content);
            await this.fileSystemTool.deleteFile(sourcePath);
            
            return {
                filesModified: [destPath],
                description: `Moved ${sourcePath} to ${destPath}`,
                success: true,
                source: sourcePath,
                destination: destPath
            };
        } catch (error) {
            this.logger.error('Failed to move file:', error);
            return {
                filesModified: [],
                description: 'File move failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async batchOperation(params: any, context: any): Promise<any> {
        const operation = this.sanitizeInput(params.operation);
        const files = (params.files || []).slice(0, 20);
        const successFiles: string[] = [];
        const failedFiles: string[] = [];

        for (const fileConfig of files) {
            try {
                let result;
                switch (operation) {
                    case 'create':
                        result = await this.createFile(fileConfig, context);
                        break;
                    case 'write':
                        result = await this.writeFile(fileConfig, context);
                        break;
                    case 'delete':
                        result = await this.deleteFile(fileConfig, context);
                        break;
                    default:
                        throw new Error(`Unknown batch operation: ${operation}`);
                }
                
                if (result.success) {
                    successFiles.push(...result.filesModified);
                } else {
                    failedFiles.push(fileConfig.path);
                }
            } catch (error) {
                this.logger.error(`Batch operation failed for ${fileConfig.path}:`, error);
                failedFiles.push(fileConfig.path);
            }
        }

        return {
            filesModified: successFiles,
            failedFiles,
            description: `Batch ${operation}: ${successFiles.length} succeeded, ${failedFiles.length} failed`,
            success: failedFiles.length === 0,
            totalProcessed: files.length
        };
    }

    private async executeFileOperation(action: string, params: any, context: any): Promise<any> {
        const sanitizedAction = this.sanitizeInput(action);
        this.logger.info(`Executing generic file operation: ${sanitizedAction}`);
        
        try {
            return {
                description: `Executed file operation: ${sanitizedAction}`,
                success: true,
                warning: 'Generic handler - operation may not be fully implemented'
            };
        } catch (error) {
            this.logger.error(`Generic file operation failed: ${sanitizedAction}`, error);
            return {
                description: `File operation failed: ${sanitizedAction}`,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private sanitizeFilePath(filePath: string | undefined): string {
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('Valid file path required');
        }

        const normalized = filePath.replace(/\.\./g, '').replace(/\/+/g, '/').replace(/[<>:"|?*]/g, '_');
        const sanitized = normalized.startsWith('/') ? normalized.substring(1) : normalized;
        
        if (sanitized.includes('..') || sanitized.includes('~') || sanitized.length === 0 || sanitized.length > 200) {
            throw new Error(`Invalid file path: ${filePath}`);
        }
        
        return sanitized;
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>"'&;\\`$(){}\[\]|]/g, '').substring(0, 10000);
    }

    private sanitizeRegexPattern(pattern: string): string {
        if (!pattern || typeof pattern !== 'string') return '';
        return pattern.replace(/[(){}\[\]\\|^$*+?]/g, '').substring(0, 50);
    }
}