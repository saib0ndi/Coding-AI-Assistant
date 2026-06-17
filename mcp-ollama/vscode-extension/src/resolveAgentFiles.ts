import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolve target files for agent tasks from the task description and editor context.
 * Prefer explicit paths in the description over bulk workspace scans.
 */
export async function resolveAgentFiles(description: string, workspacePath: string): Promise<string[]> {
    const workspace = path.resolve(workspacePath);
    const found = new Set<string>();

    const normalizePath = (filePath: string): string => {
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
    };

    const add = (filePath: string) => {
        if (!filePath) return;
        const resolved = normalizePath(filePath);
        if (resolved.startsWith(workspace + path.sep) || resolved === workspace) {
            found.add(resolved);
        }
    };

    const pathPattern = /(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java)\b/gi;
    const pathMatches = [...description.matchAll(pathPattern)];
    for (const match of pathMatches) {
        add(match[0]);
    }

    if (pathMatches.length === 0) {
        const bareFilePattern = /\b([\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java))\b/gi;
        for (const match of description.matchAll(bareFilePattern)) {
            const basename = match[1];
            const discovered = await findFileInWorkspace(workspace, basename);
            add(discovered ?? basename);
        }
    }

    if (found.size > 0) {
        return [...found].slice(0, 5);
    }

    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active) {
        add(active);
    }

    return [...found].slice(0, 5);
}

async function findFileInWorkspace(workspace: string, basename: string): Promise<string | null> {
    const pattern = new vscode.RelativePattern(workspace, `**/${basename}`);
    const exclude = '{**/node_modules/**,**/dist/**,**/out/**,**/.git/**}';
    const matches = await vscode.workspace.findFiles(pattern, exclude, 5);
    if (matches.length === 0) return null;
    return matches[0].fsPath;
}
