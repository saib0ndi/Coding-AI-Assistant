export interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source: string;
  code?: string | number;
}

export interface Symbol {
  name: string;
  kind: string;
  location: { uri: string; range: any };
  containerName?: string | undefined;
}

export class LSPClient {
  private diagnostics = new Map<string, Diagnostic[]>();
  private symbols = new Map<string, Symbol[]>();
  private completionCache = new Map<string, any[]>();
  
  async getDiagnostics(filePath: string, code: string, language: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    
    // Basic syntax checking
    if (language === 'typescript' || language === 'javascript') {
      diagnostics.push(...this.checkJSTS(code));
    } else if (language === 'python') {
      diagnostics.push(...this.checkPython(code));
    }
    
    this.diagnostics.set(filePath, diagnostics);
    return diagnostics;
  }
  
  private checkJSTS(code: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
      // Enhanced syntax and style checking
      const checks = [
        {
          condition: line.includes('console.log') && !line.includes(';'),
          message: 'Missing semicolon',
          severity: 'warning' as const,
          code: 'missing-semicolon'
        },
        {
          condition: line.includes('var '),
          message: 'Use let or const instead of var',
          severity: 'warning' as const,
          code: 'no-var'
        },
        {
          condition: line.match(/==\s*(?:true|false|null|undefined)/),
          message: 'Use strict equality (===) instead of loose equality (==)',
          severity: 'warning' as const,
          code: 'strict-equality'
        },
        {
          condition: line.includes('eval('),
          message: 'Avoid using eval() - security risk',
          severity: 'error' as const,
          code: 'no-eval'
        },
        {
          condition: line.match(/function\s*\([^)]*\)\s*\{\s*$/),
          message: 'Consider using arrow functions for consistency',
          severity: 'hint' as const,
          code: 'prefer-arrow'
        }
      ];
      
      checks.forEach(check => {
        if (check.condition) {
          diagnostics.push({
            range: { start: { line: index, character: 0 }, end: { line: index, character: line.length } },
            message: check.message,
            severity: check.severity,
            source: 'lsp-client',
            code: check.code
          });
        }
      });
    });
    
    return diagnostics;
  }
  
  private checkPython(code: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
      const checks = [
        {
          condition: line.trim().startsWith('print ') && !line.includes('('),
          message: 'Use print() function syntax',
          severity: 'error' as const,
          code: 'print-function'
        },
        {
          condition: line.includes('import *'),
          message: 'Avoid wildcard imports',
          severity: 'warning' as const,
          code: 'no-wildcard-import'
        },
        {
          condition: line.match(/^\s*except:\s*$/),
          message: 'Bare except clause - specify exception type',
          severity: 'warning' as const,
          code: 'bare-except'
        },
        {
          condition: line.includes('== None') || line.includes('!= None'),
          message: 'Use "is None" or "is not None" instead',
          severity: 'warning' as const,
          code: 'none-comparison'
        },
        {
          condition: line.match(/^\s*pass\s*$/),
          message: 'Empty code block - consider adding implementation',
          severity: 'hint' as const,
          code: 'empty-block'
        }
      ];
      
      checks.forEach(check => {
        if (check.condition) {
          diagnostics.push({
            range: { start: { line: index, character: 0 }, end: { line: index, character: line.length } },
            message: check.message,
            severity: check.severity,
            source: 'lsp-client',
            code: check.code
          });
        }
      });
    });
    
    return diagnostics;
  }
  
  async getSymbols(filePath: string, code: string): Promise<Symbol[]> {
    const symbols: Symbol[] = [];
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
      // Extract various symbol types
      const patterns = [
        { regex: /(?:function|def)\s+(\w+)/, kind: 'function' },
        { regex: /class\s+(\w+)/, kind: 'class' },
        { regex: /interface\s+(\w+)/, kind: 'interface' },
        { regex: /(?:const|let|var)\s+(\w+)\s*=/, kind: 'variable' },
        { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
        { regex: /(\w+)\s*:\s*\([^)]*\)\s*=>/, kind: 'method' },
        { regex: /import\s+.*from\s+['"]([^'"]+)['"]/, kind: 'import' }
      ];
      
      patterns.forEach(({ regex, kind }) => {
        const match = line.match(regex);
        if (match) {
          symbols.push({
            name: match[1],
            kind,
            location: {
              uri: filePath,
              range: { start: { line: index, character: 0 }, end: { line: index, character: line.length } }
            },
            containerName: this.getContainerName(lines, index)
          });
        }
      });
    });
    
    return symbols;
  }

  private getContainerName(lines: string[], currentIndex: number): string | undefined {
    // Look backwards for containing class or namespace
    for (let i = currentIndex - 1; i >= 0; i--) {
      const classMatch = lines[i].match(/class\s+(\w+)/);
      if (classMatch) return classMatch[1];
      
      const namespaceMatch = lines[i].match(/namespace\s+(\w+)/);
      if (namespaceMatch) return namespaceMatch[1];
    }
    return undefined;
  }

  async getCompletions(filePath: string, code: string, position: { line: number; character: number }, language: string): Promise<any[]> {
    const cacheKey = `${filePath}:${position.line}:${position.character}`;
    const cached = this.completionCache.get(cacheKey);
    if (cached) return cached;

    const completions: any[] = [];
    const lines = code.split('\n');
    const currentLine = lines[position.line] || '';
    const prefix = currentLine.substring(0, position.character);

    // Get available symbols for context
    const symbols = await this.getSymbols(filePath, code);
    
    // Language-specific completions
    if (language === 'typescript' || language === 'javascript') {
      completions.push(...this.getJSTSCompletions(prefix, symbols));
    } else if (language === 'python') {
      completions.push(...this.getPythonCompletions(prefix, symbols));
    }

    this.completionCache.set(cacheKey, completions);
    return completions;
  }

  private getJSTSCompletions(prefix: string, symbols: Symbol[]): any[] {
    const completions: any[] = [];
    
    // Add symbol-based completions
    symbols.forEach(symbol => {
      if (symbol.name.startsWith(prefix.split('.').pop() || '')) {
        completions.push({
          label: symbol.name,
          kind: symbol.kind,
          detail: `${symbol.kind}: ${symbol.name}`,
          insertText: symbol.name
        });
      }
    });

    // Add common JS/TS keywords and patterns
    const keywords = ['function', 'const', 'let', 'var', 'class', 'interface', 'type', 'async', 'await'];
    keywords.forEach(keyword => {
      if (keyword.startsWith(prefix)) {
        completions.push({
          label: keyword,
          kind: 'keyword',
          detail: `Keyword: ${keyword}`,
          insertText: keyword
        });
      }
    });

    return completions;
  }

  private getPythonCompletions(prefix: string, symbols: Symbol[]): any[] {
    const completions: any[] = [];
    
    // Add symbol-based completions
    symbols.forEach(symbol => {
      if (symbol.name.startsWith(prefix)) {
        completions.push({
          label: symbol.name,
          kind: symbol.kind,
          detail: `${symbol.kind}: ${symbol.name}`,
          insertText: symbol.name
        });
      }
    });

    // Add Python keywords
    const keywords = ['def', 'class', 'import', 'from', 'if', 'else', 'elif', 'for', 'while', 'try', 'except', 'finally'];
    keywords.forEach(keyword => {
      if (keyword.startsWith(prefix)) {
        completions.push({
          label: keyword,
          kind: 'keyword',
          detail: `Keyword: ${keyword}`,
          insertText: keyword
        });
      }
    });

    return completions;
  }

  async getHover(filePath: string, code: string, position: { line: number; character: number }): Promise<any> {
    const lines = code.split('\n');
    const line = lines[position.line] || '';
    const word = this.getWordAtPosition(line, position.character);
    
    if (!word) return null;

    const symbols = await this.getSymbols(filePath, code);
    const symbol = symbols.find(s => s.name === word);
    
    if (symbol) {
      return {
        contents: {
          kind: 'markdown',
          value: `**${symbol.kind}**: ${symbol.name}\n\nDefined at line ${symbol.location.range.start.line + 1}`
        },
        range: {
          start: { line: position.line, character: position.character - word.length },
          end: { line: position.line, character: position.character }
        }
      };
    }

    return null;
  }

  private getWordAtPosition(line: string, character: number): string {
    const wordRegex = /\w+/g;
    let match;
    
    while ((match = wordRegex.exec(line)) !== null) {
      if (match.index <= character && character <= match.index + match[0].length) {
        return match[0];
      }
    }
    
    return '';
  }

  async clearCache(): Promise<void> {
    this.diagnostics.clear();
    this.symbols.clear();
    this.completionCache.clear();
  }
}