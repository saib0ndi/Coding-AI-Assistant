import * as fs from 'fs';
import * as path from 'path';

export interface MkdirTask {
  type: 'mkdir';
  relativePath: string;
}

export interface CreateFileTask {
  type: 'create_file';
  relativePath: string;
  content: string;
}

export type SimpleFsTask = MkdirTask | CreateFileTask;

function parseInsideWithName(
  text: string,
  kind: 'folder' | 'file'
): string | null {
  const kindPattern = kind === 'folder' ? '(?:folder|directory|dir)' : 'file';

  const insideWithName = text.match(
    new RegExp(
      `\\b${kindPattern}\\s+(?:inside|in|under)\\s+(?:the\\s+)?(\\S+)\\s+(?:with\\s+(?:the\\s+)?name|named|called)\\s+([A-Za-z0-9_.-]+)`,
      'i'
    )
  );
  if (insideWithName) {
    return `${insideWithName[1]}/${insideWithName[2]}`;
  }

  const nameInParent = text.match(
    new RegExp(
      `\\b${kindPattern}\\s+(?:(?:named|called|with\\s+(?:the\\s+)?name)\\s+)?([A-Za-z0-9_.-]+)\\s+(?:inside|in|under)\\s+(?:the\\s+)?(\\S+)`,
      'i'
    )
  );
  if (nameInParent) {
    return `${nameInParent[2]}/${nameInParent[1]}`;
  }

  const fileInside = text.match(
    new RegExp(
      `\\b([A-Za-z0-9_.-]+)\\s+${kindPattern}\\s+(?:inside|in|under)\\s+(?:the\\s+)?(\\S+)`,
      'i'
    )
  );
  if (fileInside) {
    return `${fileInside[2]}/${fileInside[1]}`;
  }

  return null;
}

/** Detect simple directory-creation requests (no LLM needed). */
export function parseMkdirTask(description: string): MkdirTask | null {
  const text = description.trim();
  const lower = text.toLowerCase();

  const mentionsDir =
    /\b(folder|directory|dir)\b/.test(lower) || lower.startsWith('mkdir');
  const mentionsCreate = /\b(create|make|add|mkdir)\b/.test(lower);

  if (!mentionsDir || !mentionsCreate) {
    return null;
  }

  const mkdirMatch = text.match(/^mkdir\s+(\S+)/i);
  if (mkdirMatch) {
    return { type: 'mkdir', relativePath: mkdirMatch[1] };
  }

  const nested = parseInsideWithName(text, 'folder');
  if (nested) {
    return { type: 'mkdir', relativePath: nested };
  }

  const legacyPatterns = [
    /create.*(?:directory|folder|dir).*(?:name.*of|called|named)\s+(\w+)/i,
    /create.*(?:directory|folder|dir)\s+(\w+)/i,
    /make.*(?:directory|folder|dir)\s+(\w+)/i,
  ];
  for (const pattern of legacyPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return { type: 'mkdir', relativePath: match[1] };
    }
  }

  return null;
}

/** Detect simple file-creation requests (no LLM needed). */
export function parseCreateFileTask(description: string): CreateFileTask | null {
  const text = description.trim();
  const lower = text.toLowerCase();

  const mentionsFile = /\bfile\b/.test(lower) || lower.startsWith('touch ');
  const mentionsCreate = /\b(create|make|add|touch|write)\b/.test(lower);

  if (!mentionsFile || !mentionsCreate) {
    return null;
  }

  const touchMatch = text.match(/^touch\s+(\S+)/i);
  if (touchMatch) {
    return { type: 'create_file', relativePath: touchMatch[1], content: '' };
  }

  const nested = parseInsideWithName(text, 'file');
  if (nested) {
    return { type: 'create_file', relativePath: nested, content: '' };
  }

  const namedFile = text.match(
    /\bcreate\s+(?:a\s+)?file\s+(?:named|called|with\s+(?:the\s+)?name)\s+([A-Za-z0-9_.-]+)/i
  );
  if (namedFile) {
    return { type: 'create_file', relativePath: namedFile[1], content: '' };
  }

  return null;
}

