import type { IndexedChunk } from './types.js';

export interface ResolvedSymbolContext {
  symbolName: string;
  definitionChunk: IndexedChunk;
  referencedBy: string;
}

export class SymbolResolver {
  private symbolTable = new Map<string, IndexedChunk>();

  constructor(chunks: IndexedChunk[]) {
    // Build a symbol table mapping symbol names to their definition chunks.
    // Filter out generic file-level chunks or chunks without valid symbol names.
    for (const chunk of chunks) {
      if (chunk.symbolType && chunk.symbolType !== 'file' && chunk.symbolName) {
        this.symbolTable.set(chunk.symbolName, chunk);
      }
    }
  }

  getSymbolChunk(name: string): IndexedChunk | undefined {
    return this.symbolTable.get(name);
  }

  static getPotentialSymbolNames(word: string): string[] {
    const names = [word];
    
    // 1. camelCase/lowercase to PascalCase (e.g. authService -> AuthService, logger -> Logger)
    const pascal = word.charAt(0).toUpperCase() + word.slice(1);
    if (pascal !== word) {
      names.push(pascal);
    }
    
    // 2. snake_case to PascalCase (e.g. auth_service -> AuthService)
    if (word.includes('_')) {
      const snakeToPascal = word
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
      if (snakeToPascal !== word && !names.includes(snakeToPascal)) {
        names.push(snakeToPascal);
      }
    }
    
    return names;
  }

  /**
   * For a given starting chunk, resolve the symbols it references.
   * Recursively resolve up to a certain depth (e.g., maxDepth = 2) to get the call chain context.
   */
  resolveReferences(
    startChunk: IndexedChunk,
    allChunks: IndexedChunk[],
    maxDepth = 2,
    resolved = new Map<string, ResolvedSymbolContext>()
  ): Map<string, ResolvedSymbolContext> {
    if (maxDepth <= 0) return resolved;

    const content = startChunk.content;
    if (!content) return resolved;

    // Simple regex to extract identifiers/words
    const words = content.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    const uniqueWords = new Set(words);

    // List of common keywords across TypeScript, JavaScript, Python, Go, Rust, Java to ignore
    const keywords = new Set([
      'function', 'class', 'const', 'let', 'var', 'import', 'export', 'from',
      'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
      'continue', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this',
      'super', 'extends', 'implements', 'interface', 'type', 'namespace',
      'public', 'private', 'protected', 'static', 'readonly', 'async', 'await',
      'yield', 'def', 'elif', 'print', 'self', 'lambda', 'with', 'as', 'assert',
      'pass', 'global', 'nonlocal', 'package', 'go', 'chan', 'select', 'struct',
      'func', 'map', 'range', 'pub', 'use', 'mod', 'fn', 'mut', 'impl', 'trait',
      'where', 'unsafe', 'match', 'string', 'number', 'boolean', 'any', 'void'
    ]);

    for (const word of uniqueWords) {
      if (keywords.has(word)) continue;
      if (word === startChunk.symbolName) continue; // Skip self reference

      const potentialNames = SymbolResolver.getPotentialSymbolNames(word);
      let targetChunk: IndexedChunk | undefined;
      let matchedName = word;

      for (const name of potentialNames) {
        targetChunk = this.symbolTable.get(name);
        if (targetChunk) {
          matchedName = name;
          break;
        }
      }

      if (targetChunk && targetChunk.id !== startChunk.id) {
        // If it is in the same file and very close (e.g. within 25 lines), skip it to avoid redundancy
        if (targetChunk.filePath === startChunk.filePath && Math.abs(targetChunk.startLine - startChunk.startLine) < 25) {
          continue;
        }

        const resolvedKey = `${targetChunk.filePath}:${targetChunk.symbolName}`;
        if (!resolved.has(resolvedKey)) {
          resolved.set(resolvedKey, {
            symbolName: matchedName,
            definitionChunk: targetChunk,
            referencedBy: startChunk.symbolName || startChunk.filePath,
          });

          // Recursively resolve references of the dependency symbol (transitive reference)
          this.resolveReferences(targetChunk, allChunks, maxDepth - 1, resolved);
        }
      }
    }

    return resolved;
  }
}
