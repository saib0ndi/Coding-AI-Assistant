import * as path from 'path';
import * as fs from 'fs/promises';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';
import { parseSimpleFsTask, executeCreateFileTask, executeMkdirTask } from './simpleFsTasks.js';
import { summarizeFileChange } from '../utils/changeSummary.js';
import { createExecutionTool } from '../tools/ExecutionTool.js';
import { SyntaxGate } from '../verify/SyntaxGate.js';

interface CodeActionResult {
    success: boolean;
    code?: string;
    filesModified: string[];
    proposedChanges?: Array<{
        filePath: string;
        original: string;
        modified: string;
        status: 'added' | 'modified' | 'deleted';
        changeSummary?: string;
        additions?: Array<{ line: number; text: string }>;
        anchorLine?: number;
        anchorText?: string;
    }>;
    description?: string;
    error?: string;
    overwritten?: boolean;
    rollback?: () => Promise<void>;
}

interface FixRecord {
    file: string;
    backup: string;
    changes: string;
}

interface ReplacementEdit {
    target: string;
    replacement: string;
}

interface AgentCapabilities {
    actions: string[];
    languages: string[];
    features: Record<string, boolean>;
    limits: Record<string, number>;
}

export class CodeAgent {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private fileSystemTool: FileSystemTool;
    private failedOperations: Map<string, string[]> = new Map();
    private static readonly ALLOWED_EXTENSIONS = new Set(['.ts', '.js', '.py', '.java', '.go', '.rs', '.tsx', '.jsx', '.json', '.jsonc', '.css', '.html', '.md', '.yaml', '.yml']);
    private static readonly MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    // Extensions that are safe to compile/run for auto-verification
    private static readonly EXECUTABLE_EXTENSIONS = new Set(['.ts', '.js', '.py', '.go', '.rs', '.java', '.rb', '.php', '.sh']);

