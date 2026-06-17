import * as path from 'path';
import { FileSystemTool } from '../tools/FileSystemTool.js';

/**
 * SyntaxGate — deterministic, parser-based validation of generated code.
 *
 * This replaces fragile "does it look like prose?" heuristics with a real
 * parser/compiler check per language:
 *
 *   - TS/TSX/JS/JSX/MTS/CTS : TypeScript compiler's syntax parser (in-process).
 *                             Catches unbalanced braces, stray tokens, invalid
 *                             regex literals (TS1507), etc. WITHOUT the false
 *                             positives a per-file `tsc --noEmit` would produce
 *                             from missing imports / project context.
 *   - JSON                  : JSON.parse.
 *   - Python                : `python -m py_compile <file>` (CLI).
 *   - Go                    : `gofmt -e <file>` (CLI).
 *   - everything else       : a universal balanced-delimiter sanity check.
 *
 * CLI checks run through FileSystemTool.executeCommand, so they respect the
 * command allowlist / run-mode gating. They operate on a file that already
 * exists on disk (the caller's safe-write flow writes first, then gates).
 *
 * The gate is intentionally conservative: when no checker is available and the
 * delimiter check is inconclusive, it returns ok=true so we never block a write
 * purely because we couldn't analyze the language.
 */

export interface SyntaxGateResult {
    ok: boolean;
    /** Which checker produced the verdict (e.g. 'typescript', 'py_compile', 'delimiters', 'none'). */
    checker: string;
    /** Human-readable diagnostics when ok=false (suitable to feed back into a repair pass). */
    output?: string;
}

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

export class SyntaxGate {
    /**
     * Validate `content` destined for `filePath`. For CLI-checked languages the
     * file is expected to already exist on disk at `filePath`.
     */
    static async validate(
        filePath: string,
        content: string,
        fileSystem: FileSystemTool
    ): Promise<SyntaxGateResult> {
        const ext = path.extname(filePath).toLowerCase();

        if (TS_EXTS.has(ext)) {
            return SyntaxGate.checkTypeScript(filePath, content, ext);
        }
        if (ext === '.json') {
            return SyntaxGate.checkJson(content);
        }
        if (ext === '.py') {
            return SyntaxGate.checkCli(fileSystem, 'python', ['-m', 'py_compile', filePath], 'py_compile');
        }
        if (ext === '.go') {
            return SyntaxGate.checkCli(fileSystem, 'gofmt', ['-e', filePath], 'gofmt');
        }

        // Unknown language — fall back to a cheap structural sanity check.
        return SyntaxGate.checkDelimiters(content);
    }

    // ------------------------------------------------------------------
    // TypeScript / JavaScript (in-process, no project context required)
    // ------------------------------------------------------------------
    private static async checkTypeScript(filePath: string, content: string, ext: string): Promise<SyntaxGateResult> {
        let ts: typeof import('typescript');
        try {
            ts = await import('typescript');
        } catch {
            // typescript not available at runtime — degrade gracefully.
            return SyntaxGate.checkDelimiters(content);
        }

        const isJsx = ext === '.tsx' || ext === '.jsx';

        const compilerOptions: import('typescript').CompilerOptions = {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ESNext,
            isolatedModules: true,
        };
        if (isJsx) compilerOptions.jsx = ts.JsxEmit.React;

        // Transpile only (no type-checking, no module resolution) so we catch
        // structural syntax errors without false positives from missing imports.
        const transpiled = ts.transpileModule(content, {
            reportDiagnostics: true,
            fileName: path.basename(filePath),
            compilerOptions,
        });

        const syntaxDiags = (transpiled.diagnostics ?? []).filter(
            d => d.category === ts.DiagnosticCategory.Error
        );
        if (syntaxDiags.length > 0) {
            const messages = syntaxDiags.slice(0, 8).map(
                d => `  TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
            );
            return { ok: false, checker: 'typescript', output: `Syntax errors:\n${messages.join('\n')}` };
        }

        // Second pass: compile (not run) the emitted JS with `new Function`. This
        // catches engine-level errors the TS transpiler tolerates — most notably
        // invalid regular-expression literals like /__|**/ (Nothing to repeat),
        // which is the exact failure that corrupted a file in production.
        // `new Function` parses the body but never executes it, so it is safe.
        try {
            // eslint-disable-next-line no-new-func
            new Function(transpiled.outputText);
        } catch (err) {
            if (err instanceof SyntaxError) {
                return { ok: false, checker: 'typescript', output: err.message };
            }
            // Reference/other errors would only arise from execution, which we
            // never trigger — so ignore them.
        }

        return { ok: true, checker: 'typescript' };
    }

    // ------------------------------------------------------------------
    // JSON
    // ------------------------------------------------------------------
    private static checkJson(content: string): SyntaxGateResult {
        try {
            JSON.parse(content);
            return { ok: true, checker: 'json' };
        } catch (err) {
            return { ok: false, checker: 'json', output: err instanceof Error ? err.message : String(err) };
        }
    }

    // ------------------------------------------------------------------
    // CLI-based checkers (python, go, …)
    // ------------------------------------------------------------------
    private static async checkCli(
        fileSystem: FileSystemTool,
        command: string,
        args: string[],
        checker: string
    ): Promise<SyntaxGateResult> {
        try {
            const { stdout, stderr, exitCode } = await fileSystem.executeCommand(command, args);
            if (exitCode === 0) {
                return { ok: true, checker };
            }
            const output = [stdout, stderr].filter(Boolean).join('\n').trim();
            return { ok: false, checker, output: output || `${command} exited with code ${exitCode}` };
        } catch (err) {
            // Checker not installed or blocked by run-mode — don't block the write.
            return { ok: true, checker: `${checker}:unavailable` };
        }
    }

    // ------------------------------------------------------------------
    // Universal fallback: balanced delimiters (ignores those inside strings)
    // ------------------------------------------------------------------
    private static checkDelimiters(content: string): SyntaxGateResult {
        const stack: string[] = [];
        const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
        const openers = new Set(['(', '[', '{']);
        let inString: string | null = null;
        let escaped = false;

        for (let i = 0; i < content.length; i++) {
            const ch = content[i];
            if (inString) {
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === inString) inString = null;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
            if (openers.has(ch)) { stack.push(ch); continue; }
            if (pairs[ch]) {
                if (stack.pop() !== pairs[ch]) {
                    return { ok: false, checker: 'delimiters', output: `Unbalanced "${ch}"` };
                }
            }
        }

        if (stack.length > 0) {
            return { ok: false, checker: 'delimiters', output: `Unclosed "${stack[stack.length - 1]}"` };
        }
        return { ok: true, checker: 'delimiters' };
    }
}
