import * as path from 'path';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { BuildTool } from '../tools/BuildTool.js';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';
import { TimeoutManager } from '../utils/TimeoutManager.js';
import { normalizePathForWorkspace, resolveTargetFiles } from './resolveTargetFiles.js';
import { summarizeFileChange } from '../utils/changeSummary.js';

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
        const enriched = {
            ...context,
            description: step.action || context.description,
        };
        const action = (step.action || '').toLowerCase();

        if (
            step.action === 'generate_tests' ||
            (action.includes('generat') && (action.includes('test') || action.includes('spec')))
        ) {
            return await this.generateTests(enriched);
        }

        if (step.action === 'run_tests' || (action.includes('run') && action.includes('test'))) {
            return await this.runTests(enriched);
        }

        if (step.action === 'fix_tests' || (action.includes('fix') && action.includes('test'))) {
            return await this.fixTests(enriched);
        }

        if (action.includes('coverage')) {
            const workspacePath = this.resolveWorkspacePath(enriched);
            return await this.analyzeCoverage(workspacePath);
        }

        // Default: treat unknown test steps as generate when a source file is named
        const targets = this.resolveTestTargetFiles(enriched);
        if (targets.length > 0) {
            return await this.generateTests(enriched);
        }

        return await this.genericTestAction(step.action, enriched);
    }

    private resolveTestTargetFiles(context: any): string[] {
        const description = String(context.description || context.params?.description || '');
        return resolveTargetFiles(description, {
            workspacePath: context.workspacePath,
            files: context.files,
            relevantChunks: context.relevantChunks,
        });
    }

    private resolveWorkspacePath(context: any): string {
        return path.resolve(context?.workspacePath || process.cwd());
    }

    private async generateTests(context: any): Promise<any> {
        const workspacePath = this.resolveWorkspacePath(context);
        this.fileSystemTool.allowWorkspace(workspacePath);

        const files = this.resolveTestTargetFiles(context).slice(0, 5);
        if (files.length === 0) {
            return {
                success: false,
                filesModified: [],
                description: 'No source files found to test — include a path like src/tools/FileSystemTool.ts',
                error: 'No target files',
            };
        }

        const language = this.validateLanguage(context?.language || 'typescript');
        const testFiles: string[] = [];
        const failedFiles: string[] = [];
        const proposedChanges: Array<{
            filePath: string;
            original: string;
            modified: string;
            status: 'added' | 'modified' | 'deleted';
            changeSummary?: string;
            additions?: Array<{ line: number; text: string }>;
        }> = [];

        for (const file of files) {
            try {
                const sanitizedFile = this.sanitizeFilePath(file, context);
                const content = await this.fileSystemTool.readFile(sanitizedFile);
                if (content.length > 50000) {
                    failedFiles.push(file);
                    continue;
                }

                const testContent = await this.generateTestForFile(content, sanitizedFile, language);
                const testFileName = this.getTestFileName(sanitizedFile, language);
                let original = '';
                try {
                    original = await this.fileSystemTool.readFile(testFileName);
                } catch {
                    original = '';
                }

                if (context.previewChanges) {
                    const summary = summarizeFileChange(
                        testFileName,
                        original,
                        testContent,
                        workspacePath
                    );
                    proposedChanges.push({
                        filePath: testFileName,
                        original,
                        modified: testContent,
                        status: original ? 'modified' : 'added',
                        changeSummary: summary.summary,
                        additions: summary.additions,
                    });
                    continue;
                }

                await this.fileSystemTool.writeFile(testFileName, testContent);
                testFiles.push(testFileName);
            } catch (error) {
                this.logger.error(`Failed to generate test for ${file}:`, error);
                failedFiles.push(file);
            }
        }

        if (proposedChanges.length > 0) {
            return {
                success: failedFiles.length === 0,
                filesModified: [],
                proposedChanges,
                failedFiles,
                description: `Preview: ${proposedChanges.length} test file(s) for ${files.length} source file(s)`,
            };
        }

        return {
            filesModified: testFiles,
            failedFiles,
            description: `Generated ${testFiles.length} test file(s), ${failedFiles.length} failed`,
            success: testFiles.length > 0 && failedFiles.length === 0,
        };
    }

    private async runTests(context: any): Promise<any> {
        const workspacePath = this.resolveWorkspacePath(context);

        try {
            const testOutput = await this.buildTool.runTests(workspacePath);
            const results = this.parseTestResults(testOutput);

            return {
                description: `Tests completed: ${results.passed} passed, ${results.failed} failed`,
                testOutput: this.sanitizeLogOutput(testOutput),
                results,
                coverage: results.coverage,
                framework: results.framework,
                success: results.failed === 0,
            };
        } catch (error) {
            this.logger.error('Test execution failed:', error);
            return {
                description: 'Test execution failed',
                testOutput: this.sanitizeLogOutput(error instanceof Error ? error.message : 'Unknown error'),
                results: { passed: 0, failed: 1, total: 1, framework: 'unknown' },
                success: false,
            };
        }
    }

    async analyzeCoverage(workspacePath: string): Promise<any> {
        try {
            const coverageOutput = await this.buildTool.runTests(workspacePath);
            const coverage = this.parseCoverageReport(coverageOutput);

            return {
                coverage,
                description: `Coverage analysis: ${coverage.overall}% overall`,
                success: true,
            };
        } catch (error) {
            return {
                coverage: null,
                description: 'Coverage analysis failed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    private parseCoverageReport(output: string): any {
        const coverage = { overall: 0, files: [] as string[] };

        const jestCoverage = output.match(/All files\s+\|\s+(\d+(?:\.\d+)?)/);
        if (jestCoverage) {
            coverage.overall = parseFloat(jestCoverage[1]);
        }

        const pytestCoverage = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/);
        if (pytestCoverage) {
            coverage.overall = parseInt(pytestCoverage[1], 10);
        }

        return coverage;
    }

    private async fixTests(context: any): Promise<any> {
        const workspacePath = this.resolveWorkspacePath(context);
        this.fileSystemTool.allowWorkspace(workspacePath);

        const files = this.resolveTestTargetFiles(context).slice(0, 10);
        const fixedFiles: string[] = [];
        const failedFiles: string[] = [];

        for (const file of files) {
            try {
                const sanitizedFile = this.sanitizeFilePath(file, context);
                const content = await this.fileSystemTool.readFile(sanitizedFile);
                if (content.length > 30000) {
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
            success: fixedFiles.length > 0 && failedFiles.length === 0,
        };
    }

    private async generateTestForFile(content: string, filePath: string, language: string): Promise<string> {
        const framework = this.detectTestFramework(language);
        const sanitizedContent = content.substring(0, 8000);

        const prompt = `You are writing tests for an existing source file.

Source file:
${filePath}

Language:
${language}

Test framework:
${framework}

Source code:
${sanitizedContent}

Output contract:
- Return only valid ${language} test code for a new test file.
- Do not include markdown fences, explanations, or summaries.
- Cover the main public behavior, one edge case, and one failure path when applicable.
- Use deterministic assertions.
- Import the module under test using a relative path from the test file location.
- Do not invent unavailable packages beyond the named framework.`;

        try {
            const result = await TimeoutManager.withFallback(
                this.ollamaProvider.generateText({
                    prompt,
                    model: this.ollamaProvider.getModel(undefined, 'code'),
                }),
                `// Generated test template for ${language}\n// TODO: Implement actual tests\n`,
                120000
            );
            return this.stripGeneratedCode(result);
        } catch (error) {
            this.logger.error(`Failed to generate test content for ${filePath}:`, error);
            throw error;
        }
    }

    private detectTestFramework(language: string): string {
        const frameworks = this.testFrameworks[language as keyof typeof this.testFrameworks];
        return frameworks ? frameworks[0] : 'jest';
    }

    private async fixTestFile(content: string, filePath: string): Promise<string> {
        const sanitizedContent = content.substring(0, 8000);
        const language = this.detectLanguageFromPath(filePath);
        const prompt = `You are fixing an existing test file.

File:
${filePath}

Language:
${language}

Current test code:
${sanitizedContent}

Output contract:
- Return only the complete corrected test file.
- Do not include markdown fences, explanations, or diff markers.
- Preserve test intent and naming where possible.`;

        try {
            const result = await TimeoutManager.withFallback(
                this.ollamaProvider.generateText({
                    prompt,
                    model: this.ollamaProvider.getModel(undefined, 'code'),
                }),
                content,
                60000
            );
            return this.stripGeneratedCode(result);
        } catch (error) {
            this.logger.error(`Failed to fix test file ${filePath}:`, error);
            return content;
        }
    }

    private detectLanguageFromPath(filePath: string): string {
        if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
        if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
        if (filePath.endsWith('.py')) return 'python';
        if (filePath.endsWith('.java')) return 'java';
        if (filePath.endsWith('.go')) return 'go';
        if (filePath.endsWith('.rs')) return 'rust';
        return 'typescript';
    }

    private getTestFileName(originalFile: string, language: string): string {
        const dir = path.dirname(originalFile);
        const fileName = path.basename(originalFile);
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
        const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '.ts';

        switch (language) {
            case 'javascript':
            case 'typescript':
                return path.join(dir, `${baseName}.test${extension}`);
            case 'python':
                return path.join(dir, `test_${baseName}.py`);
            case 'java':
                return path.join(dir, `${baseName}Test.java`);
            case 'go':
                return path.join(dir, `${baseName}_test.go`);
            case 'rust':
                return path.join(dir, `${baseName}_test.rs`);
            default:
                return path.join(dir, `${baseName}.test${extension}`);
        }
    }

    private parseTestResults(output: string): any {
        const results = {
            passed: 0,
            failed: 0,
            total: 0,
            framework: 'unknown',
            coverage: null as number | null,
        };

        const jestMatch = output.match(/(\d+) passing|Tests:\s+(\d+) passed/);
        if (jestMatch) {
            results.framework = 'jest';
            results.passed = parseInt(jestMatch[1] || jestMatch[2], 10);
        }

        const jestFailMatch = output.match(/(\d+) failing/);
        if (jestFailMatch) {
            results.failed = parseInt(jestFailMatch[1], 10);
        }

        const pytestMatch = output.match(/(\d+) passed/);
        if (pytestMatch) {
            results.framework = 'pytest';
            results.passed = parseInt(pytestMatch[1], 10);
        }

        const pytestFailMatch = output.match(/(\d+) failed/);
        if (pytestFailMatch) {
            results.failed = parseInt(pytestFailMatch[1], 10);
        }

        results.total = results.passed + results.failed;
        return results;
    }

    private sanitizeFilePath(filePath: string, context?: Record<string, unknown>): string {
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('Valid file path required');
        }
        const cwd = path.resolve((context?.workspacePath as string) || process.cwd());
        const resolved = normalizePathForWorkspace(cwd, filePath);
        if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
            throw new Error(`Path traversal detected: ${filePath}`);
        }
        return resolved;
    }

    private stripGeneratedCode(input: string): string {
        let trimmed = input.trim();
        const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
        if (fenceMatch) {
            trimmed = fenceMatch[1];
        } else {
            trimmed = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
    }

    private sanitizeLogOutput(output: string): string {
        return output.substring(0, 10000).replace(/[\r\n\t]/g, ' ');
    }

    private validateLanguage(language: string): string {
        const validLanguages = ['javascript', 'typescript', 'python', 'java', 'go', 'rust'];
        const lower = (language || 'typescript').toLowerCase();
        return validLanguages.includes(lower) ? lower : 'typescript';
    }

    private async genericTestAction(action: string, context: any): Promise<any> {
        this.logger.warn(`Unhandled test action, attempting generate: ${action}`);
        const targets = this.resolveTestTargetFiles(context);
        if (targets.length > 0) {
            return await this.generateTests(context);
        }
        return {
            description: `Test action '${action}' could not be mapped to a file`,
            success: false,
            error: 'No target files for test generation',
        };
    }
}
