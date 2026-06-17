import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { FileSystemTool } from './FileSystemTool.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('FileSystemTool', () => {
  let tool: FileSystemTool;

  beforeEach(() => {
    tool = new FileSystemTool();
  });

  // Cleanup helper
  after(async () => {
    const filesToClean = ['./test.txt', './source.txt', './destination.txt'];
    for (const f of filesToClean) {
      try {
        await fs.unlink(f);
      } catch {}
    }
    try {
      await fs.rm('./test-dir', { recursive: true, force: true });
    } catch {}
  });

  it('should allow workspace and read file successfully', async () => {
    const testFileContent = 'Hello World!';
    const testFilePath = './test.txt';
    await fs.writeFile(testFilePath, testFileContent);
    tool.allowWorkspace('.');
    const result = await tool.readFile(testFilePath);
    assert.strictEqual(result, testFileContent);
  });

  it('should throw error when trying to read file outside allowed base', async () => {
    const testFilePath = '/etc/passwd';
    await assert.rejects(
      async () => {
        await tool.readFile(testFilePath);
      },
      (err: any) => {
        assert.strictEqual(err.message, `Path traversal detected: ${testFilePath}`);
        return true;
      }
    );
  });

  it('should write file successfully and create directory if needed', async () => {
    const testFileContent = 'Hello World!';
    const testDirPath = './test-dir';
    const testFilePath = path.join(testDirPath, 'test.txt');
    tool.allowWorkspace('.');
    const writeResult = await tool.writeFile(testFilePath, testFileContent);
    assert.strictEqual(writeResult, true);
    await assert.doesNotReject(fs.access(testFilePath));
  });

  it('should list files in directory successfully', async () => {
    const testDirPath = './test-dir';
    const testFile1Path = path.join(testDirPath, 'test1.txt');
    const testFile2Path = path.join(testDirPath, 'test2.txt');
    tool.allowWorkspace('.');
    await fs.mkdir(testDirPath, { recursive: true });
    await fs.writeFile(testFile1Path, 'Hello World!');
    await fs.writeFile(testFile2Path, 'Hello Universe!');
    
    const list = await tool.listFiles(testDirPath);
    assert.ok(list.includes(testFile1Path));
    assert.ok(list.includes(testFile2Path));
  });

  it('should copy file successfully', async () => {
    const sourceFilePath = './source.txt';
    const destinationFilePath = './destination.txt';
    await fs.writeFile(sourceFilePath, 'Hello World!');
    tool.allowWorkspace('.');
    const copyResult = await tool.copyFile(sourceFilePath, destinationFilePath);
    assert.strictEqual(copyResult, true);
    const content = await fs.readFile(destinationFilePath, 'utf-8');
    assert.strictEqual(content, 'Hello World!');
  });

  it('should delete file successfully', async () => {
    const testFilePath = './test.txt';
    await fs.writeFile(testFilePath, 'Hello World!');
    tool.allowWorkspace('.');
    const deleteResult = await tool.deleteFile(testFilePath);
    assert.strictEqual(deleteResult, true);
    await assert.rejects(fs.access(testFilePath));
  });

  it('should execute command successfully', async () => {
    const command = 'echo';
    const args = ['Hello', 'World!'];
    const result = await tool.executeCommand(command, args);
    assert.strictEqual(result.stdout, 'Hello World!\n');
    assert.strictEqual(result.stderr, '');
    assert.strictEqual(result.exitCode, 0);
  });

  it('should throw error when executing command with shell metacharacters', async () => {
    const command = 'echo; rm -rf /';
    await assert.rejects(
      async () => {
        await tool.executeCommand(command, []);
      },
      (err: any) => {
        assert.strictEqual(err.message, `Unsafe command: ${command}`);
        return true;
      }
    );
  });
});
