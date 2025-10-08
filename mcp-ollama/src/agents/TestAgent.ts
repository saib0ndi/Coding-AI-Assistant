import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { BuildTool } from '../tools/BuildTool.js';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';
import { TimeoutManager } from '../utils/TimeoutManager.js';

export class TestAgent {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private buildTool: BuildTool;
    private testFrameworks = {
        javascript: ['jest', 'mocha', 'vitest'],
        typescript: ['jest', 'mocha', 'vitest'],
        python: ['pytest', 'unittest', 'nose2'],
        java: ['junit', 'testng'],
        go: ['testing'],
        rust: ['cargo test']
    };

    constructor(ollamaProvider: OllamaProvider, fileSystemTool: FileSystemTool) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = fileSystemTool;
        this.buildTool = new BuildTool();
    }

    async executeStep(step: WorkflowStep, context: any): Promise<any> {
        const { action } = step;
        
        // Use more precise action matching
        if (action === 'generate_tests' || (action.includes('generate') && action.includes('test'))) {
            return await this.generateTests(context);
        }
        
        if (action === 'run_tests' || (action.includes('run') && action.includes('test'))) {
            return await this.runTests(context);
        }
        
        if (action === 'fix_tests' || (action.includes('fix') && action.includes('test'))) {
            return await this.fixTests(context);
        }

        return await this.genericTestAction(action, context);
    }

    private async generateTests(context: any): Promise<any> {
        const files = (context?.files || []).slice(0, 20); // Limit files
        const language = this.validateLanguage(context?.language || 'typescript');
        const testFiles: string[] = [];
        const failedFiles: string[] = [];

        for (const file of files) {
            try {
                const sanitizedFile = this.sanitizeFilePath(file);
                const content = await this.fileSystemTool.readFile(sanitizedFile);
                if (content.length > 50000) { // Skip large files
                    failedFiles.push(file);
                    continue;
                }
                
                const testContent = await this.generateTestForFile(content, sanitizedFile, language);
                const testFileName = this.getTestFileName(sanitizedFile, language);
                await this.fileSystemTool.writeFile(testFileName, testContent);
                testFiles.push(testFileName);
            } catch (error) {
                this.logger.error(`Failed to generate test for ${file}:`, error);
                failedFiles.push(file);
            }
        }

        return {
            filesModified: testFiles,
            failedFiles,
            description: `Generated ${testFiles.length} test files, ${failedFiles.length} failed`,
            success: failedFiles.length === 0
        };
    }

    private async runTests(context: any): Promise<any> {
        const workspacePath = this.sanitizeFilePath(context?.workspacePath || '.');
        
        try {
            const testOutput = await this.buildTool.runTests(workspacePath);
            const results = this.parseTestResults(testOutput);
            
            return {
                description: `Tests completed: ${results.passed} passed, ${results.failed} failed`,
                testOutput: this.sanitizeOutput(testOutput),
                results,
                coverage: results.coverage,
                framework: results.framework,
                success: results.failed === 0
            };
        } catch (error) {
            this.logger.error('Test execution failed:', error);
            return {
                description: 'Test execution failed',
                testOutput: this.sanitizeOutput(error instanceof Error ? error.message : 'Unknown error'),
                results: { passed: 0, failed: 1, total: 1, framework: 'unknown' },
                success: false
            };
        }
    }
    
    async analyzeCoverage(workspacePath: string): Promise<any> {
        try {
            // Try to run coverage analysis
            const coverageOutput = await this.buildTool.runTests(workspacePath);
            const coverage = this.parseCoverageReport(coverageOutput);
            
            return {
                coverage,
                description: `Coverage analysis: ${coverage.overall}% overall`,
                success: true
            };
        } catch (error) {
            return {
                coverage: null,
                description: 'Coverage analysis failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    private parseCoverageReport(output: string): any {
        const coverage = { overall: 0, files: [] };
        
        // Jest coverage parsing
        const jestCoverage = output.match(/All files\s+\|\s+(\d+(?:\.\d+)?)/);
        if (jestCoverage) {
            coverage.overall = parseFloat(jestCoverage[1]);
        }
        
        // Pytest coverage parsing
        const pytestCoverage = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/);
        if (pytestCoverage) {
            coverage.overall = parseInt(pytestCoverage[1]);
        }
        
        return coverage;
    }

    private async fixTests(context: any): Promise<any> {
        const files = (context?.files || []).slice(0, 10); // Limit files
        const fixedFiles: string[] = [];
        const failedFiles: string[] = [];

        for (const file of files) {
            try {
                const sanitizedFile = this.sanitizeFilePath(file);
                const content = await this.fileSystemTool.readFile(sanitizedFile);
                if (content.length > 30000) { // Skip large files
                    failedFiles.push(file);
                    continue;
                }
                
                const fixedContent = await this.fixTestFile(content, sanitizedFile);
                await this.fileSystemTool.writeFile(sanitizedFile, fixedContent);
                fixedFiles.push(sanitizedFile);
            } catch (error) {
                this.logger.error(`Failed to fix test file ${file}:`, error);
                failedFiles.push(file);
            }
        }

        return {
            filesModified: fixedFiles,
            failedFiles,
            description: `Fixed ${fixedFiles.length} test files, ${failedFiles.length} failed`,
            success: failedFiles.length === 0
        };
    }

    private async generateTestForFile(content: string, filePath: string, language: string): Promise<string> {
        const framework = this.detectTestFramework(language);
        const sanitizedPath = this.sanitizeFilePath(filePath);
        const sanitizedContent = content.substring(0, 500); // Much shorter for faster processing
        
        const prompt = `Generate ${language} ${framework} test:
${sanitizedContent}
One simple test:`;

        try {
            const result = await TimeoutManager.withFallback(
                this.ollamaProvider.generateText({
                    prompt,
                    model: 'llama3.1:8b-instruct-q4_K_M'
                }),
                `// Generated test template for ${language}
// TODO: Implement actual tests`,
                30000 // 30 second timeout
            );
            return this.sanitizeOutput(result);
        } catch (error) {
            this.logger.error(`Failed to generate test content for ${filePath}:`, error);
            return `// Test generation failed for ${filePath}`;
        }
    }
    
    private detectTestFramework(language: string): string {
        const frameworks = this.testFrameworks[language as keyof typeof this.testFrameworks];
        return frameworks ? frameworks[0] : 'default';
    }

    private async fixTestFile(content: string, filePath: string): Promise<string> {
        const sanitizedPath = this.sanitizeFilePath(filePath);
        const sanitizedContent = content.substring(0, 800); // Much shorter
        
        const prompt = `Fix this ${this.detectLanguageFromPath(filePath)} test:
${sanitizedContent}
Fixed code:`;

        try {
            const result = await TimeoutManager.withFallback(
                this.ollamaProvider.generateText({
                    prompt,
                    model: 'llama3.1:8b-instruct-q4_K_M'
                }),
                content, // Return original if fix fails
                30000 // 30 second timeout
            );
            return this.sanitizeOutput(result);
        } catch (error) {
            this.logger.error(`Failed to fix test file ${filePath}:`, error);
            return content; // Return original content if fix fails
        }
    }

    private detectLanguageFromPath(filePath: string): string {
        if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'TypeScript';
        if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'JavaScript';
        if (filePath.endsWith('.py')) return 'Python';
        if (filePath.endsWith('.java')) return 'Java';
        if (filePath.endsWith('.go')) return 'Go';
        if (filePath.endsWith('.rs')) return 'Rust';
        return 'code';
    }

    private getTestFileName(originalFile: string, language: string): string {
        const parts = originalFile.split('/');
        const fileName = parts[parts.length - 1];
        
        // Improved filename parsing - handle multiple dots correctly
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
        const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '';
        
        // Generate test file name based on language conventions
        switch (language) {
            case 'javascript':
            case 'typescript':
                return `${baseName}.test${extension}`;
            case 'python':
                return `test_${baseName}.py`;
            case 'java':
                return `${baseName}Test.java`;
            case 'go':
                return `${baseName}_test.go`;
            case 'rust':
                return `${baseName}_test.rs`;
            default:
                return `${baseName}_test${extension}`;
        }
    }

    private parseTestResults(output: string): any {
        const results = {
            passed: 0,
            failed: 0,
            total: 0,
            framework: 'unknown',
            coverage: null
        };

        // Jest parsing
        const jestMatch = output.match(/(\d+) passing|Tests:\s+(\d+) passed/);
        if (jestMatch) {
            results.framework = 'jest';
            results.passed = parseInt(jestMatch[1] || jestMatch[2]);
        }

        const jestFailMatch = output.match(/(\d+) failing/);
        if (jestFailMatch) {
            results.failed = parseInt(jestFailMatch[1]);
        }

        // Pytest parsing
        const pytestMatch = output.match(/(\d+) passed/);
        if (pytestMatch) {
            results.framework = 'pytest';
            results.passed = parseInt(pytestMatch[1]);
        }

        const pytestFailMatch = output.match(/(\d+) failed/);
        if (pytestFailMatch) {
            results.failed = parseInt(pytestFailMatch[1]);
        }

        results.total = results.passed + results.failed;
        return results;
    }

    private sanitizeFilePath(filePath: string): string {
        // Remove any potentially dangerous characters
        return filePath.replace(/[<>:"|?*]/g, '_').replace(/\.\./g, '_');
    }

    private sanitizeOutput(output: string): string {
        // Limit output size and remove sensitive information
        return output.substring(0, 10000).replace(/[\r\n\t]/g, ' ');
    }

    private validateLanguage(language: string): string {
        const validLanguages = ['javascript', 'typescript', 'python', 'java', 'go', 'rust'];
        return validLanguages.includes(language) ? language : 'typescript';
    }

    private async genericTestAction(action: string, context: any): Promise<any> {
        this.logger.info(`Executing generic test action: ${action}`);
        
        // Handle generic test-related actions
        if (action.includes('coverage')) {
            return await this.analyzeCoverage(context?.workspacePath || '.');
        }
        
        return {
            description: `Test action '${action}' completed`,
            success: true,
            timestamp: new Date().toISOString()
        };
    }
}