export interface VerificationCheckView {
    name: string;
    command: string;
    passed: boolean;
    exitCode: number;
    skipped?: boolean;
}

export interface VerificationView {
    passed: boolean;
    summary: string;
    checks: VerificationCheckView[];
}

export function extractVerification(result: unknown): VerificationView | null {
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    const raw = (r.verification ?? r) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.checks) && raw.passed === undefined) return null;

    const checks = Array.isArray(raw.checks)
        ? raw.checks
              .filter((c): c is Record<string, unknown> => c && typeof c === 'object')
              .map((c) => ({
                  name: String(c.name ?? 'check'),
                  command: String(c.command ?? ''),
                  passed: Boolean(c.passed),
                  exitCode: Number(c.exitCode ?? -1),
                  skipped: Boolean(c.skipped),
              }))
        : [];

    if (checks.length === 0 && raw.passed === undefined) return null;

    return {
        passed: Boolean(raw.passed ?? r.verified),
        summary: String(raw.summary ?? (raw.passed ? 'Passed' : 'Failed')),
        checks,
    };
}

export function formatVerificationMarkdown(verification: VerificationView): string {
    const icon = verification.passed ? '✅' : '❌';
    const lines = [`${icon} **Project verification** — ${verification.summary}`];

    if (verification.checks.length > 0) {
        lines.push('');
        for (const check of verification.checks) {
            if (check.skipped) {
                lines.push(`- ⏭️ \`${check.name}\` (skipped)`);
                continue;
            }
            const mark = check.passed ? '✅' : '❌';
            lines.push(`- ${mark} \`${check.name}\` — \`${check.command}\` (exit ${check.exitCode})`);
        }
    }

    return lines.join('\n');
}

export function formatAgentResultSummary(result: unknown): string {
    const r = result as Record<string, unknown> | null;
    if (!r) return 'Task completed';

    const parts: string[] = [];
    if (typeof r.summary === 'string' && r.summary.length > 0) {
        parts.push(r.summary);
    }

    const files = Array.isArray(r.filesModified) ? r.filesModified.length : 0;
    const steps = Array.isArray(r.steps) ? r.steps.length : 0;
    if (files > 0 || steps > 0) {
        parts.push(`**Files modified:** ${files} · **Steps:** ${steps}`);
    }

    const verification = extractVerification(result);
    if (verification) {
        parts.push(formatVerificationMarkdown(verification));
    } else if (r.verified === false) {
        parts.push('⚠️ Changes were not verified against the project build/test scripts.');
    }

    return parts.join('\n\n') || 'Task completed';
}
