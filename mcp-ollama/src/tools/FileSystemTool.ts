import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils/Logger.js';

const execAsync = promisify(exec);

export class FileSystemTool {
    private logger: Logger;

    constructor() {
        this.logger = new Logger();
    }

    async readFile(filePath: string): Promise<string> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            this.logger.error(`Failed to read file: ${filePath}`, error);
            throw error;
        }
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            this.logger.info(`File written: ${filePath}`);
        } catch (error) {
            this.logger.error(`Failed to write file: ${filePath}`, error);
            throw error;
        }
    }

    async createDirectory(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
            this.logger.info(`Directory created: ${dirPath}`);
        } catch (error) {
            this.logger.error(`Failed to create directory: ${dirPath}`, error);
            throw error;
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
            this.logger.info(`File deleted: ${filePath}`);
        } catch (error) {
            this.logger.error(`Failed to delete file: ${filePath}`, error);
            throw error;
        }
    }

    async listFiles(dirPath: string): Promise<string[]> {
        try {
            const files = await fs.readdir(dirPath);
            return files;
        } catch (error) {
            this.logger.error(`Failed to list files in: ${dirPath}`, error);
            throw error;
        }
    }

    async executeCommand(command: string, cwd?: string): Promise<string> {
        try {
            const { stdout, stderr } = await execAsync(command, { cwd });
            if (stderr) {
                this.logger.warn(`Command stderr: ${stderr}`);
            }
            return stdout;
        } catch (error) {
            this.logger.error(`Command failed: ${command}`, error);
            throw error;
        }
    }

    async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async getFileStats(filePath: string): Promise<any> {
        try {
            return await fs.stat(filePath);
        } catch (error) {
            this.logger.error(`Failed to get file stats: ${filePath}`, error);
            throw error;
        }
    }
}