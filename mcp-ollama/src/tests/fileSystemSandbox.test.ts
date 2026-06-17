import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileSystemTool } from '../tools/FileSystemTool.js';

const NODE = process.execPath;

function tool(mode: 'full' | 'restricted' | 'read-only'): FileSystemTool {
  const t = new FileSystemTool();
  t.setRunMode(mode);
  return t;
}

describe('FileSystemTool run-mode write gating', () => {
  it('read-only blocks writes', async () => {
    await assert.rejects(() => tool('read-only').writeFile('x.txt', 'hi'), /read-only/);
  });

  it('restricted blocks writes (matches documented behavior)', async () => {
    await assert.rejects(() => tool('restricted').writeFile('x.txt', 'hi'), /restricted/);
  });

  it('restricted blocks deleteFile (previously ungated)', async () => {
    await assert.rejects(() => tool('restricted').deleteFile('x.txt'), /restricted/);
  });

  it('read-only blocks createDirectory and copyFile', async () => {
    await assert.rejects(() => tool('read-only').createDirectory('d'), /read-only/);
    await assert.rejects(() => tool('read-only').copyFile('a', 'b'), /read-only/);
  });
});

describe('FileSystemTool command gating', () => {
  it('read-only blocks all command execution', async () => {
    await assert.rejects(() => tool('read-only').executeCommand('echo', ['hi']), /read-only/);
  });

  it('restricted blocks non-allowlisted commands', async () => {
    await assert.rejects(() => tool('restricted').executeCommand('rm', ['-rf', '.']), /allowlist/);
  });

  it('restricted blocks interpreter inline-eval escapes', async () => {
    await assert.rejects(
      () => tool('restricted').executeCommand(NODE, ['-e', 'process.exit(0)']),
      /Inline code execution/
    );
  });

  it('full mode permits inline eval (no escape guard)', async () => {
    const res = await tool('full').executeCommand(NODE, ['-e', 'console.log("ok")']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /ok/);
  });

  it('rejects shell metacharacters in the command name', async () => {
    await assert.rejects(() => tool('full').executeCommand('foo; rm -rf /', []), /Unsafe command/);
  });
});

describe('FileSystemTool command limits', () => {
  it('enforces a timeout and reports exit code 124', async () => {
    const res = await tool('full').executeCommand(
      NODE,
      ['-e', 'setTimeout(() => {}, 10000)'],
      undefined,
      { timeoutMs: 1000 }
    );
    assert.equal(res.timedOut, true);
    assert.equal(res.exitCode, 124);
  });

  it('caps output and marks it truncated', async () => {
    const res = await tool('full').executeCommand(
      NODE,
      ['-e', "for (let i = 0; i < 1e6; i++) console.log('x'.repeat(80))"],
      undefined,
      { maxOutputBytes: 5000 }
    );
    assert.equal(res.truncated, true);
    assert.match(res.stdout + res.stderr, /output truncated/);
  });
});
