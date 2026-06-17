import * as vscode from 'vscode';
import { DiffViewer, FileDiff } from './diffViewer';
import { formatAgentResultSummary, formatVerificationMarkdown, extractVerification } from './verificationDisplay';
import { formatChangeSummaryMarkdown, summarizeFileChange } from './changeSummary';

let pendingChanges: FileDiff[] = [];
let diffViewer: DiffViewer | undefined;

export function getPendingAgentChanges(): FileDiff[] {
    return pendingChanges;
}

export function extractProposedChanges(result: unknown): FileDiff[] {
    const r = result as Record<string, unknown> | null;
    const direct = Array.isArray(r?.proposedChanges) ? r.proposedChanges : [];
    const stepChanges = Array.isArray(r?.steps)
        ? (r.steps as Array<{ result?: { proposedChanges?: unknown[] } }>).flatMap(
              (step) => step?.result?.proposedChanges || []
          )
        : [];

    return [...direct, ...stepChanges]
        .filter(
            (change: unknown): change is FileDiff =>
                typeof change === 'object' &&
                change !== null &&
                typeof (change as FileDiff).filePath === 'string' &&
                typeof (change as FileDiff).original === 'string' &&
                typeof (change as FileDiff).modified === 'string' &&
                ['added', 'modified', 'deleted'].includes((change as FileDiff).status)
        )
        .map((change) => ({
            filePath: change.filePath,
            original: change.original,
            modified: change.modified,
            status: change.status,
            changeSummary: change.changeSummary,
            additions: change.additions,
            anchorLine: change.anchorLine,
            anchorText: change.anchorText,
        }));
}

export function formatAgentPreviewMarkdown(result: unknown, workspacePath: string): string {
    const proposed = extractProposedChanges(result);
    const parts: string[] = [];

    if (proposed.length > 0) {
        const summaries = proposed.map((change) =>
            summarizeFileChange(change.filePath, change.original, change.modified, workspacePath)
        );
        parts.push(formatChangeSummaryMarkdown(summaries));
        parts.push(
            '👉 Use **Review Agent Changes** (Command Palette) or the diff panel to accept/reject edits.'
        );
    }

    const summary = formatAgentResultSummary(result);
    if (summary) {
        parts.push(summary);
    }

    const verification = extractVerification(result);
    if (verification) {
        parts.push(formatVerificationMarkdown(verification));
    }

    return parts.join('\n\n') || 'Agent task completed.';
}

export function storePendingChanges(changes: FileDiff[]): void {
    pendingChanges = changes;
}

export function openAgentReviewPanel(
    context: vscode.ExtensionContext,
    changes: FileDiff[],
    options?: {
        onApplied?: (filePath: string) => void;
        onRejected?: (filePath: string) => void;
        onAllSettled?: () => void;
    }
): void {
    if (changes.length === 0) {
        void vscode.window.showInformationMessage('No agent changes to review.');
        return;
    }

    pendingChanges = changes;
    if (!diffViewer) {
        diffViewer = new DiffViewer(context);
    }

    const pending = new Map(changes.map((change) => [change.filePath, change]));

    const onSettled = () => {
        if (pending.size === 0) {
            options?.onAllSettled?.();
        }
    };

    diffViewer.showDiffs(
        changes,
        async (filePath) => {
            const change = pending.get(filePath);
            if (!change) return;
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(change.filePath),
                Buffer.from(change.modified, 'utf8')
            );
            pending.delete(filePath);
            options?.onApplied?.(filePath);
            void vscode.window.showInformationMessage(`Applied: ${filePath}`);
            onSettled();
        },
        (filePath) => {
            pending.delete(filePath);
            options?.onRejected?.(filePath);
            void vscode.window.showInformationMessage(`Rejected: ${filePath}`);
            onSettled();
        }
    );
}

export function presentAgentResult(
    context: vscode.ExtensionContext,
    result: unknown,
    workspacePath: string,
    options?: { openDiff?: boolean }
): string {
    const proposed = extractProposedChanges(result);
    if (proposed.length > 0) {
        storePendingChanges(proposed);
        if (options?.openDiff !== false) {
            openAgentReviewPanel(context, proposed);
        }
    }
    return formatAgentPreviewMarkdown(result, workspacePath);
}
