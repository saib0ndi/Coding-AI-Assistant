import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { GitTool } from '../tools/GitTool.js';
import { BuildTool } from '../tools/BuildTool.js';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';

export class ProjectAgent {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private gitTool: GitTool;
    private buildTool: BuildTool;

    constructor(ollamaProvider: OllamaProvider, fileSystemTool: FileSystemTool) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = fileSystemTool;
        this.gitTool = new GitTool();
        this.buildTool = new BuildTool();
    }

    async executeStep(step: WorkflowStep, context: any): Promise<any> {
        const { action } = step;
        
        if (action.includes('analyze')) {
            return await this.analyzeProject(context);
        }
        
        if (action.includes('setup') || action.includes('init')) {
            return await this.setupProject(action, context);
        }
        
        if (action.includes('build') || action.includes('compile')) {
            return await this.buildProject(context);
        }
        
        if (action.includes('test')) {
            return await this.runTests(context);
        }

        if (action.includes('commit') || action.includes('git')) {
            return await this.gitOperations(action, context);
        }

        return await this.genericProjectAction(action, context);
    }

    private async analyzeProject(context: any): Promise<any> {
        const workspacePath = this.sanitizePath(context?.workspacePath || '.');
        
        try {
            const files = await this.fileSystemTool.listFiles(workspacePath);
            const buildSystem = await this.buildTool.detectBuildSystem(workspacePath);
            const gitStatus = await this.safeGitOperation(() => this.gitTool.status(workspacePath)) || 'Not a git repository';
            
            const analysis = {
                fileCount: Math.min(files.length, 10000),
                buildSystem: this.sanitizeInput(buildSystem),
                gitStatus: this.sanitizeInput(gitStatus),
                hasTests: files.some(f => f.includes('test') || f.includes('spec')),
                hasConfig: files.some(f => f.includes('config') || f.includes('.json')),
                languages: this.detectLanguages(files)
            };

            return {
                analysis,
                description: `Analyzed project: ${analysis.fileCount} files, ${analysis.buildSystem} build system`
            };
        } catch (error) {
            this.logger.error('Project analysis failed:', error);
            return {
                analysis: null,
                description: 'Project analysis failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async setupProject(action: string, context: any): Promise<any> {
        const workspacePath = this.sanitizePath(context?.workspacePath || '.');
        const language = this.validateLanguage(context?.language || 'typescript');
        const results: string[] = [];

        try {
            // Initialize git if not exists
            const gitResult = await this.safeGitOperation(() => this.gitTool.init(workspacePath));
            if (gitResult) {
                results.push('Git repository initialized');
            } else {
                results.push('Git already initialized or failed');
            }

            // Create basic project structure
            if (language === 'typescript' || language === 'javascript') {
                await this.setupNodeProject(workspacePath, language);
                results.push('Node.js project structure created');
            } else if (language === 'python') {
                await this.setupPythonProject(workspacePath);
                results.push('Python project structure created');
            }

            return {
                filesModified: [`${workspacePath}/package.json`, `${workspacePath}/src/index.${language === 'typescript' ? 'ts' : 'js'}`],
                description: `Project setup completed: ${results.join(', ')}`
            };
        } catch (error) {
            return {
                filesModified: [],
                description: 'Project setup failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async buildProject(context: any): Promise<any> {
        const workspacePath = this.sanitizePath(context?.workspacePath || '.');
        
        try {
            await this.buildTool.installDependencies(workspacePath);
            const buildResult = await this.buildTool.npmBuild(workspacePath);
            
            return {
                description: 'Project built successfully',
                buildOutput: this.sanitizeInput(buildResult),
                success: true
            };
        } catch (error) {
            this.logger.error('Build failed:', error);
            return {
                description: 'Build failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async runTests(context: any): Promise<any> {
        const workspacePath = context?.workspacePath || '.';
        
        try {
            const testResult = await this.buildTool.runTests(workspacePath);
            
            return {
                description: 'Tests completed',
                testOutput: testResult,
                passed: !testResult.includes('failed') && !testResult.includes('error')
            };
        } catch (error) {
            return {
                description: 'Tests failed',
                testOutput: error instanceof Error ? error.message : 'Unknown error',
                passed: false
            };
        }
    }

    private async gitOperations(action: string, context: any): Promise<any> {
        const workspacePath = this.sanitizePath(context?.workspacePath || '.');
        const files = (context?.files || []).slice(0, 50).map((f: string) => this.sanitizePath(f));
        
        try {
            if (action.includes('commit')) {
                const addResult = await this.safeGitOperation(() => this.gitTool.add(files, workspacePath));
                if (!addResult) throw new Error('Failed to add files');
                
                const message = this.sanitizeCommitMessage(context?.commitMessage || 'Automated commit by AI agent');
                const result = await this.safeGitOperation(() => this.gitTool.commit(message, workspacePath));
                
                return {
                    description: `Committed ${files.length} files`,
                    gitOutput: this.sanitizeInput(result || 'Commit completed')
                };
            }
            
            if (action.includes('branch')) {
                const branchName = this.sanitizeBranchName(context?.branchName || 'feature/ai-changes');
                const result = await this.safeGitOperation(() => this.gitTool.createBranch(branchName, workspacePath));
                
                return {
                    description: `Created branch: ${branchName}`,
                    gitOutput: this.sanitizeInput(result || 'Branch created')
                };
            }

            return {
                description: 'Git operation completed',
                gitOutput: 'Unknown git action'
            };
        } catch (error) {
            return {
                description: 'Git operation failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async setupNodeProject(workspacePath: string, language: string): Promise<void> {
        const packageJson = {
            name: 'ai-generated-project',
            version: '1.0.0',
            main: language === 'typescript' ? 'dist/index.js' : 'src/index.js',
            scripts: {
                build: language === 'typescript' ? 'tsc' : 'echo "No build needed"',
                start: `node ${language === 'typescript' ? 'dist/index.js' : 'src/index.js'}`,
                test: 'jest'
            },
            devDependencies: language === 'typescript' ? {
                typescript: '^5.0.0',
                '@types/node': '^20.0.0',
                jest: '^29.0.0'
            } : {
                jest: '^29.0.0'
            }
        };

        await this.fileSystemTool.writeFile(
            `${workspacePath}/package.json`, 
            JSON.stringify(packageJson, null, 2)
        );

        await this.fileSystemTool.createDirectory(`${workspacePath}/src`);
        
        const indexContent = language === 'typescript' 
            ? 'console.log("Hello from TypeScript!");'
            : 'console.log("Hello from JavaScript!");';
            
        const extension = language === 'typescript' ? 'ts' : 'js';
        await this.fileSystemTool.writeFile(
            `${workspacePath}/src/index.${extension}`, 
            indexContent
        );

        if (language === 'typescript') {
            const tsConfig = {
                compilerOptions: {
                    target: 'ES2020',
                    module: 'commonjs',
                    outDir: './dist',
                    rootDir: './src',
                    strict: true
                }
            };
            
            await this.fileSystemTool.writeFile(
                `${workspacePath}/tsconfig.json`,
                JSON.stringify(tsConfig, null, 2)
            );
        }
    }

    private async setupPythonProject(workspacePath: string): Promise<void> {
        await this.fileSystemTool.writeFile(
            `${workspacePath}/requirements.txt`,
            'pytest>=7.0.0\n'
        );

        await this.fileSystemTool.writeFile(
            `${workspacePath}/main.py`,
            'print("Hello from Python!")\n'
        );

        await this.fileSystemTool.createDirectory(`${workspacePath}/tests`);
        await this.fileSystemTool.writeFile(
            `${workspacePath}/tests/test_main.py`,
            'def test_example():\n    assert True\n'
        );
    }

    private detectLanguages(files: string[]): string[] {
        const languages = new Set<string>();
        
        files.forEach(file => {
            if (file.endsWith('.ts')) languages.add('typescript');
            if (file.endsWith('.js')) languages.add('javascript');
            if (file.endsWith('.py')) languages.add('python');
            if (file.endsWith('.java')) languages.add('java');
            if (file.endsWith('.go')) languages.add('go');
            if (file.endsWith('.rs')) languages.add('rust');
        });
        
        return Array.from(languages);
    }

    private async genericProjectAction(action: string, context: any): Promise<any> {
        const sanitizedAction = this.sanitizeInput(action);
        const prompt = `Execute project action: ${sanitizedAction}

Provide step-by-step instructions for this project-level action.`;

        try {
            const instructions = await this.ollamaProvider.generateText({
                prompt,
                model: 'deepseek-r1:70b'
            });

            return {
                instructions: this.sanitizeInput(instructions),
                description: `Generated instructions for: ${sanitizedAction}`
            };
        } catch (error) {
            return {
                instructions: 'Failed to generate instructions',
                description: `Error for action: ${sanitizedAction}`,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private sanitizePath(path: string): string {
        if (!path || typeof path !== 'string') throw new Error('Valid path required');
        const normalized = path.replace(/\.\./g, '').replace(/\/+/g, '/').replace(/^\//g, '').replace(/[<>:"|?*]/g, '_');
        if (normalized.includes('~') || normalized.length === 0 || normalized.length > 200) {
            throw new Error(`Invalid path: ${path}`);
        }
        return normalized;
    }

    private validateLanguage(language: string): string {
        if (!language || typeof language !== 'string') return 'typescript';
        const allowed = ['typescript', 'javascript', 'python', 'java', 'go', 'rust'];
        return allowed.includes(language.toLowerCase()) ? language.toLowerCase() : 'typescript';
    }

    private sanitizeCommitMessage(message: string): string {
        if (!message || typeof message !== 'string') return 'Automated commit';
        return message.replace(/[;&|`$(){}\[\]<>"'\\]/g, '').substring(0, 100);
    }

    private sanitizeBranchName(name: string): string {
        if (!name || typeof name !== 'string') return 'feature/ai-changes';
        return name.replace(/[^a-zA-Z0-9\-_\/]/g, '-').substring(0, 50);
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[<>"'&;\\`$(){}\[\]|]/g, '').substring(0, 500);
    }

    private async safeGitOperation<T>(operation: () => Promise<T>): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            this.logger.warn('Git operation failed:', error);
            return null;
        }
    }

    private async analyzeDependencies(workspacePath: string, files: string[]): Promise<any> {
        const deps: any = {};
        
        if (files.includes('package.json')) {
            try {
                const pkg = JSON.parse(await this.fileSystemTool.readFile(`${workspacePath}/package.json`));
                deps.npm = Object.keys({...pkg.dependencies, ...pkg.devDependencies}).length;
            } catch {}
        }
        
        if (files.includes('requirements.txt')) {
            try {
                const reqs = await this.fileSystemTool.readFile(`${workspacePath}/requirements.txt`);
                deps.python = reqs.split('\n').filter(l => l.trim()).length;
            } catch {}
        }
        
        return deps;
    }
}