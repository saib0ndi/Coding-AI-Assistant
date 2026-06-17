import * as fs from 'fs';
import * as path from 'path';

/**
 * CommandSandbox — opt-in OS-level sandboxing for spawned commands.
 *
 * App-level gating (run modes, allowlists, arg guards) cannot stop an
 * allowlisted interpreter from touching the network or files outside the
 * workspace once it is running. Real isolation needs the OS. When enabled via
 * `MCP_OLLAMA_OS_SANDBOX`, this wraps the target command in an available OS
 * sandbox launcher:
 *
 *   - Linux : bubblewrap (`bwrap`) preferred, else `firejail`
 *   - macOS : `sandbox-exec` (SBPL profile)
 *
 * The profile makes the filesystem read-only except the workspace root(s),
 * mounts a private /tmp, and (by default) disables networking. If no launcher
 * is available the command runs unwrapped and the caller is warned once — the
 * app-level guards still apply.
 *
 * `buildArgv` is a pure function (no spawning) so it can be unit-tested on any
 * platform without the launchers installed.
 */

export type SandboxLauncher = 'bwrap' | 'firejail' | 'sandbox-exec' | 'none';

export interface SandboxOptions {
    cwd: string;
    /** Directories the command may write to (typically the workspace root[s]). */
    writableRoots: string[];
    /** When false (default), the sandbox blocks network access. */
    allowNetwork: boolean;
}

export interface BuiltCommand {
    command: string;
    args: string[];
}

export class CommandSandbox {
    private static cachedLauncher: SandboxLauncher | undefined;

    /** Whether OS sandboxing was requested via env. */
    static isEnabled(): boolean {
        const v = (process.env.MCP_OLLAMA_OS_SANDBOX || '').toLowerCase();
        return v === '1' || v === 'true' || v === 'auto' || v === 'on';
    }

    /** Whether the sandbox should permit network access (default: no). */
    static allowNetwork(): boolean {
        const v = (process.env.MCP_OLLAMA_SANDBOX_NET || '').toLowerCase();
        return v === '1' || v === 'true' || v === 'on';
    }

    /** Detect the best available launcher for this platform (cached). */
    static detectLauncher(): SandboxLauncher {
        if (this.cachedLauncher !== undefined) return this.cachedLauncher;
        let launcher: SandboxLauncher = 'none';
        if (process.platform === 'linux') {
            if (whichSync('bwrap')) launcher = 'bwrap';
            else if (whichSync('firejail')) launcher = 'firejail';
        } else if (process.platform === 'darwin') {
            if (whichSync('sandbox-exec')) launcher = 'sandbox-exec';
        }
        this.cachedLauncher = launcher;
        return launcher;
    }

    /** Reset the cached launcher (tests). */
    static resetCache(): void {
        this.cachedLauncher = undefined;
    }

    /**
     * Build the wrapped argv for a given launcher. Pure — does not spawn or
     * check availability, so it is fully unit-testable.
     */
    static buildArgv(
        launcher: SandboxLauncher,
        command: string,
        args: string[],
        opts: SandboxOptions
    ): BuiltCommand {
        const roots = dedupe(opts.writableRoots.map((r) => path.resolve(r)).filter(Boolean));

        switch (launcher) {
            case 'bwrap': {
                const wrap: string[] = [
                    '--die-with-parent',
                    '--unshare-pid',
                    '--ro-bind', '/', '/',
                    '--dev', '/dev',
                    '--proc', '/proc',
                    '--tmpfs', '/tmp',
                ];
                if (!opts.allowNetwork) wrap.push('--unshare-net');
                for (const root of roots) wrap.push('--bind', root, root);
                wrap.push('--chdir', path.resolve(opts.cwd));
                wrap.push('--', command, ...args);
                return { command: 'bwrap', args: wrap };
            }

            case 'firejail': {
                const wrap: string[] = ['--quiet', '--noprofile', '--private-tmp', '--read-only=/'];
                if (!opts.allowNetwork) wrap.push('--net=none');
                for (const root of roots) wrap.push(`--read-write=${root}`);
                wrap.push(command, ...args);
                return { command: 'firejail', args: wrap };
            }

            case 'sandbox-exec': {
                const profile = buildSeatbeltProfile(roots, opts.allowNetwork);
                return { command: 'sandbox-exec', args: ['-p', profile, command, ...args] };
            }

            case 'none':
            default:
                return { command, args };
        }
    }
}

function buildSeatbeltProfile(writableRoots: string[], allowNetwork: boolean): string {
    const writes = writableRoots
        .map((r) => `(allow file-write* (subpath ${quote(r)}))`)
        .join('\n  ');
    const net = allowNetwork ? '(allow network*)' : '(deny network*)';
    return [
        '(version 1)',
        '(deny default)',
        '(allow process-fork)',
        '(allow process-exec)',
        '(allow sysctl-read)',
        '(allow file-read*)',
        '  ' + writes,
        '(allow file-write* (subpath "/tmp"))',
        '(allow file-write* (subpath "/private/tmp"))',
        '(allow file-write* (subpath "/dev"))',
        net,
    ].join('\n');
}

function quote(s: string): string {
    return `"${s.replace(/"/g, '\\"')}"`;
}

function dedupe(items: string[]): string[] {
    return Array.from(new Set(items));
}

/** Minimal PATH lookup without spawning a shell. */
function whichSync(bin: string): boolean {
    const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of paths) {
        try {
            const full = path.join(dir, bin);
            fs.accessSync(full, fs.constants.X_OK);
            return true;
        } catch {
            /* not here */
        }
    }
    return false;
}
