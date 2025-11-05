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
        const result = await this.fileSystemTool.executeCommand('git init', workspacePath);
        return result.stdout;
    }

    async add(files: string[], workspacePath: string): Promise<string> {
        const fileList = files.length > 0 ? files.join(' ') : '.';
        const result = await this.fileSystemTool.executeCommand(`git add ${fileList}`, workspacePath);
        return result.stdout;
    }

    async commit(message: string, workspacePath: string): Promise<string> {
        const result = await this.fileSystemTool.executeCommand(`git commit -m "${message}"`, workspacePath);
        return result.stdout;
    }

    async status(workspacePath: string): Promise<string> {
        const result = await this.fileSystemTool.executeCommand('git status --porcelain', workspacePath);
        return result.stdout;
    }

    async createBranch(branchName: string, workspacePath: string): Promise<string> {
        const result = await this.fileSystemTool.executeCommand(`git checkout -b ${branchName}`, workspacePath);
        return result.stdout;
    }

    async switchBranch(branchName: string, workspacePath: string): Promise<string> {
        const result = await this.fileSystemTool.executeCommand(`git checkout ${branchName}`, workspacePath);
        return result.stdout;
    }

    async merge(branchName: string, workspacePath: string): Promise<string> {
        const result = await this.fileSystemTool.executeCommand(`git merge ${branchName}`, workspacePath);
        return result.stdout;
    }

    async diff(workspacePath: string): Promise<string> {
        const result = await this.fileSystemTool.executeCommand('git diff', workspacePath);
        return result.stdout;
    }

    async log(workspacePath: string, limit = 10): Promise<string> {
        const result = await this.fileSystemTool.executeCommand(`git log --oneline -${limit}`, workspacePath);
        return result.stdout;
    }
}