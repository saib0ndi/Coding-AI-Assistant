import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTargetFiles } from '../agents/resolveTargetFiles.js';

describe('resolveTargetFiles', () => {
    it('finds files by bare basename in nested directories', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-resolve-'));
        const nestedDir = path.join(workspace, 'src', 'indexing');
        fs.mkdirSync(nestedDir, { recursive: true });
        const target = path.join(nestedDir, 'EmbeddingService.ts');
        fs.writeFileSync(target, 'export function embed() {}');

        const resolved = resolveTargetFiles(
            'Add a comment above embed() in EmbeddingService.ts',
            { workspacePath: workspace }
        );

        assert.deepEqual(resolved, [target]);
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    it('returns target path for simple create-file tasks', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-resolve-fs-'));
        const resolved = resolveTargetFiles(
            'create a file inside mcp-ollama with the name sai',
            { workspacePath: workspace, files: ['/some/unrelated/__init__.py'] }
        );

        assert.deepEqual(resolved, [path.join(workspace, 'mcp-ollama/sai')]);
        fs.rmSync(workspace, { recursive: true, force: true });
    });
});
