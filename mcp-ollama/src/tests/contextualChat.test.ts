import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('EnhancedContextManager', () => {
  let manager: EnhancedContextManager;
  const tempDir = './temp-test-project';

  beforeEach(async () => {
    manager = new EnhancedContextManager();
    // Stub out codebase indexing to prevent external Ollama API calls in unit tests
    (manager as any).vectorStore.indexCodebase = async () => {};
    // Ensure temporary directory is clean
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  after(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should track conversation history correctly', async () => {
    // Add messages
    for (let i = 1; i <= 15; i++) {
      await manager.parseNaturalLanguage(`Message number ${i}`);
    }

    const context = manager.getConversationContext();
    // Should keep last 5 messages in conversational context slice
    assert.strictEqual(context.length, 5);
    assert.strictEqual(context[4], 'Message number 15');
    assert.strictEqual(context[0], 'Message number 11');
  });

  it('should extract TypeScript and JavaScript symbols', async () => {
    const tsCode = `
      export class TestClass {
        constructor() {}
      }
      export function testFunction() {
        console.log("hello");
      }
      const arrowFunc = () => {
        return 42;
      };
    `;

    const files = [
      { path: 'testFile.ts', content: tsCode, language: 'typescript' }
    ];

    await manager.buildSymbolTable(files);

    const testClassRef = manager.getSymbolUsages('TestClass');
    const testFuncRef = manager.getSymbolUsages('testFunction');

    assert.ok(testClassRef);
    assert.strictEqual(testClassRef?.type, 'class');
    assert.strictEqual(testClassRef?.definition?.file, 'testFile.ts');

    assert.ok(testFuncRef);
    assert.strictEqual(testFuncRef?.type, 'function');
  });

  it('should extract Python symbols', async () => {
    const pyCode = `
class PythonClass:
    def __init__(self):
        pass

def py_function():
    return True
`;

    const files = [
      { path: 'testFile.py', content: pyCode, language: 'python' }
    ];

    await manager.buildSymbolTable(files);

    const pyClassRef = manager.getSymbolUsages('PythonClass');
    const pyFuncRef = manager.getSymbolUsages('py_function');

    assert.ok(pyClassRef);
    assert.strictEqual(pyClassRef?.type, 'class');
    assert.strictEqual(pyClassRef?.definition?.file, 'testFile.py');

    assert.ok(pyFuncRef);
    assert.strictEqual(pyFuncRef?.type, 'function');
  });

  it('should reset state correctly', async () => {
    await manager.parseNaturalLanguage('hello query');
    const contextBefore = manager.getConversationContext();
    assert.strictEqual(contextBefore.length, 1);

    manager.resetState();
    const contextAfter = manager.getConversationContext();
    assert.strictEqual(contextAfter.length, 0);
  });

  it('should parse package.json dependencies', async () => {
    const mockPackageJson = {
      dependencies: {
        "express": "^4.18.2"
      },
      devDependencies: {
        "typescript": "^5.0.0"
      }
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(mockPackageJson));

    const graph = await manager.buildDependencyGraph(tempDir);
    const expressDep = manager.getDependencyInfo('express');
    const tsDep = manager.getDependencyInfo('typescript');

    assert.ok(expressDep);
    assert.strictEqual(expressDep?.name, 'express');
    assert.strictEqual(expressDep?.version, '^4.18.2');

    assert.ok(tsDep);
    assert.strictEqual(tsDep?.name, 'typescript');
    assert.strictEqual(tsDep?.version, '^5.0.0');
  });
});
