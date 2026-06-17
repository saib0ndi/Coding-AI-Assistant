import * as fs from 'fs/promises';
import * as path from 'path';
import { CommandSandbox } from './CommandSandbox.js';

const ALLOWED_BASE = process.cwd();

/**
 * Run modes for FileSystemTool:
 *   'full'       — all operations permitted (default for local dev).
 *   'restricted' — file READS allowed; file WRITES denied; commands run only if
 *                  the base command is in COMMAND_ALLOWLIST (and not an inline
 *                  interpreter escape like `node -e` / `python -c`).
 *   'read-only'  — only read operations; all writes and commands are rejected.
 *
 * Set via env MCP_OLLAMA_RUN_MODE=full|restricted|read-only, or by calling
 * FileSystemTool.setRunMode() at startup.
 *
 * Note: run modes are app-level guardrails. For true OS isolation (network off,
 * filesystem confinement that also applies to child processes), additionally
 * enable MCP_OLLAMA_OS_SANDBOX — see CommandSandbox.
 */
export type RunMode = 'full' | 'restricted' | 'read-only';

/** Commands that are always safe to run (read-only or build helpers). */
const COMMAND_ALLOWLIST = new Set([
    'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun',
    'tsc', 'esbuild', 'vite',
    'git', 'gh',
    'ls', 'find', 'cat', 'echo', 'which', 'pwd', 'env',
    'python', 'python3', 'pip', 'pip3',
    'cargo', 'rustc',
    'go', 'gofmt',
    'java', 'mvn', 'gradle',
]);

/**
 * Inline-code flags that turn an allowlisted interpreter into an arbitrary-code
 * (and network/filesystem) escape hatch. Blocked outside 'full' run mode.
 */
const INTERPRETER_EVAL_FLAGS: Record<string, string[]> = {
    node: ['-e', '--eval', '-p', '--print'],
    bun: ['-e', '--eval', '-p', '--print'],
    deno: ['eval'],
    python: ['-c'],
    python3: ['-c'],
    ruby: ['-e'],
    perl: ['-e'],
};

/** Default command execution limits (overridable per call or via env). */
const DEFAULT_CMD_TIMEOUT_MS = Math.max(1000, Number(process.env.MCP_OLLAMA_CMD_TIMEOUT_MS) || 120_000);
const DEFAULT_CMD_MAX_OUTPUT = Math.max(64_000, Number(process.env.MCP_OLLAMA_CMD_MAX_OUTPUT) || 10_000_000);

let globalRunMode: RunMode = (() => {
    const env = (process.env.MCP_OLLAMA_RUN_MODE || 'full').toLowerCase();
    if (env === 'restricted' || env === 'read-only') return env as RunMode;
    return 'full';
})();

let warnedNoSandbox = false;

export class FileSystemTool {
  private extraBases = new Set<string>();
  private runMode: RunMode = globalRunMode;

  /** Override run-mode for this instance (useful in tests or per-request contexts). */
  setRunMode(mode: RunMode): void { this.runMode = mode; }

  /** Set the process-wide default (applied to future instances). */
  static setDefaultRunMode(mode: RunMode): void { globalRunMode = mode; }

  private assertWriteAllowed(): void {
    if (this.runMode === 'read-only' || this.runMode === 'restricted') {
      throw new Error(`FileSystemTool is in ${this.runMode} mode — file writes are not permitted`);
    }
  }

  /** Allow file operations under an additional workspace root (e.g. from agent context). */
  allowWorkspace(workspacePath: string): void {
    if (workspacePath) {
      this.extraBases.add(path.resolve(workspacePath));
    }
  }

