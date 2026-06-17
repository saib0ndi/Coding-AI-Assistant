/**
 * Lightweight whole-project reader: builds a compact, LLM-friendly summary of a
 * workspace (file tree, manifest info, key entry files) for planning context.
 */
import * as fs from 'fs';
import * as path from 'path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'coverage',
  '.coding-ai', '.vscode', '.idea', '__pycache__', '.next', 'vendor',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.rb', '.php', '.cs', '.c', '.cpp', '.h', '.json', '.md',
  '.yml', '.yaml', '.toml', '.sh',
]);

export interface ProjectFileEntry {
  relativePath: string;
  size: number;
}

export interface ProjectSummary {
  workspacePath: string;
  fileCount: number;
  files: ProjectFileEntry[];
  topLevelDirs: string[];
  manifest: {
    name?: string;
    description?: string;
    dependencies?: string[];
    devDependencies?: string[];
    scripts?: string[];
  } | null;
  languages: Record<string, number>;
  truncated: boolean;
}

/** Walk the workspace and collect a bounded file inventory. */
export function scanProject(
  workspacePath: string,
  options: { maxFiles?: number; maxDepth?: number } = {}
): ProjectSummary {
  const maxFiles = options.maxFiles ?? 500;
  const maxDepth = options.maxDepth ?? 6;
  const workspace = path.resolve(workspacePath);

  const files: ProjectFileEntry[] = [];
  const languages: Record<string, number> = {};
  let truncated = false;

  const stack: Array<{ dir: string; depth: number }> = [{ dir: workspace, depth: 0 }];
  while (stack.length > 0 && files.length < maxFiles) {
    const { dir, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) {
          stack.push({ dir: fullPath, depth: depth + 1 });
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      let size = 0;
      try {
        size = fs.statSync(fullPath).size;
      } catch {
        continue;
      }
      files.push({ relativePath: path.relative(workspace, fullPath), size });
      languages[ext] = (languages[ext] || 0) + 1;
    }
  }

  let topLevelDirs: string[] = [];
  try {
    topLevelDirs = fs
      .readdirSync(workspace, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    // unreadable workspace root; leave empty
  }

  return {
    workspacePath: workspace,
    fileCount: files.length,
    files,
    topLevelDirs,
    manifest: readManifest(workspace),
    languages,
    truncated,
  };
}

function readManifest(workspace: string): ProjectSummary['manifest'] {
  const pkgPath = path.join(workspace, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return {
      name: pkg.name,
      description: pkg.description,
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependencies: Object.keys(pkg.devDependencies || {}),
      scripts: Object.keys(pkg.scripts || {}),
    };
  } catch {
    return null;
  }
}

/** Render the project summary as compact text for an LLM planning prompt. */
export function renderProjectSummary(summary: ProjectSummary, maxChars = 4000): string {
  const lines: string[] = [];

  if (summary.manifest) {
    lines.push(`Project: ${summary.manifest.name || 'unknown'}`);
    if (summary.manifest.description) lines.push(`Description: ${summary.manifest.description}`);
    if (summary.manifest.dependencies?.length) {
      lines.push(`Dependencies: ${summary.manifest.dependencies.slice(0, 25).join(', ')}`);
    }
    if (summary.manifest.scripts?.length) {
      lines.push(`Scripts: ${summary.manifest.scripts.slice(0, 15).join(', ')}`);
    }
  }

  const langs = Object.entries(summary.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([ext, count]) => `${ext} (${count})`)
    .join(', ');
  if (langs) lines.push(`Languages: ${langs}`);
  if (summary.topLevelDirs.length) lines.push(`Top-level dirs: ${summary.topLevelDirs.join(', ')}`);

  lines.push(`Files (${summary.fileCount}${summary.truncated ? '+, truncated' : ''}):`);
  const sorted = [...summary.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const file of sorted) {
    const next = `  ${file.relativePath}`;
    if (lines.join('\n').length + next.length > maxChars) {
      lines.push('  ... (more files omitted)');
      break;
    }
    lines.push(next);
  }

  return lines.join('\n');
}

/** Read selected files (bounded) so the planner can see real content. */
export function readKeyFiles(
  workspacePath: string,
  relativePaths: string[],
  maxCharsPerFile = 3000
): Array<{ relativePath: string; content: string }> {
  const workspace = path.resolve(workspacePath);
  const results: Array<{ relativePath: string; content: string }> = [];

  for (const rel of relativePaths.slice(0, 10)) {
    const fullPath = path.resolve(workspace, rel);
    if (!fullPath.startsWith(workspace + path.sep)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      results.push({
        relativePath: rel,
        content: content.length > maxCharsPerFile
          ? `${content.slice(0, maxCharsPerFile)}\n... (truncated)`
          : content,
      });
    } catch {
      // skip unreadable files
    }
  }

  return results;
}
