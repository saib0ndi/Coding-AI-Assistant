import * as path from 'path';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { Logger } from '../utils/Logger.js';

export interface VerificationCheck {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  output: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface VerificationResult {
  passed: boolean;
  workspacePath: string;
  profile: ProjectProfile;
  checks: VerificationCheck[];
  summary: string;
}

export interface ProjectProfile {
  buildSystem: 'npm' | 'yarn' | 'pnpm' | 'python' | 'maven' | 'unknown';
  hasTypeScript: boolean;
  scripts: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 8000;

export class ProjectVerifier {
  private fileSystem: FileSystemTool;
  private logger: Logger;
  private commandTimeoutMs: number;

  constructor(fileSystem?: FileSystemTool, commandTimeoutMs = DEFAULT_TIMEOUT_MS) {
    this.fileSystem = fileSystem ?? new FileSystemTool();
    this.logger = new Logger();
    this.commandTimeoutMs = commandTimeoutMs;
  }

  async detectProfile(workspacePath: string): Promise<ProjectProfile> {
    const resolved = path.resolve(workspacePath);
    this.fileSystem.allowWorkspace(resolved);
    const hasPackageJson = await this.fileSystem.fileExists(path.join(resolved, 'package.json'));
    const hasYarnLock = await this.fileSystem.fileExists(path.join(resolved, 'yarn.lock'));
    const hasPnpmLock = await this.fileSystem.fileExists(path.join(resolved, 'pnpm-lock.yaml'));
    const hasTsConfig = await this.fileSystem.fileExists(path.join(resolved, 'tsconfig.json'));
    const hasRequirements = await this.fileSystem.fileExists(path.join(resolved, 'requirements.txt'));
    const hasPom = await this.fileSystem.fileExists(path.join(resolved, 'pom.xml'));

    let buildSystem: ProjectProfile['buildSystem'] = 'unknown';
    const scripts: Record<string, string> = {};

    if (hasPackageJson) {
      buildSystem = hasPnpmLock ? 'pnpm' : hasYarnLock ? 'yarn' : 'npm';
      try {
        const raw = await this.fileSystem.readFile(path.join(resolved, 'package.json'));
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
        Object.assign(scripts, pkg.scripts ?? {});
      } catch (e) {
        this.logger.warn(`Could not parse package.json: ${e instanceof Error ? e.message : e}`);
      }
    } else if (hasRequirements) {
      buildSystem = 'python';
    } else if (hasPom) {
      buildSystem = 'maven';
    }

    return {
      buildSystem,
      hasTypeScript: hasTsConfig,
      scripts,
    };
  }

  async verify(workspacePath: string): Promise<VerificationResult> {
    const resolved = path.resolve(workspacePath);
    this.fileSystem.allowWorkspace(resolved);
    const profile = await this.detectProfile(resolved);
    const checks: VerificationCheck[] = [];

    switch (profile.buildSystem) {
      case 'npm':
      case 'yarn':
      case 'pnpm':
        checks.push(...await this.verifyNodeProject(resolved, profile));
        break;
      case 'python':
        checks.push(...await this.verifyPythonProject(resolved));
        break;
      case 'maven':
        checks.push(await this.runCheck(resolved, 'maven-test', 'mvn', ['-q', 'test']));
        break;
      default:
        checks.push({
          name: 'noop',
          command: '(none)',
          passed: true,
          exitCode: 0,
          output: '',
          skipped: true,
          skipReason: 'No recognized build system',
        });
    }

    const ran = checks.filter((c) => !c.skipped);
    const passed = ran.length === 0 ? true : ran.every((c) => c.passed);
    const failed = ran.filter((c) => !c.passed);

    return {
      passed,
      workspacePath: resolved,
      profile,
      checks,
      summary: passed
        ? `All ${ran.length} check(s) passed`
        : `Failed: ${failed.map((c) => c.name).join(', ')}`,
    };
  }

  formatFailureForRepair(result: VerificationResult): string {
    return result.checks
      .filter((c) => !c.skipped && !c.passed)
      .map(
        (c) =>
          `[${c.name}] exit=${c.exitCode}\n$ command: ${c.command}\n${c.output.slice(0, 4000)}`
      )
      .join('\n\n');
  }

  private async verifyNodeProject(
    workspacePath: string,
    profile: ProjectProfile
  ): Promise<VerificationCheck[]> {
    const checks: VerificationCheck[] = [];
    const runner = profile.buildSystem === 'yarn' ? 'yarn' : profile.buildSystem === 'pnpm' ? 'pnpm' : 'npm';

    if (profile.scripts.typecheck) {
      checks.push(await this.runCheck(workspacePath, 'typecheck', runner, this.scriptArgs(runner, 'typecheck')));
    } else if (profile.hasTypeScript) {
      checks.push(
        await this.runCheck(workspacePath, 'typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
      );
    }

    if (profile.scripts.build) {
      checks.push(await this.runCheck(workspacePath, 'build', runner, this.scriptArgs(runner, 'build')));
    }

    if (profile.scripts.test) {
      checks.push(await this.runCheck(workspacePath, 'test', runner, this.scriptArgs(runner, 'test')));
    }

    if (checks.length === 0 && profile.hasTypeScript) {
      checks.push(
        await this.runCheck(workspacePath, 'typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
      );
    }

    return checks;
  }

  private async verifyPythonProject(workspacePath: string): Promise<VerificationCheck[]> {
    const checks: VerificationCheck[] = [];
    const hasPytest = await this.fileSystem.fileExists(path.join(workspacePath, 'pytest.ini'))
      || await this.fileSystem.fileExists(path.join(workspacePath, 'pyproject.toml'));

    if (hasPytest) {
      checks.push(await this.runCheck(workspacePath, 'test', 'python', ['-m', 'pytest', '-q']));
    } else {
      checks.push({
        name: 'compile',
        command: 'python -m compileall .',
        passed: true,
        exitCode: 0,
        output: '',
        skipped: true,
        skipReason: 'No pytest config found',
      });
    }
    return checks;
  }

  private scriptArgs(runner: string, script: string): string[] {
    if (runner === 'yarn') return [script];
    if (runner === 'pnpm') return ['run', script];
    return ['run', script];
  }

  private async runCheck(
    workspacePath: string,
    name: string,
    command: string,
    args: string[]
  ): Promise<VerificationCheck> {
    const commandLabel = `${command} ${args.join(' ')}`.trim();
    try {
      const result = await this.runWithTimeout(command, args, workspacePath);
      const output = this.truncate(`${result.stdout}\n${result.stderr}`.trim());
      return {
        name,
        command: commandLabel,
        passed: result.exitCode === 0,
        exitCode: result.exitCode,
        output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        name,
        command: commandLabel,
        passed: false,
        exitCode: -1,
        output: message,
      };
    }
  }

  private async runWithTimeout(
    command: string,
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return Promise.race([
      this.fileSystem.executeCommand(command, args, cwd),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Command timed out after ${this.commandTimeoutMs}ms`)),
          this.commandTimeoutMs
        )
      ),
    ]);
  }

  private truncate(text: string): string {
    if (text.length <= MAX_OUTPUT_CHARS) return text;
    return text.slice(0, MAX_OUTPUT_CHARS) + '\n...(truncated)';
  }
}
