import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawn } from 'child_process';
import { createTool } from './toolHelper.js';
import type { ToolDependencies } from './ToolDependencies.js';

// ---------------------------------------------------------------------------
// Language → execution strategy map
// ---------------------------------------------------------------------------
interface LangConfig {
  compile?: { cmd: string; args: (file: string, outDir: string) => string[] };
  run: { cmd: string; args: (file: string, compiledOut?: string) => string[] };
  ext: string[];
}

const LANGUAGES: Record<string, LangConfig> = {
  typescript: {
    compile: { cmd: 'tsc', args: (f, out) => ['--outDir', out, '--target', 'ES2020', '--module', 'commonjs', '--esModuleInterop', f] },
    run: { cmd: 'node', args: (_, compiled) => [compiled!] },
    ext: ['.ts'],
  },
  javascript: {
    run: { cmd: 'node', args: (f) => [f] },
    ext: ['.js', '.mjs', '.cjs'],
  },
  python: {
    run: { cmd: 'python3', args: (f) => [f] },
    ext: ['.py'],
  },
  go: {
    run: { cmd: 'go', args: (f) => ['run', f] },
    ext: ['.go'],
  },
  rust: {
    compile: { cmd: 'rustc', args: (f, out) => [f, '-o', path.join(out, 'out')] },
    run: { cmd: path.join('__OUT__', 'out'), args: () => [] },
    ext: ['.rs'],
  },
  java: {
    compile: { cmd: 'javac', args: (f, out) => ['-d', out, f] },
    run: { cmd: 'java', args: (f, out) => ['-cp', out!, path.basename(f, '.java')] },
    ext: ['.java'],
  },
  c: {
    compile: { cmd: 'gcc', args: (f, out) => [f, '-o', path.join(out, 'out')] },
    run: { cmd: path.join('__OUT__', 'out'), args: () => [] },
    ext: ['.c'],
  },
  cpp: {
    compile: { cmd: 'g++', args: (f, out) => [f, '-o', path.join(out, 'out')] },
    run: { cmd: path.join('__OUT__', 'out'), args: () => [] },
    ext: ['.cpp', '.cc', '.cxx'],
  },
  csharp: {
    run: { cmd: 'dotnet', args: (f) => ['script', f] },
    ext: ['.cs'],
  },
  ruby: {
    run: { cmd: 'ruby', args: (f) => [f] },
    ext: ['.rb'],
  },
  php: {
    run: { cmd: 'php', args: (f) => [f] },
    ext: ['.php'],
  },
  bash: {
    run: { cmd: 'bash', args: (f) => [f] },
    ext: ['.sh', '.bash'],
  },
  swift: {
    run: { cmd: 'swift', args: (f) => [f] },
    ext: ['.swift'],
  },
  kotlin: {
    compile: { cmd: 'kotlinc', args: (f, out) => [f, '-include-runtime', '-d', path.join(out, 'out.jar')] },
    run: { cmd: 'java', args: (_, out) => ['-jar', path.join(out!, 'out.jar')] },
    ext: ['.kt'],
  },
  r: {
    run: { cmd: 'Rscript', args: (f) => [f] },
    ext: ['.r', '.R'],
  },
  perl: {
    run: { cmd: 'perl', args: (f) => [f] },
    ext: ['.pl', '.pm'],
  },
  lua: {
    run: { cmd: 'lua', args: (f) => [f] },
    ext: ['.lua'],
  },
};

// Build reverse map: extension → language name
const EXT_TO_LANG: Record<string, string> = {};
for (const [lang, cfg] of Object.entries(LANGUAGES)) {
  for (const ext of cfg.ext) EXT_TO_LANG[ext] = lang;
}

function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Core execution logic
// ---------------------------------------------------------------------------
function spawnExec(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    child.on('error', (err) => reject(new Error(`Spawn failed: ${err.message}`)));
  });
}

async function executeFile(
  filePath: string,
  language: string,
  cwd: string,
  timeout: number
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; language: string }> {
  const cfg = LANGUAGES[language];
  if (!cfg) throw new Error(`Unsupported language: ${language}`);

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), `mcp-exec-`));
  try {
    // Compile step (if needed)
    if (cfg.compile) {
      const compileArgs = cfg.compile.args(filePath, outDir);
      const compileResult = await runWithTimeout(() => spawnExec(cfg.compile!.cmd, compileArgs, cwd), timeout);
      if (compileResult.exitCode !== 0) {
        return { success: false, ...compileResult, language };
      }
      // TypeScript: run the compiled .js
      if (language === 'typescript') {
        const jsFile = path.join(outDir, path.basename(filePath, '.ts') + '.js');
        const runResult = await runWithTimeout(() => spawnExec('node', [jsFile], cwd), timeout);
        return { ...runResult, success: runResult.exitCode === 0, language };
      }
    }

    // Run step — replace __OUT__ placeholder with actual outDir
    const runCmd = cfg.run.cmd.replace('__OUT__', outDir);
    const runArgs = cfg.compile
      ? cfg.run.args(filePath, outDir)
      : cfg.run.args(filePath);

    const runResult = await runWithTimeout(() => spawnExec(runCmd, runArgs, cwd), timeout);
    return { ...runResult, success: runResult.exitCode === 0, language };
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// MCP tool factory
// ---------------------------------------------------------------------------
export function createExecutionTools(deps: ToolDependencies) {
  return [createExecutionTool(deps)];
}

export function createExecutionTool(_deps: ToolDependencies) {
  return createTool(
    'execute_code',
    'Compile and/or run a source file in any supported language. Returns stdout, stderr, exit code, and success flag.',
    {
      filePath: { type: 'string', description: 'Absolute or workspace-relative path to the source file' },
      language: { type: 'string', description: 'Language override (auto-detected from extension if omitted). Supported: typescript, javascript, python, go, rust, java, c, cpp, csharp, ruby, php, bash, swift, kotlin, r, perl, lua' },
      workspacePath: { type: 'string', description: 'Working directory for execution (defaults to file directory)' },
      timeoutMs: { type: 'number', description: 'Max execution time in milliseconds (default 30000)' },
      code: { type: 'string', description: 'Inline code to run (creates a temp file — use instead of filePath for snippets)' },
    },
    ['filePath'],
    async (params: any) => {
      const { language: langOverride, workspacePath, timeoutMs = 30000, code } = params;
      let filePath: string = params.filePath;

      // Inline code snippet: write to a temp file
      let tempFile: string | null = null;
      if (code && langOverride) {
        const cfg = LANGUAGES[langOverride];
        const ext = cfg?.ext[0] ?? '.txt';
        tempFile = path.join(os.tmpdir(), `mcp-snippet-${Date.now()}${ext}`);
        await fs.writeFile(tempFile, code, 'utf8');
        filePath = tempFile;
      }

      try {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workspacePath || process.cwd(), filePath);
        const cwd = workspacePath || path.dirname(resolvedPath);
        const language = langOverride ?? detectLanguage(resolvedPath);

        if (!language) {
          return {
            success: false,
            error: `Cannot detect language for "${path.basename(resolvedPath)}". Pass the language parameter explicitly.`,
            supportedLanguages: Object.keys(LANGUAGES),
          };
        }

        const result = await executeFile(resolvedPath, language, cwd, timeoutMs);
        return result;
      } finally {
        if (tempFile) await fs.unlink(tempFile).catch(() => {});
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Utility: list supported languages (used by the chat assistant)
// ---------------------------------------------------------------------------
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGES);
}
