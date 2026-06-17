import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SymbolResolver } from '../indexing/SymbolResolver.js';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import type { IndexedChunk } from '../indexing/types.js';

describe('Symbol Resolution and Interlinking', () => {
  const mockChunks: IndexedChunk[] = [
    {
      id: 'src/auth.ts:class:AuthService:1',
      filePath: 'src/auth.ts',
      language: 'typescript',
      symbolName: 'AuthService',
      symbolType: 'class',
      startLine: 1,
      endLine: 10,
      content: 'export class AuthService {\n  constructor(private logger: Logger) {}\n  login() {\n    this.logger.info("logging in");\n  }\n}',
      contentHash: 'hash1',
      embedding: [],
    },
    {
      id: 'src/logger.ts:class:Logger:1',
      filePath: 'src/logger.ts',
      language: 'typescript',
      symbolName: 'Logger',
      symbolType: 'class',
      startLine: 1,
      endLine: 8,
      content: 'export class Logger {\n  info(msg: string) {\n    console.log(msg);\n  }\n}',
      contentHash: 'hash2',
      embedding: [],
    },
    {
      id: 'src/database.ts:function:connectDb:1',
      filePath: 'src/database.ts',
      language: 'typescript',
      symbolName: 'connectDb',
      symbolType: 'function',
      startLine: 1,
      endLine: 6,
      content: 'export function connectDb() {\n  const log = new Logger();\n  log.info("DB connected");\n}',
      contentHash: 'hash3',
      embedding: [],
    },
  ];

  it('SymbolResolver: should resolve direct referenced symbol definitions', () => {
    const resolver = new SymbolResolver(mockChunks);
    const authChunk = mockChunks.find(c => c.symbolName === 'AuthService')!;
    
    const resolved = resolver.resolveReferences(authChunk, mockChunks, 1);
    
    assert.ok(resolved.has('src/logger.ts:Logger'), 'Should resolve Logger from AuthService');
    const resolvedSymbol = resolved.get('src/logger.ts:Logger')!;
    assert.strictEqual(resolvedSymbol.symbolName, 'Logger');
    assert.strictEqual(resolvedSymbol.definitionChunk.filePath, 'src/logger.ts');
    assert.strictEqual(resolvedSymbol.referencedBy, 'AuthService');
  });

  it('EnhancedContextManager: populateFromIndexer should populate symbolTable and dependencyGraph correctly', () => {
    const manager = new EnhancedContextManager();
    manager.populateFromIndexer(mockChunks);

    const loggerRef = manager.getSymbolUsages('Logger');
    assert.ok(loggerRef, 'Logger should be registered in symbolTable');
    assert.strictEqual(loggerRef.definition?.file, 'src/logger.ts');
    assert.strictEqual(loggerRef.type, 'class');

    // Usages check
    assert.strictEqual(loggerRef.usages.length, 2, 'Logger should be used in 2 files');
    const filesUsingLogger = loggerRef.usages.map(u => u.file);
    assert.ok(filesUsingLogger.includes('src/auth.ts'), 'AuthService chunk should register as usage');
    assert.ok(filesUsingLogger.includes('src/database.ts'), 'connectDb chunk should register as usage');

    // DependencyGraph check
    const authDep = manager.getDependencyInfo('src/auth.ts');
    const dbDep = manager.getDependencyInfo('src/database.ts');

    assert.ok(authDep, 'Dependency node for src/auth.ts should exist');
    assert.ok(authDep.dependencies.includes('src/logger.ts'), 'src/auth.ts should depend on src/logger.ts');

    assert.ok(dbDep, 'Dependency node for src/database.ts should exist');
    assert.ok(dbDep.dependencies.includes('src/logger.ts'), 'src/database.ts should depend on src/logger.ts');
  });

  it('SymbolResolver: should resolve camelCase and snake_case instances to PascalCase definitions', () => {
    const customChunks: IndexedChunk[] = [
      {
        id: 'src/user.ts:class:UserService:1',
        filePath: 'src/user.ts',
        language: 'typescript',
        symbolName: 'UserService',
        symbolType: 'class',
        startLine: 1,
        endLine: 10,
        content: 'export class UserService {}',
        contentHash: 'hashU',
        embedding: [],
      },
      {
        id: 'src/app.ts:class:App:1',
        filePath: 'src/app.ts',
        language: 'typescript',
        symbolName: 'App',
        symbolType: 'class',
        startLine: 1,
        endLine: 15,
        content: 'const userService = new UserService();\nconst user_service = new UserService();',
        contentHash: 'hashApp',
        embedding: [],
      }
    ];

    const resolver = new SymbolResolver(customChunks);
    const appChunk = customChunks.find(c => c.symbolName === 'App')!;
    const resolved = resolver.resolveReferences(appChunk, customChunks, 1);

    assert.ok(resolved.has('src/user.ts:UserService'), 'Should resolve UserService class from lowercase/camelCase and snake_case instances');
    const resolvedSymbol = resolved.get('src/user.ts:UserService')!;
    assert.strictEqual(resolvedSymbol.symbolName, 'UserService');
    assert.strictEqual(resolvedSymbol.definitionChunk.filePath, 'src/user.ts');
  });
});
