import { FileSystemTool } from './FileSystemTool.js';
import { Logger } from '../utils/Logger.js';

export class GitTool {
    private logger: Logger;
    private fileSystemTool: FileSystemTool;

    constructor() {
        this.logger = new Logger();
        this.fileSystemTool = new FileSystemTool();
    }

    async init(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('git init', workspacePath);
    }

    async add(files: string[], workspacePath: string): Promise<string> {
        const fileList = files.length > 0 ? files.join(' ') : '.';
        return await this.fileSystemTool.executeCommand(`git add ${fileList}`, workspacePath);
    }

    async commit(message: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`git commit -m "${message}"`, workspacePath);
    }

    async status(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('git status --porcelain', workspacePath);
    }

    async createBranch(branchName: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`git checkout -b ${branchName}`, workspacePath);
    }

    async switchBranch(branchName: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`git checkout ${branchName}`, workspacePath);
    }

    async merge(branchName: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`git merge ${branchName}`, workspacePath);
    }

    async diff(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('git diff', workspacePath);
    }

    async log(workspacePath: string, limit = 10): Promise<string> {
        return await this.fileSystemTool.executeCommand(`git log --oneline -${limit}`, workspacePath);
    }
}