export function parseSimpleFsTask(description: string): SimpleFsTask | null {
  return parseMkdirTask(description) ?? parseCreateFileTask(description);
}

export function resolveWorkspacePath(relativePath: string, workspacePath: string): string {
  const workspace = path.resolve(workspacePath);
  const normalized = relativePath.replace(/^\.\/+/, '');
  const resolved = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(workspace, normalized);

  if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
    throw new Error(`Path outside workspace: ${relativePath}`);
  }
  return resolved;
}

/** @deprecated Use resolveWorkspacePath */
export const resolveMkdirPath = resolveWorkspacePath;

export function executeMkdirTask(
  task: MkdirTask,
  workspacePath: string
): { success: boolean; fullPath: string; created: boolean; error?: string } {
  try {
    const fullPath = resolveWorkspacePath(task.relativePath, workspacePath);
    const existed = fs.existsSync(fullPath);
    if (!existed) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return { success: true, fullPath, created: !existed };
  } catch (error) {
    return {
      success: false,
      fullPath: task.relativePath,
      created: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function executeCreateFileTask(
  task: CreateFileTask,
  workspacePath: string
): { success: boolean; fullPath: string; created: boolean; error?: string } {
  try {
    const fullPath = resolveWorkspacePath(task.relativePath, workspacePath);
    const existed = fs.existsSync(fullPath);
    if (existed) {
      return { success: true, fullPath, created: false };
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, task.content, 'utf8');
    return { success: true, fullPath, created: true };
  } catch (error) {
    return {
      success: false,
      fullPath: task.relativePath,
      created: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildMkdirAgentResult(
  taskId: string,
  task: MkdirTask,
  workspacePath: string
): Record<string, unknown> {
  const outcome = executeMkdirTask(task, workspacePath);

  if (!outcome.success) {
    return {
      taskId,
      success: false,
      steps: [{
        id: 'create_dir',
        action: 'create_directory',
        status: 'failed',
        error: outcome.error,
      }],
      summary: `Failed to create directory: ${outcome.error}`,
      filesModified: [],
      error: outcome.error,
      executionTime: 0,
    };
  }

  const label = outcome.created ? 'Created directory' : 'Directory already exists';
  return {
    taskId,
    success: true,
    steps: [{
      id: 'create_dir',
      action: 'create_directory',
      status: 'completed',
      result: { path: outcome.fullPath, created: outcome.created },
    }],
    summary: `${label}: ${outcome.fullPath}`,
    filesModified: [outcome.fullPath],
    executionTime: 0,
    autonomous: false,
  };
}

export function buildCreateFileAgentResult(
  taskId: string,
  task: CreateFileTask,
  workspacePath: string
): Record<string, unknown> {
  const outcome = executeCreateFileTask(task, workspacePath);

  if (!outcome.success) {
    return {
      taskId,
      success: false,
      steps: [{
        id: 'create_file',
        action: 'create_file',
        status: 'failed',
        error: outcome.error,
      }],
      summary: `Failed to create file: ${outcome.error}`,
      filesModified: [],
      error: outcome.error,
      executionTime: 0,
    };
  }

  const label = outcome.created ? 'Created file' : 'File already exists';
  return {
    taskId,
    success: true,
    steps: [{
      id: 'create_file',
      action: 'create_file',
      status: 'completed',
      result: { path: outcome.fullPath, created: outcome.created },
    }],
    summary: `${label}: ${outcome.fullPath}`,
    filesModified: outcome.created ? [outcome.fullPath] : [],
    executionTime: 0,
    autonomous: false,
  };
}

export function buildSimpleFsAgentResult(
  taskId: string,
  task: SimpleFsTask,
  workspacePath: string
): Record<string, unknown> {
  if (task.type === 'mkdir') {
    return buildMkdirAgentResult(taskId, task, workspacePath);
  }
  return buildCreateFileAgentResult(taskId, task, workspacePath);
}
