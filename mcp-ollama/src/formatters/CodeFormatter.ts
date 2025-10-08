export class CodeFormatter {
  async formatCode(code: string, language: string): Promise<string> {
    try {
      switch (language) {
        case 'typescript':
        case 'javascript':
          return await this.formatJS(code);
        case 'python':
          return await this.formatPython(code);
        case 'json':
          return this.formatJSON(code);
        default:
          return code;
      }
    } catch (error) {
      console.warn(`Formatting failed for ${language}:`, error);
      return code;
    }
  }
  
  private async formatJS(code: string): Promise<string> {
    try {
      // Basic formatting rules
      let formatted = code
        .replace(/;\s*\n/g, ';\n')
        .replace(/{\s*\n/g, ' {\n')
        .replace(/}\s*\n/g, '}\n')
        .replace(/,\s*\n/g, ',\n');
      
      // Add proper indentation
      const lines = formatted.split('\n');
      let indent = 0;
      const indentSize = 2;
      
      return lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.includes('}')) indent = Math.max(0, indent - indentSize);
        const result = ' '.repeat(indent) + trimmed;
        if (trimmed.includes('{')) indent += indentSize;
        return result;
      }).join('\n');
    } catch {
      return code;
    }
  }
  
  private async formatPython(code: string): Promise<string> {
    try {
      return code
        .replace(/\t/g, '    ')
        .replace(/\s+$/gm, '')
        .replace(/\n{3,}/g, '\n\n');
    } catch {
      return code;
    }
  }
  
  private formatJSON(code: string): string {
    try {
      const parsed = JSON.parse(code);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return code;
    }
  }
  
  async fixImports(code: string, language: string): Promise<string> {
    if (language === 'typescript' || language === 'javascript') {
      return this.fixJSImports(code);
    }
    return code;
  }
  
  private fixJSImports(code: string): string {
    const lines = code.split('\n');
    const imports: string[] = [];
    const otherLines: string[] = [];
    
    lines.forEach(line => {
      if (line.trim().startsWith('import ') || line.trim().startsWith('const ') && line.includes('require(')) {
        imports.push(line);
      } else {
        otherLines.push(line);
      }
    });
    
    imports.sort();
    return [...imports, '', ...otherLines].join('\n');
  }
}