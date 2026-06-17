import * as path from 'path';

export interface LineChange {
  line: number;
  text: string;
}

export interface FileChangeSummary {
  filePath: string;
  relativePath: string;
  additions: LineChange[];
  removals: LineChange[];
  anchorLine?: number;
  anchorText?: string;
  summary: string;
}

function detectInsertion(
  originalLines: string[],
  modifiedLines: string[]
): { at: number; text: string; anchorLine: number; anchorText: string } | null {
  let start = 0;
  while (
    start < originalLines.length &&
    start < modifiedLines.length &&
    originalLines[start] === modifiedLines[start]
  ) {
    start++;
  }

  if (modifiedLines.length !== originalLines.length + 1) {
    return null;
  }

  const inserted = modifiedLines[start];
  const restMatches = modifiedLines
    .slice(start + 1)
    .every((line, index) => line === originalLines[start + index]);
  if (!restMatches || inserted === undefined) {
    return null;
  }

  const anchorLine = start + 2;
  const anchorText = modifiedLines[start + 1] ?? '';
  return { at: start, text: inserted, anchorLine, anchorText };
}

function relativePath(filePath: string, workspacePath?: string): string {
  if (!workspacePath) return filePath;
  const resolved = path.resolve(filePath);
  const base = path.resolve(workspacePath);
  if (resolved.startsWith(base + path.sep)) {
    return resolved.slice(base.length + 1);
  }
  return filePath;
}

export function summarizeFileChange(
  filePath: string,
  original: string,
  modified: string,
  workspacePath?: string
): FileChangeSummary {
  const originalLines = original.split(/\r?\n/);
  const modifiedLines = modified.split(/\r?\n/);
  const rel = relativePath(filePath, workspacePath);

  const insertion = detectInsertion(originalLines, modifiedLines);
  if (insertion) {
    const lineNum = insertion.at + 1;
    const anchorSnippet = insertion.anchorText.trim().slice(0, 80);
    const addedText = insertion.text.trim();
    const summary = anchorSnippet
      ? `Line ${lineNum}: added \`${addedText}\` above \`${anchorSnippet}\``
      : `Line ${lineNum}: added \`${addedText}\``;

    return {
      filePath,
      relativePath: rel,
      additions: [{ line: lineNum, text: insertion.text }],
      removals: [],
      anchorLine: insertion.anchorLine,
      anchorText: insertion.anchorText,
      summary,
    };
  }

  const additions: LineChange[] = [];
  const removals: LineChange[] = [];
  const max = Math.max(originalLines.length, modifiedLines.length);

  for (let i = 0; i < max; i++) {
    const o = originalLines[i] ?? '';
    const m = modifiedLines[i] ?? '';
    if (o === m) continue;
    if (m && o !== m) {
      additions.push({ line: i + 1, text: m });
    }
    if (o && o !== m) {
      removals.push({ line: i + 1, text: o });
    }
  }

  const parts: string[] = [];
  if (additions.length > 0) {
    parts.push(
      `${additions.length} line${additions.length === 1 ? '' : 's'} added`
    );
  }
  if (removals.length > 0) {
    parts.push(
      `${removals.length} line${removals.length === 1 ? '' : 's'} removed`
    );
  }

  return {
    filePath,
    relativePath: rel,
    additions: additions.slice(0, 8),
    removals: removals.slice(0, 8),
    summary: parts.length > 0 ? parts.join(', ') : 'File modified',
  };
}

export function formatChangeSummaryMarkdown(
  summaries: FileChangeSummary[]
): string {
  if (summaries.length === 0) return '';

  const lines = ['### What will change', ''];

  for (const s of summaries) {
    lines.push(`**File:** \`${s.relativePath}\``);
    lines.push(`**Where:** ${s.summary}`);

    if (s.additions.length > 0) {
      lines.push('', '**Added:**');
      for (const add of s.additions.slice(0, 5)) {
        lines.push(`- Line ${add.line}: \`${add.text.trim()}\``);
      }
    }

    if (s.removals.length > 0) {
      lines.push('', '**Removed:**');
      for (const rem of s.removals.slice(0, 5)) {
        lines.push(`- Line ${rem.line}: \`${rem.text.trim()}\``);
      }
    }

    lines.push('');
  }

  lines.push('_Open the **Code Changes Review** panel beside the editor to see the full side-by-side diff._');
  return lines.join('\n');
}
