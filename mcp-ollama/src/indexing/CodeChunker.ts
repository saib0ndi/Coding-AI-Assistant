import { createHash } from 'crypto';
import type { CodeChunk } from './types.js';

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
};

export class CodeChunker {
  static languageFromPath(filePath: string): string {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return EXT_TO_LANG[ext] ?? 'text';
  }

  static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  chunkFile(filePath: string, content: string, language?: string): CodeChunk[] {
    const lang = language ?? CodeChunker.languageFromPath(filePath);
    const symbols = this.extractSymbols(content, lang);
    const chunks: CodeChunk[] = [];

    if (symbols.length === 0 && content.trim().length > 0) {
      chunks.push(this.makeChunk(filePath, lang, 'file', filePath, content, 1, content.split('\n').length));
      return chunks;
    }

    for (const sym of symbols) {
      chunks.push(
        this.makeChunk(filePath, lang, sym.type, sym.name, sym.code, sym.startLine, sym.endLine)
      );
    }

    return chunks;
  }

  private makeChunk(
    filePath: string,
    language: string,
    symbolType: CodeChunk['symbolType'],
    symbolName: string,
    content: string,
    startLine: number,
    endLine: number
  ): CodeChunk {
    const id = `${filePath}:${symbolType}:${symbolName}:${startLine}`;
    return {
      id,
      filePath,
      language,
      symbolName,
      symbolType,
      startLine,
      endLine,
      content,
      contentHash: CodeChunker.hashContent(content),
    };
  }

  private extractSymbols(
    code: string,
    language: string
  ): Array<{ name: string; code: string; type: CodeChunk['symbolType']; startLine: number; endLine: number }> {
    const lines = code.split('\n');
    const out: Array<{ name: string; code: string; type: CodeChunk['symbolType']; startLine: number; endLine: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (language === 'javascript' || language === 'typescript') {
        const funcMatch = line.match(
          /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let)\s+(\w+)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/
        );
        if (funcMatch) {
          const name = funcMatch[1] || funcMatch[2];
          const block = this.extractBraceBlock(lines, i);
          out.push({ name, code: block, type: 'function', startLine: i + 1, endLine: i + block.split('\n').length });
          continue;
        }

        const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
        if (classMatch) {
          const name = classMatch[1];
          const block = this.extractBraceBlock(lines, i);
          out.push({ name, code: block, type: 'class', startLine: i + 1, endLine: i + block.split('\n').length });
        }
      }

      if (language === 'python') {
        const funcMatch = line.match(/def\s+(\w+)/);
        if (funcMatch) {
          const name = funcMatch[1];
          const block = this.extractPythonBlock(lines, i);
          out.push({ name, code: block, type: 'function', startLine: i + 1, endLine: i + block.split('\n').length });
          continue;
        }

        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          const name = classMatch[1];
          const block = this.extractPythonBlock(lines, i);
          out.push({ name, code: block, type: 'class', startLine: i + 1, endLine: i + block.split('\n').length });
        }
      }
    }

    return out;
  }

  private extractBraceBlock(lines: string[], startIndex: number): string {
    const result = [lines[startIndex]];
    let braceCount =
      (lines[startIndex].match(/{/g) || []).length - (lines[startIndex].match(/}/g) || []).length;

    for (let i = startIndex + 1; i < lines.length && braceCount > 0; i++) {
      result.push(lines[i]);
      braceCount += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
    }

    return result.join('\n');
  }

  private extractPythonBlock(lines: string[], startIndex: number): string {
    const result = [lines[startIndex]];
    const baseIndent = lines[startIndex].length - lines[startIndex].trimStart().length;

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        result.push(line);
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent <= baseIndent) break;
      result.push(line);
    }

    return result.join('\n');
  }
}
