import * as fs from 'fs';
import * as path from 'path';
import { parseSimpleFsTask } from './simpleFsTasks.js';

/** Resolve a relative path against workspace, stripping a redundant workspace folder prefix. */
export function normalizePathForWorkspace(workspace: string, filePath: string): string {
  if (!filePath) return filePath;
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }

  let relative = filePath.replace(/^\.\/+/, '');
  const base = path.basename(workspace);
  if (relative === base) {
    return path.resolve(workspace);
  }
  if (relative.startsWith(`${base}/`)) {
    relative = relative.slice(base.length + 1);
  }
  return path.resolve(workspace, relative);
}

function findFileByBasename(workspace: string, basename: string, maxDepth = 6): string | null {
  if (!basename || basename.includes('/') || basename.includes('\\')) return null;

  const skipDirs = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.coding-ai']);
  const stack: Array<{ dir: string; depth: number }> = [{ dir: workspace, depth: 0 }];
  let match: string | null = null;

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name === basename) {
        // Ambiguous: more than one file shares this basename. Refuse to guess
        // rather than silently editing an arbitrary file.
        if (match !== null) return null;
        match = fullPath;
      }
      if (entry.isDirectory() && current.depth < maxDepth && !skipDirs.has(entry.name)) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return match;
}

export interface RelevantChunkRef {
  filePath?: string;
  symbolName?: string;
  score?: number;
}

/**
 * Resolve which workspace files an agent task should edit.
 * Paths named in the task description take priority over bulk context.files lists.
 */
export function resolveTargetFiles(
  description: string,
  context: {
    workspacePath?: string;
    files?: string[];
    relevantChunks?: RelevantChunkRef[];
  }
): string[] {
  const workspace = path.resolve(context.workspacePath || process.cwd());
  const fromDescription = new Set<string>();
  const found = new Set<string>();

  const add = (filePath: string, target: Set<string> = found) => {
    if (!filePath) return;
    const resolved = normalizePathForWorkspace(workspace, filePath);
    if (resolved.startsWith(workspace + path.sep) || resolved === workspace) {
      target.add(resolved);
    }
  };

  const fsTask = parseSimpleFsTask(description);
  if (fsTask) {
    add(fsTask.relativePath, fromDescription);
    return [...fromDescription].slice(0, 5);
  }

  const pathPattern = /(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java)\b/gi;
  const pathMatches = [...description.matchAll(pathPattern)];
  for (const match of pathMatches) {
    add(match[0], fromDescription);
  }

  if (pathMatches.length === 0) {
    const bareFilePattern = /\b([\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java))\b/gi;
    for (const match of description.matchAll(bareFilePattern)) {
      const basename = match[1];
      const discovered = findFileByBasename(workspace, basename);
      add(discovered ?? basename, fromDescription);
    }
  }

  if (fromDescription.size > 0) {
    return [...fromDescription].slice(0, 5);
  }

  const contextFiles = (context.files || []).filter((f): f is string => typeof f === 'string');
  const descLower = description.toLowerCase();

  for (const file of contextFiles) {
    const base = path.basename(file).toLowerCase();
    if (descLower.includes(base)) {
      add(file);
    }
  }
  if (found.size > 0) {
    return [...found].slice(0, 5);
  }

  if (contextFiles.length > 0 && contextFiles.length <= 5) {
    for (const file of contextFiles) {
      add(file);
    }
    return [...found].slice(0, 5);
  }

  const chunks = [...(context.relevantChunks || [])].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  for (const chunk of chunks.slice(0, 5)) {
    if (!chunk.filePath) continue;
    const symbol = chunk.symbolName?.toLowerCase();
    if (
      !symbol ||
      descLower.includes(symbol) ||
      descLower.includes(path.basename(chunk.filePath).toLowerCase())
    ) {
      add(chunk.filePath);
    }
  }

  if (found.size === 0 && chunks[0]?.filePath) {
    add(chunks[0].filePath);
  }

  if (found.size === 0) {
    for (const file of contextFiles.slice(0, 3)) {
      add(file);
    }
  }

  return [...found].slice(0, 5);
}
