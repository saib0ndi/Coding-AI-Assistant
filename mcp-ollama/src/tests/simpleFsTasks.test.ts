import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseMkdirTask,
  parseCreateFileTask,
  parseSimpleFsTask,
  resolveMkdirPath,
  executeMkdirTask,
  executeCreateFileTask,
  buildMkdirAgentResult,
  buildCreateFileAgentResult,
} from '../agents/simpleFsTasks.js';

describe('parseMkdirTask', () => {
  it('parses "folder inside parent with the name child"', () => {
    const task = parseMkdirTask('create a folder inside mcp-ollama with the name sai');
    assert.deepEqual(task, { type: 'mkdir', relativePath: 'mcp-ollama/sai' });
  });

  it('parses mkdir with path', () => {
    const task = parseMkdirTask('mkdir src/utils');
    assert.deepEqual(task, { type: 'mkdir', relativePath: 'src/utils' });
  });

  it('parses directory keyword', () => {
    const task = parseMkdirTask('create directory called logs');
    assert.deepEqual(task, { type: 'mkdir', relativePath: 'logs' });
  });

  it('returns null for code tasks', () => {
    assert.equal(parseMkdirTask('implement login handler'), null);
  });
});

describe('parseCreateFileTask', () => {
  it('parses "file inside parent with the name child"', () => {
    const task = parseCreateFileTask('create a file inside mcp-ollama with the name sai');
    assert.deepEqual(task, { type: 'create_file', relativePath: 'mcp-ollama/sai', content: '' });
  });

  it('parses "[filename] file inside [parent]" (preceding file keyword with optional "the")', () => {
    const task = parseCreateFileTask('create a sai.ts file inside the mcp-ollama');
    assert.deepEqual(task, { type: 'create_file', relativePath: 'mcp-ollama/sai.ts', content: '' });
  });

  it('parses touch command', () => {
    const task = parseCreateFileTask('touch src/index.ts');
    assert.deepEqual(task, { type: 'create_file', relativePath: 'src/index.ts', content: '' });
  });

  it('returns null for code tasks', () => {
    assert.equal(parseCreateFileTask('implement login handler'), null);
  });
});

describe('parseSimpleFsTask', () => {
  it('prefers mkdir over file when both could match', () => {
    assert.equal(parseSimpleFsTask('create a folder inside mcp-ollama with the name sai')?.type, 'mkdir');
    assert.equal(parseSimpleFsTask('create a file inside mcp-ollama with the name sai')?.type, 'create_file');
  });
});

describe('executeCreateFileTask', () => {
  it('creates nested file under workspace', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-file-'));
    const task = { type: 'create_file' as const, relativePath: 'mcp-ollama/sai', content: '' };
    const fullPath = path.join(workspace, 'mcp-ollama/sai');

    const outcome = executeCreateFileTask(task, workspace);
    assert.equal(outcome.success, true);
    assert.equal(outcome.fullPath, fullPath);
    assert.equal(outcome.created, true);
    assert.ok(fs.existsSync(fullPath));

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('buildCreateFileAgentResult reports created file', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-file-result-'));
    const task = { type: 'create_file' as const, relativePath: 'mcp-ollama/sai', content: '' };

    const result = buildCreateFileAgentResult('t2', task, workspace) as { success: boolean; summary: string };
    assert.equal(result.success, true);
    assert.match(result.summary, /Created file/);

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});

describe('executeMkdirTask', () => {
  it('creates nested directory under workspace', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mkdir-task-'));
    const task = { type: 'mkdir' as const, relativePath: 'mcp-ollama/sai' };
    const fullPath = resolveMkdirPath(task.relativePath, workspace);

    const outcome = executeMkdirTask(task, workspace);
    assert.equal(outcome.success, true);
    assert.equal(outcome.fullPath, fullPath);
    assert.equal(outcome.created, true);
    assert.ok(fs.existsSync(fullPath));

    fs.rmSync(fullPath, { recursive: true, force: true });
    const result = buildMkdirAgentResult('t1', task, workspace) as { success: boolean; summary: string };
    assert.equal(result.success, true);
    assert.match(result.summary, /Created directory/);

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});