  private assertSafePath(filePath: string): void {
    const resolved = path.resolve(filePath);
    const bases = [ALLOWED_BASE, ...this.extraBases];
    for (const base of bases) {
      if (resolved.startsWith(base + path.sep) || resolved === base) {
        return;
      }
    }
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  async readFile(filePath: string): Promise<string> {
    this.assertSafePath(filePath);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  }

  async writeFile(filePath: string, content: string): Promise<boolean> {
    this.assertWriteAllowed();
    this.assertSafePath(filePath);
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error}`);
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

  async createDirectory(dirPath: string): Promise<boolean> {
    this.assertWriteAllowed();
    this.assertSafePath(dirPath);
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error}`);
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    this.assertSafePath(dirPath);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isFile())
        .map(entry => path.join(dirPath, entry.name));
    } catch (error) {
      throw new Error(`Failed to list files in ${dirPath}: ${error}`);
    }
  }

  async copyFile(source: string, destination: string): Promise<boolean> {
    this.assertWriteAllowed();
    this.assertSafePath(source);
    this.assertSafePath(destination);
    try {
      const dir = path.dirname(destination);
      await fs.mkdir(dir, { recursive: true });
      await fs.copyFile(source, destination);
      return true;
    } catch (error) {
      throw new Error(`Failed to copy file from ${source} to ${destination}: ${error}`);
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    this.assertWriteAllowed();
    this.assertSafePath(filePath);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete file ${filePath}: ${error}`);
    }
  }

  /**
   * Gate a command against the current run mode: metacharacter check, allowlist,
   * and interpreter-escape guard. Throws when the command is not permitted.
   */
  private assertCommandAllowed(command: string, args: string[]): void {
    // Reject shell metacharacters in the command name itself.
    if (/[;&|`$<>\\]/.test(command)) {
      throw new Error(`Unsafe command: ${command}`);
    }
    if (this.runMode === 'read-only') {
      throw new Error('FileSystemTool is in read-only mode — command execution is not permitted');
    }

    const baseCommand = path.basename(command);

    if (this.runMode === 'restricted' && !COMMAND_ALLOWLIST.has(baseCommand)) {
      throw new Error(
        `Command "${baseCommand}" is not in the allowlist for restricted mode. Allowed: ${[...COMMAND_ALLOWLIST].join(', ')}`
      );
    }

    // Even an allowlisted interpreter can run arbitrary code via inline-eval
    // flags (node -e, python -c, …), which bypasses both the allowlist and the
    // filesystem path guard. Block those outside 'full' mode.
    if (this.runMode !== 'full') {
      const evalFlags = INTERPRETER_EVAL_FLAGS[baseCommand];
      if (evalFlags) {
        const hit = args.find((a) =>
          evalFlags.some((flag) => a === flag || a.startsWith(`${flag}=`))
        );
        if (hit) {
          throw new Error(
            `Inline code execution ("${baseCommand} ${hit}") is blocked in ${this.runMode} mode`
          );
        }
      }
    }
  }

  async executeCommand(
    command: string,
    args: string[],
    cwd?: string,
    opts?: { timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean; truncated?: boolean }> {
    this.assertCommandAllowed(command, args);
    if (cwd) this.assertSafePath(cwd);

    const timeoutMs = Math.max(1000, opts?.timeoutMs ?? DEFAULT_CMD_TIMEOUT_MS);
    const maxOutputBytes = Math.max(1000, opts?.maxOutputBytes ?? DEFAULT_CMD_MAX_OUTPUT);
    const effectiveCwd = cwd || process.cwd();

    // Optionally wrap the command in an OS-level sandbox (network off, FS confined).
    let spawnCommand = command;
    let spawnArgs = args;
    if (CommandSandbox.isEnabled()) {
      const launcher = CommandSandbox.detectLauncher();
      if (launcher !== 'none') {
        const built = CommandSandbox.buildArgv(launcher, command, args, {
          cwd: effectiveCwd,
          writableRoots: [ALLOWED_BASE, ...this.extraBases],
          allowNetwork: CommandSandbox.allowNetwork(),
        });
        spawnCommand = built.command;
        spawnArgs = built.args;
      } else if (!warnedNoSandbox) {
        warnedNoSandbox = true;
        // eslint-disable-next-line no-console
        console.warn(
          'MCP_OLLAMA_OS_SANDBOX is set but no sandbox launcher (bwrap/firejail/sandbox-exec) was found; running unwrapped.'
        );
      }
    }

    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      // Pass args as array — never via shell — to prevent injection.
      const child = spawn(spawnCommand, spawnArgs, {
        cwd: effectiveCwd,
        stdio: 'pipe',
        shell: false, // explicit: no shell expansion
      });

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const capture = (chunk: Buffer, sink: 'out' | 'err') => {
        if (truncated) return;
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          truncated = true;
          const note = `\n[output truncated: exceeded ${maxOutputBytes} bytes]`;
          if (sink === 'out') stdout += note;
          else stderr += note;
          child.kill('SIGKILL');
          return;
        }
        if (sink === 'out') stdout += chunk.toString();
        else stderr += chunk.toString();
      };

      child.stdout?.on('data', (d: Buffer) => capture(d, 'out'));
      child.stderr?.on('data', (d: Buffer) => capture(d, 'err'));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Hard-kill if it ignores SIGTERM.
        setTimeout(() => child.kill('SIGKILL'), 2000).unref();
      }, timeoutMs);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (timedOut) stderr += `\n[command timed out after ${timeoutMs} ms]`;
        resolve({
          stdout,
          stderr,
          exitCode: timedOut ? 124 : code ?? 0,
          ...(timedOut ? { timedOut: true } : {}),
          ...(truncated ? { truncated: true } : {}),
        });
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Command execution failed: ${error.message}`));
      });
    });
  }
}