import { FileSystemTool } from './FileSystemTool.js';
import { Logger } from '../utils/Logger.js';

export class BuildTool {
    private logger: Logger;
    private fileSystemTool: FileSystemTool;

    constructor() {
        this.logger = new Logger();
        this.fileSystemTool = new FileSystemTool();
    }

    async npmInstall(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('npm install', workspacePath);
    }

    async npmRun(script: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`npm run ${script}`, workspacePath);
    }

    async npmTest(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('npm test', workspacePath);
    }

    async npmBuild(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('npm run build', workspacePath);
    }

    async yarnInstall(workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand('yarn install', workspacePath);
    }

    async yarnRun(script: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`yarn ${script}`, workspacePath);
    }

    async pipInstall(requirements: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`pip install ${requirements}`, workspacePath);
    }

    async pythonRun(file: string, workspacePath: string): Promise<string> {
        return await this.fileSystemTool.executeCommand(`python ${file}`, workspacePath);
    }

    async detectBuildSystem(workspacePath: string): Promise<string> {
        const hasPackageJson = await this.fileSystemTool.fileExists(`${workspacePath}/package.json`);
        const hasYarnLock = await this.fileSystemTool.fileExists(`${workspacePath}/yarn.lock`);
        const hasRequirements = await this.fileSystemTool.fileExists(`${workspacePath}/requirements.txt`);
        const hasPomXml = await this.fileSystemTool.fileExists(`${workspacePath}/pom.xml`);

        if (hasPackageJson && hasYarnLock) return 'yarn';
        if (hasPackageJson) return 'npm';
        if (hasRequirements) return 'pip';
        if (hasPomXml) return 'maven';
        return 'unknown';
    }

    async installDependencies(workspacePath: string): Promise<string> {
        const buildSystem = await this.detectBuildSystem(workspacePath);
        
        switch (buildSystem) {
            case 'yarn': return await this.yarnInstall(workspacePath);
            case 'npm': return await this.npmInstall(workspacePath);
            case 'pip': return await this.pipInstall('-r requirements.txt', workspacePath);
            default: throw new Error(`Unsupported build system: ${buildSystem}`);
        }
    }

    async runTests(workspacePath: string): Promise<string> {
        const buildSystem = await this.detectBuildSystem(workspacePath);
        
        switch (buildSystem) {
            case 'yarn': return await this.yarnRun('test', workspacePath);
            case 'npm': return await this.npmTest(workspacePath);
            case 'pip': return await this.pythonRun('-m pytest', workspacePath);
            default: throw new Error(`Unsupported build system: ${buildSystem}`);
        }
    }
}