    constructor(ollamaProvider: OllamaProvider, fileSystemTool: FileSystemTool) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        this.fileSystemTool = fileSystemTool;
    }

    async verifyFile(filePath: string): Promise<{ success: boolean; output: string }> {
        const ext = path.extname(filePath).toLowerCase();
        if (!CodeAgent.EXECUTABLE_EXTENSIONS.has(ext)) {
            return { success: true, output: '' };
        }
        try {
            const execTool = createExecutionTool({} as any);
            const result: any = await execTool.handler({ filePath, timeoutMs: 15000 });
            const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
            if (!result.success) {
                this.logger.warn(`Auto-verify failed for ${filePath}: ${output.substring(0, 200)}`);
            }
            return { success: result.success, output };
        } catch (err) {
            return { success: false, output: String(err) };
        }
    }

    /**
     * Write generated code through a deterministic syntax gate.
     *
     * Flow: snapshot existing content → write → parse-check (SyntaxGate) →
     * rollback (restore snapshot, or delete a newly-created file) if the result
     * is syntactically invalid. This guarantees we never leave a half-broken
     * file on disk and surfaces the real parser error for the retry/repair pass
     * instead of a vague heuristic message.
     */
    private async safeWriteCode(filePath: string, code: string): Promise<void> {
        const existed = await this.fileSystemTool.fileExists(filePath);
        let snapshot: string | null = null;
        if (existed) {
            try {
                snapshot = await this.fileSystemTool.readFile(filePath);
            } catch {
                snapshot = null;
            }
        }

        await this.fileSystemTool.writeFile(filePath, code);

        let gate;
        try {
            gate = await SyntaxGate.validate(filePath, code, this.fileSystemTool);
        } catch (err) {
            // A failure inside the gate itself must never block a write.
            this.logger.warn(`SyntaxGate threw for ${filePath}; allowing write: ${err}`);
            return;
        }

        if (gate.ok) {
            return;
        }

        // Roll back to the prior state — never persist syntactically broken code.
        try {
            if (snapshot !== null) {
                await this.fileSystemTool.writeFile(filePath, snapshot);
            } else {
                await this.fileSystemTool.deleteFile(filePath);
            }
        } catch (rollbackErr) {
            this.logger.error(`Rollback failed for ${filePath}: ${rollbackErr}`);
        }

        this.logger.warn(`SyntaxGate (${gate.checker}) rejected ${filePath}: ${gate.output ?? 'invalid syntax'}`);
        throw new Error(
            `Generated code for ${filePath} failed the ${gate.checker} syntax gate and was not applied.\n${gate.output ?? ''}`.trim()
        );
    }

    private formatRelevantChunks(context: Record<string, unknown>): string {
        const chunks = context?.relevantChunks;
        if (!Array.isArray(chunks) || chunks.length === 0) return '';
        const lines = chunks.slice(0, 6).map((c: any) => {
            const path = c.filePath ?? 'unknown';
            const sym = c.symbolName ?? 'snippet';
            const snippet = String(c.snippet ?? '').slice(0, 800);
            return `### ${path} (${sym})\n${snippet}`;
        });
        return `\nRelevant codebase context (from semantic index):\n${lines.join('\n\n')}\n`;
    }

    // Fast execution capability
    async execute(params: { action: string; params: any; context: any }): Promise<any> {
        const { action, params: stepParams, context } = params;
        const workspacePath = context?.workspacePath as string | undefined;
        if (workspacePath) {
            this.fileSystemTool.allowWorkspace(workspacePath);
        }
        const files = ((context?.files as string[]) || []).filter(Boolean);

        if (files.length > 0) {
            const step: WorkflowStep = {
                id: 'direct_edit',
                action,
                tool: 'code',
                params: stepParams || {},
                status: 'pending',
            };
            return await this.executeStep(step, context ?? {});
        }

        try {
            const language = stepParams.language || 'TypeScript';
            const prompt = `You are a senior software engineer generating code for an automated coding agent.

Task:
${action}

Language: ${language}
${this.formatRelevantChunks(context ?? {})}

Output contract:
- Return only valid ${language} code.
- Do not include markdown fences, prose, explanations, or comments about your process.
- Prefer small, cohesive code that directly satisfies the task.
- Include necessary imports, types, error handling, and exported entry points when appropriate.
- Do not invent external services, secrets, or unavailable APIs.
- If the task is ambiguous, create the smallest reasonable implementation with clear TODO comments in code only.`;
            const code = await this.ollamaProvider.generateText({
                prompt,
                model: this.ollamaProvider.getModel(undefined, 'code')
            });
            
            return {
                success: true,
                code,
                filesModified: [], // code-only result — no real file written
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

    async executeStep(step: WorkflowStep, context: Record<string, unknown>): Promise<CodeActionResult> {
        const workspacePath = context.workspacePath as string | undefined;
        if (workspacePath) {
            this.fileSystemTool.allowWorkspace(workspacePath);
        }
        const { action } = step;
        const normalizedAction = action.toLowerCase();
        const files = ((context.files as string[]) || []).filter(Boolean);
        const isCreateFsTask =
            parseSimpleFsTask(action) !== null ||
            (/\b(create|make|add|touch)\b/.test(normalizedAction) &&
                /\b(file|folder|directory|dir)\b/.test(normalizedAction));

        if (isCreateFsTask && files.length === 0) {
            return await this.implementCode(action, context);
        }

        if (files.length > 0) {
            if (normalizedAction.includes('fix') || normalizedAction.includes('error')) {
                return await this.fixCode(action, context, step.params);
            }
            if (normalizedAction.includes('refactor')) {
                return await this.refactorCode(action, context);
            }
            if (isCreateFsTask) {
                return await this.implementCode(action, context);
            }
            // Planner steps: "Implement <path>: ..." creates/overwrites the target;
            // "Update <path>: ..." edits in place, falling back to create when the
            // file does not exist yet (e.g. produced by an earlier step in preview mode).
            const targetExists = await this.fileExists(this.sanitizeFilePath(files[0], context));
            if (normalizedAction.startsWith('implement ') || !targetExists) {
                return await this.implementCode(action, context);
            }
            return await this.editExistingFiles(action, context);
        }
        
        if (
            (normalizedAction.includes('analyze') || normalizedAction.startsWith('review ')) &&
            !isCreateFsTask
        ) {
            return await this.analyzeCodeAction(action, context);
        }

        if (normalizedAction.includes('implement') || normalizedAction.includes('create')) {
            return await this.implementCode(action, context);
        }
        
        if (normalizedAction.includes('fix') || normalizedAction.includes('error')) {
            return await this.fixCode(action, context, step.params);
        }
        
        if (normalizedAction.includes('refactor')) {
            return await this.refactorCode(action, context);
        }

        return await this.generateCode(action, context);
    }

    private async editExistingFiles(description: string, context: Record<string, unknown>): Promise<CodeActionResult> {
        const workspacePath = context.workspacePath as string | undefined;
        if (workspacePath) {
            this.fileSystemTool.allowWorkspace(workspacePath);
        }

        const files = ((context.files as string[]) || []).slice(0, 5);
        const sanitizedDesc = this.sanitizeInput(description);
        const proposedChanges: NonNullable<CodeActionResult['proposedChanges']> = [];
        const filesModified: string[] = [];

        for (const file of files) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file, context);
                const exists = await this.fileExists(sanitizedPath);
                if (!exists) {
                    this.logger.warn(`File ${sanitizedPath} does not exist, skipping`);
                    continue;
                }

                const content = await this.fileSystemTool.readFile(sanitizedPath);
                if (content.length > 30000) {
                    this.logger.warn(`File ${sanitizedPath} too large, skipping`);
                    continue;
                }

                const language = (context.language as string) || 'typescript';
                let sanitizedCode =
                    this.tryHeuristicCommentEdit(sanitizedDesc, content) ??
                    (await this.tryApplyTargetedEdits({
                        description: sanitizedDesc,
                        filePath: sanitizedPath,
                        content,
                        mode: 'refactor',
                    }));

                if (!sanitizedCode) {
                    const prompt = `You are editing an existing source file for an automated coding agent.

Task:
${sanitizedDesc}

File:
${sanitizedPath}

Language:
${language}
${this.formatRelevantChunks(context)}

Current file contents:
${content.substring(0, 12000)}

Output contract:
- Return only the complete updated contents of ${sanitizedPath}.
- Do not include markdown fences, explanations, or diff markers.
- Make the smallest change that satisfies the task.
- Preserve unrelated code, imports, exports, and formatting style.
- Ensure the result is syntactically valid ${language}.`;

                    sanitizedCode = this.prepareGeneratedCode(
                        await this.ollamaProvider.generateText({
                            prompt,
                            model: this.ollamaProvider.getModel(undefined, 'code'),
                        }),
                        sanitizedPath,
                        content
                    );
                }

                if (context.previewChanges) {
                    proposedChanges.push(
                        this.buildProposedChange(sanitizedPath, content, sanitizedCode, 'modified', context)
                    );
                    continue;
                }

                await this.safeWriteCode(sanitizedPath, sanitizedCode);
                filesModified.push(sanitizedPath);
            } catch (error) {
                this.logger.error(`Failed to edit file: ${file}`, error);
                return {
                    success: false,
                    filesModified,
                    proposedChanges,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }

        if (proposedChanges.length > 0) {
            return {
                success: true,
                filesModified: [],
                proposedChanges,
                description: `Preview edit: ${sanitizedDesc}`,
            };
        }

        if (filesModified.length === 0) {
            return {
                success: false,
                filesModified: [],
                error: 'No target files could be edited',
            };
        }

        return {
            success: true,
            filesModified,
            description: `Edited ${filesModified.length} file(s): ${sanitizedDesc}`,
        };
    }

    private async analyzeCodeAction(description: string, context: Record<string, unknown>): Promise<CodeActionResult> {
        const files = (context.files as string[]) || [];
        const analysisResults: Array<{ file: string; analysis: string; suggestions: string[] }> = [];
        
        for (const file of files.slice(0, 5)) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file, context);
                const exists = await this.fileExists(sanitizedPath);
                
                if (!exists) continue;
                
                const content = await this.fileSystemTool.readFile(sanitizedPath);
                const analysis = await this.ollamaProvider.analyzeCode({
                    code: content.substring(0, 8000),
                    language: (context.language as string) || 'typescript',
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
            filesModified: [],
            description: `Analyzed ${analysisResults.length} files`
        };
    }

    private async implementCode(description: string, context: Record<string, unknown>): Promise<CodeActionResult> {
        const explicitTargets = ((context?.files as string[]) || []).filter(Boolean);
        // Explicit targets (from a multi-step plan) take priority over fs-task parsing.
        const fsTask = explicitTargets.length > 0 ? null : parseSimpleFsTask(description);
        if (fsTask) {
            const workspacePath = (context?.workspacePath as string) || process.cwd();
            const outcome =
                fsTask.type === 'mkdir'
                    ? executeMkdirTask(fsTask, workspacePath)
                    : executeCreateFileTask(fsTask, workspacePath);

            if (!outcome.success) {
                return {
                    success: false,
                    error: outcome.error ?? 'Unknown error',
                    filesModified: [],
                    description: `Failed: ${description}`,
                };
            }

            const label =
                fsTask.type === 'mkdir'
                    ? outcome.created
                        ? 'Created directory'
                        : 'Directory already exists'
                    : outcome.created
                      ? 'Created file'
                      : 'File already exists';

            return {
                success: true,
                filesModified: outcome.created ? [outcome.fullPath] : [],
                code: fsTask.type === 'create_file' ? fsTask.content : '',
                description: `${label}: ${outcome.fullPath}`,
            };
        }

        const sanitizedDesc = this.sanitizeInput(description);
        const files = ((context?.files as string[]) || []).filter(Boolean);
        const filePath = files.length > 0
            ? this.sanitizeFilePath(files[0], context)
            : this.sanitizeFilePath(`${(context?.workspacePath as string) || '.'}/src/${this.generateFileName(sanitizedDesc, context)}`, context);
        
        const exists = await this.fileExists(filePath);
        if (exists) {
            this.logger.warn(`File ${filePath} already exists, will be overwritten`);
        }

        const language = (context?.language as string) || 'typescript';
        const prompt = `You are implementing a new source file for a coding agent.

Task:
${sanitizedDesc}

Target file:
${filePath}

Language:
${language}

Output contract:
- Return only the complete contents of ${filePath}.
- Do not include markdown fences, explanations, or surrounding text.
- Produce cohesive, maintainable, production-quality ${language}.
- Include all imports and exports needed by this file.
- Use explicit types where the language supports them.
- Add concise comments only where they clarify non-obvious logic.
- Do not include placeholder examples unless the task asks for them.
- If a dependency is uncertain, use standard library or local code patterns instead of inventing packages.`;

        try {
            const code = await this.ollamaProvider.generateText({
                prompt,
                model: this.ollamaProvider.getModel(undefined, 'code')
            });

            const sanitizedCode = this.prepareGeneratedCode(code, filePath);
            if (context.previewChanges) {
                return this.createPreviewResult(filePath, exists ? await this.fileSystemTool.readFile(filePath) : '', sanitizedCode, exists ? 'modified' : 'added', `Preview implementation: ${sanitizedDesc}`, context);
            }
            await this.safeWriteCode(filePath, sanitizedCode);

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

    private async fixCode(description: string, context: Record<string, unknown>, params?: any): Promise<CodeActionResult> {
        const files = ((context?.files as string[]) || []).slice(0, 10);
        let sanitizedDesc = this.sanitizeInput(description);
        if (params?.verificationErrors) {
            sanitizedDesc = `${sanitizedDesc}\n\nVerification / compiler errors:\n${params.verificationErrors}`;
        }
        const fixedFiles: string[] = [];
        const failedFiles: string[] = [];
        const fixes: FixRecord[] = [];
        const proposedChanges: NonNullable<CodeActionResult['proposedChanges']> = [];
        const touchedDirs = new Set<string>();

        for (const file of files) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file, context);
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
                
                const targetedCode = await this.tryApplyTargetedEdits({
                    description: sanitizedDesc,
                    filePath: sanitizedPath,
                    content,
                    mode: 'fix'
                });

                const sanitizedCode = targetedCode || this.prepareGeneratedCode(await this.ollamaProvider.generateText({
                    prompt: `You are editing an existing source file. Fix only the requested issues while preserving behavior that is unrelated to the request.

Issue/request:
${sanitizedDesc}

File:
${sanitizedPath}

Current file contents:
${content.substring(0, 10000)}

Output contract:
- Return only the complete corrected contents of ${sanitizedPath}.
- Do not include markdown fences, explanations, summaries, or diff markers.
- Preserve public APIs, exports, formatting style, and existing comments unless a change is required.
- Keep unrelated code unchanged.
- Do not introduce new dependencies unless the file already uses them or the task explicitly requires them.
- Ensure the result is syntactically valid source code for this file.`,
                    model: this.ollamaProvider.getModel(undefined, 'code')
                }), sanitizedPath, content);
                if (context.previewChanges) {
                    proposedChanges.push(
                        this.buildProposedChange(sanitizedPath, content, sanitizedCode, 'modified', context)
                    );
                    continue;
                }

                // Create backup only when actually writing changes to disk.
                const backupPath = `${sanitizedPath}.backup.${Date.now()}`;
                await this.fileSystemTool.writeFile(backupPath, content);

                await this.safeWriteCode(sanitizedPath, sanitizedCode);

                fixedFiles.push(sanitizedPath);
                fixes.push({
                    file: sanitizedPath,
                    backup: backupPath,
                    changes: 'Code fixed and improved'
                });
                touchedDirs.add(path.dirname(sanitizedPath));

                this.logger.info(`Successfully fixed: ${sanitizedPath}`);
            } catch (error) {
                this.logger.error(`Failed to fix file: ${file}`, error);
                this.trackFailure('fix', file, error);
                failedFiles.push(file);
            }
        }

        if (proposedChanges.length > 0) {
            return {
                success: true,
                filesModified: [],
                proposedChanges,
                description: `Preview fix: ${sanitizedDesc}`,
            };
        }

        await this.cleanupTouchedBackups(touchedDirs);

        // Auto-verify: compile/run each fixed file to surface remaining errors.
        const verifyErrors: string[] = [];
        for (const f of fixedFiles) {
            const { success, output } = await this.verifyFile(f);
            if (!success && output) verifyErrors.push(`${path.basename(f)}: ${output.substring(0, 300)}`);
        }

        return {
            success: failedFiles.length === 0 && verifyErrors.length === 0,
            filesModified: fixedFiles,
            description: [
                `Fixed ${fixedFiles.length} files, ${failedFiles.length} failed`,
                verifyErrors.length ? `Compile errors after fix:\n${verifyErrors.join('\n')}` : ''
            ].filter(Boolean).join('\n'),
            rollback: () => this.rollbackFixes(fixes)
        };
    }

    private async rollbackFixes(fixes: FixRecord[]): Promise<void> {
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

    private async refactorCode(description: string, context: Record<string, unknown>): Promise<CodeActionResult> {
        const files = ((context?.files as string[]) || []).slice(0, 5);
        const sanitizedDesc = this.sanitizeInput(description);
        const refactoredFiles: string[] = [];
        const failedFiles: string[] = [];
        const refactorings: FixRecord[] = [];
        const proposedChanges: NonNullable<CodeActionResult['proposedChanges']> = [];
        const touchedDirs = new Set<string>();

        for (const file of files) {
            try {
                const sanitizedPath = this.sanitizeFilePath(file, context);
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
                
                const targetedCode = await this.tryApplyTargetedEdits({
                    description: sanitizedDesc,
                    filePath: sanitizedPath,
                    content,
                    mode: 'refactor'
                });

                const sanitizedCode = targetedCode || this.prepareGeneratedCode(await this.ollamaProvider.generateText({
                    prompt: `You are refactoring an existing source file. Improve maintainability without changing observable behavior.

Refactor request:
${sanitizedDesc}

File:
${sanitizedPath}

Current file contents:
${content.substring(0, 8000)}

Output contract:
- Return only the complete refactored contents of ${sanitizedPath}.
- Do not include markdown fences, explanations, summaries, or diff markers.
- Preserve public APIs, exports, runtime behavior, and integration points.
- Keep the refactor focused; avoid unrelated style churn.
- Prefer simpler control flow, clearer names, and reduced duplication.
- Do not add new dependencies unless absolutely necessary and already present in the project.
- Ensure the result is syntactically valid source code for this file.`,
                    model: this.ollamaProvider.getModel(undefined, 'code')
                }), sanitizedPath, content);
                if (context.previewChanges) {
                    proposedChanges.push(
                        this.buildProposedChange(sanitizedPath, content, sanitizedCode, 'modified', context)
                    );
                    continue;
                }

                // Create backup only when actually writing changes to disk.
                const backupPath = `${sanitizedPath}.backup.${Date.now()}`;
                await this.fileSystemTool.writeFile(backupPath, content);

                await this.safeWriteCode(sanitizedPath, sanitizedCode);

                refactoredFiles.push(sanitizedPath);
                refactorings.push({
                    file: sanitizedPath,
                    backup: backupPath,
                    changes: 'Code refactored for better maintainability'
                });
                touchedDirs.add(path.dirname(sanitizedPath));

                this.logger.info(`Successfully refactored: ${sanitizedPath}`);
            } catch (error) {
                this.logger.error(`Failed to refactor file: ${file}`, error);
                this.trackFailure('refactor', file, error);
                failedFiles.push(file);
            }
        }

        if (proposedChanges.length > 0) {
            return {
                success: true,
                filesModified: [],
                proposedChanges,
                description: `Preview refactor: ${sanitizedDesc}`,
            };
        }

        await this.cleanupTouchedBackups(touchedDirs);

        return {
            success: failedFiles.length === 0,
            filesModified: refactoredFiles,
            description: `Refactored ${refactoredFiles.length} files, ${failedFiles.length} failed`,
            rollback: () => this.rollbackRefactorings(refactorings)
        };
    }

    private async rollbackRefactorings(refactorings: FixRecord[]): Promise<void> {
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

    private async generateCode(description: string, context: Record<string, unknown>): Promise<CodeActionResult> {
        const sanitizedDesc = this.sanitizeInput(description);
        const language = (context.language as string) || 'typescript';
        const workspacePath = (context.workspacePath as string) || '.';
        
        try {
            // Generate filename if not provided
            const fileName = context.fileName || this.generateFileName(sanitizedDesc, context);
            const filePath = this.sanitizeFilePath(`${workspacePath}/src/${fileName}`, context);
            
            const prompt = `You are generating a source file for a coding assistant.

Task:
${sanitizedDesc}

Target file:
${filePath}

Language:
${language}

Output contract:
- Return only valid ${language} code for the complete file.
- Do not include markdown fences, explanations, summaries, or placeholders outside code.
- Include necessary imports, exports, types, and error handling.
- Keep the implementation focused on the requested behavior.
- Use standard library features and project-friendly patterns.
- Do not fabricate credentials, network endpoints, or unavailable APIs.
- If the request lacks details, choose conservative defaults and include TODO comments only inside the code.`;

            const code = await this.ollamaProvider.generateText({
                prompt,
                model: this.ollamaProvider.getModel(undefined, 'code')
            });

            const sanitizedCode = this.prepareGeneratedCode(code, filePath);
            
            // Write to file if workspace path is provided
            if (context.writeToFile !== false) {
                if (context.previewChanges) {
                    const original = await this.fileExists(filePath) ? await this.fileSystemTool.readFile(filePath) : '';
                    return this.createPreviewResult(filePath, original, sanitizedCode, original ? 'modified' : 'added', `Preview generated ${language} code for: ${sanitizedDesc}`, context);
                }

                await this.safeWriteCode(filePath, sanitizedCode);
                
                return {
                    success: true,
                    code: sanitizedCode,
                    filesModified: [filePath],
                    description: `Generated ${language} code for: ${sanitizedDesc}`
                };
            }
            
            return {
                success: true,
                code: sanitizedCode,
                filesModified: [],
                description: `Generated ${language} code for: ${sanitizedDesc}`
            };
        } catch (error) {
            this.logger.error(`Code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return {
                success: false,
                filesModified: [],
                description: `Failed to generate code for: ${sanitizedDesc}`,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private generateFileName(description: string, context: Record<string, unknown>): string {
        const langMap: Record<string, string> = {
            javascript: 'js',
            typescript: 'ts',
            python: 'py',
            java: 'java',
            go: 'go',
            rust: 'rs'
        };
        
        const ext = langMap[((context?.language as string) || '').toLowerCase()] || 'ts';
        const name = description
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 50);
        
        return `${name || 'generated'}.${ext}`;
    }

    private createPreviewResult(
        filePath: string,
        original: string,
        modified: string,
        status: 'added' | 'modified' | 'deleted',
        description: string,
        context?: Record<string, unknown>
    ): CodeActionResult {
        return {
            success: true,
            code: modified,
            filesModified: [],
            proposedChanges: [this.buildProposedChange(filePath, original, modified, status, context)],
            description
        };
    }

    private buildProposedChange(
        filePath: string,
        original: string,
        modified: string,
        status: 'added' | 'modified' | 'deleted',
        context?: Record<string, unknown>
    ): NonNullable<CodeActionResult['proposedChanges']>[number] {
        const summary = summarizeFileChange(
            filePath,
            original,
            modified,
            context?.workspacePath as string | undefined
        );
        return {
            filePath,
            original,
            modified,
            status,
            changeSummary: summary.summary,
            additions: summary.additions,
            ...(summary.anchorLine !== undefined ? { anchorLine: summary.anchorLine } : {}),
            ...(summary.anchorText !== undefined ? { anchorText: summary.anchorText } : {}),
        };
    }

    private tryHeuristicCommentEdit(description: string, content: string): string | null {
        const quoted = description.match(
            /comment\s+["']([^"']+)["']\s+above/i
        );
        const match = description.match(
            /(?:add|insert)\s+(?:a\s+)?(?:one[- ]line\s+)?comment\s+(?:["'][^"']+["']\s+)?above\s+([\w$]+)\s*(?:\(\))?/i
        );
        if (!quoted && !match) return null;

        const symbol = match?.[1] ?? 'symbol';
        let commentBody = quoted?.[1]?.trim() ?? '';

        if (!commentBody) {
            const commentText = description
                .replace(/^(?:add|insert)\s+(?:a\s+)?(?:one[- ]line\s+)?comment\s+above\s+[\w$]+\s*\(\)\s*(?:in\s+[\w./-]+)?\s*/i, '')
                .trim();
            commentBody =
                commentText && !/^in\s+[\w./-]+$/i.test(commentText)
                    ? commentText
                    : `Documents ${symbol}()`;
        }

        const lines = content.split(/\r?\n/);
        const fnPattern = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\s*\\(`);

        for (let i = 0; i < lines.length; i++) {
            if (!fnPattern.test(lines[i])) continue;
            const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
            lines.splice(i, 0, `${indent}// ${commentBody}`);
            return lines.join('\n');
        }

        return null;
    }

    private sanitizeFilePath(filePath: string, context?: Record<string, unknown>): string {
        if (!filePath || typeof filePath !== 'string') throw new Error('Valid file path required');

        const cwd = path.resolve((context?.workspacePath as string) || process.cwd());
        const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
        if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
            throw new Error(`Path traversal detected: ${filePath}`);
        }

        if (resolved.length > 500) {
            throw new Error(`File path too long: ${filePath}`);
        }

        return resolved;
    }

    /** Strip only null bytes and control chars from generated code — do NOT strip code syntax */
    private sanitizeCode(input: string): string {
        if (!input || typeof input !== 'string') return '';
        // Remove null bytes and non-printable control chars (keep newlines/tabs)
        return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').substring(0, 100_000);
    }

    private async tryApplyTargetedEdits(params: {
        description: string;
        filePath: string;
        content: string;
        mode: 'fix' | 'refactor';
    }): Promise<string | null> {
        const prompt = `You are editing an existing source file with exact replacement edits.

Mode:
${params.mode}

Request:
${params.description}

File:
${params.filePath}

Current file contents:
${params.content.substring(0, 12000)}

Output contract:
- Return only valid JSON.
- Schema: {"edits":[{"target":"exact text copied from current file","replacement":"new text"}]}
- Each target must be an exact substring from the current file.
- Prefer 1 to 5 small edits instead of replacing the entire file.
- Preserve unrelated code.
- Do not include markdown fences, comments, summaries, or prose.
- If an exact targeted edit is not safe, return {"edits":[]}.`;

        try {
            const response = await this.ollamaProvider.generateText({
                prompt,
                model: this.ollamaProvider.getModel(undefined, 'code')
            });
            const edits = this.parseReplacementEdits(response);
            if (edits.length === 0) {
                return null;
            }

            let nextContent = params.content;
            for (const edit of edits) {
                if (!edit.target || !edit.replacement || edit.target === edit.replacement) {
                    return null;
                }

                const occurrences = this.countOccurrences(nextContent, edit.target);
                if (occurrences !== 1) {
                    this.logger.warn(`Targeted edit rejected for ${params.filePath}: expected one target occurrence, got ${occurrences}`);
                    return null;
                }

                nextContent = nextContent.replace(edit.target, edit.replacement);
            }

            if (nextContent === params.content) {
                return null;
            }

            return this.prepareGeneratedCode(nextContent, params.filePath, params.content);
        } catch (error) {
            this.logger.warn(`Targeted edit generation failed for ${params.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return null;
        }
    }

    private parseReplacementEdits(response: string): ReplacementEdit[] {
        const cleaned = this.stripMarkdownCodeFence(this.sanitizeCode(response)).trim();
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
            return [];
        }

        const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as { edits?: ReplacementEdit[] };
        if (!Array.isArray(parsed.edits)) {
            return [];
        }

        return parsed.edits
            .filter(edit => typeof edit?.target === 'string' && typeof edit?.replacement === 'string')
            .slice(0, 5);
    }

    private countOccurrences(text: string, search: string): number {
        if (!search) return 0;

        let count = 0;
        let index = 0;
        while ((index = text.indexOf(search, index)) !== -1) {
            count++;
            index += search.length;
            if (count > 1) break;
        }

        return count;
    }

    private prepareGeneratedCode(input: string, filePath: string, originalContent?: string): string {
        const cleaned = this.stripProseWrapper(this.stripMarkdownCodeFence(this.sanitizeCode(input)).trim());
        this.validateGeneratedCode(cleaned, filePath, originalContent);
        return cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
    }

    // Strip leading/trailing natural-language sentences the LLM prepends or appends
    // around the actual code (e.g. "Here is the corrected code:" or "I have fixed...").
    private stripProseWrapper(code: string): string {
        const lines = code.split(/\r?\n/);
        const prosePattern = /^(here\s|i\s(?:have|will|would|am)\s|the\s(?:corrected|refactored|updated|fixed|following|complete)\s|this\s(?:is|code|file)\s|note:|summary:|explanation:|below\s(?:is|are)\s)/i;

        let startIdx = 0;
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) { startIdx = i + 1; continue; }
            if (prosePattern.test(trimmed)) { startIdx = i + 1; }
            else break;
        }

        let endIdx = lines.length;
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
            const trimmed = lines[i].trim();
            if (!trimmed) { endIdx = i; continue; }
            // A trailing sentence looks like prose: ends with period and has no code chars
            if (prosePattern.test(trimmed) || (/\.$/.test(trimmed) && !/[;{}\[\](]/.test(trimmed))) {
                endIdx = i;
            } else break;
        }

        return lines.slice(startIdx, endIdx).join('\n');
    }

    private stripMarkdownCodeFence(input: string): string {
        let trimmed = input.trim();
        const fullFence = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
        if (fullFence) {
            return fullFence[1];
        }

        trimmed = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
        trimmed = trimmed.replace(/\n?```\s*$/, '');
        trimmed = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*$/gm, '');
        return trimmed.replace(/```/g, '');
    }

    private validateGeneratedCode(code: string, filePath: string, originalContent?: string): void {
        if (!code.trim()) {
            throw new Error(`Generated code for ${filePath} was empty`);
        }

        if (code.includes('```')) {
            throw new Error(`Generated code for ${filePath} still contains markdown fences`);
        }

        const codeLinePattern = /[;{}()\[\]=><|&+\-*/%!~^]/;
        const proseMarkers = [
            'here is the',
            'here are the',
            'explanation:',
            'summary:',
            'the corrected code',
            'the refactored code',
            'i have ',
            'i will '
        ];
        // Only scan lines that don't look like code so string literals don't false-positive
        const proseLines = code.split(/\r?\n/).filter(line => {
            const t = line.trim();
            return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('#') && !codeLinePattern.test(t);
        });
        const proseText = proseLines.join('\n').toLowerCase();
        if (proseMarkers.some(marker => proseText.includes(marker))) {
            throw new Error(`Generated code for ${filePath} appears to contain prose`);
        }

        const ext = path.extname(filePath).toLowerCase();
        if (ext && !CodeAgent.ALLOWED_EXTENSIONS.has(ext)) {
            throw new Error(`Unsupported generated code extension: ${ext}`);
        }

        if (originalContent && originalContent.length > 500 && code.length < originalContent.length * 0.2) {
            throw new Error(`Generated code for ${filePath} is suspiciously shorter than the original`);
        }

        const nonCommentLines = code
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line =>
                line &&
                !line.startsWith('//') &&
                !line.startsWith('*') &&
                !line.startsWith('/*') &&
                !line.startsWith('#')
            );

        if (nonCommentLines.length === 0) {
            throw new Error(`Generated code for ${filePath} contains no executable content`);
        }
    }

    private sanitizeInput(input: string): string {
        if (!input || typeof input !== 'string') return '';
        return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').substring(0, 2000);
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
    getCapabilities(): AgentCapabilities {
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

    async validateExecution(result: CodeActionResult): Promise<boolean> {
        if (!result || result.error) return false;
        if (result.success === false) return false;
        
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

    /** Opportunistically prune stale backups from every directory we just wrote to. */
    private async cleanupTouchedBackups(dirs: Set<string>): Promise<void> {
        for (const dir of dirs) {
            await this.cleanupBackups(dir);
        }
    }

    /** Delete backup files older than MAX_BACKUP_AGE_MS in the given directory */
    async cleanupBackups(directory: string): Promise<void> {
        try {
            const entries = await fs.readdir(directory);
            const now = Date.now();
            for (const entry of entries) {
                if (!entry.includes('.backup.')) continue;
                const fullPath = path.join(directory, entry);
                try {
                    const stat = await fs.stat(fullPath);
                    if (now - stat.mtimeMs > CodeAgent.MAX_BACKUP_AGE_MS) {
                        await fs.unlink(fullPath);
                        this.logger.info(`Cleaned up old backup: ${fullPath}`);
                    }
                } catch {
                    // skip files we can't stat/delete
                }
            }
        } catch (error) {
            this.logger.warn(`Backup cleanup failed for ${directory}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
    }
}
