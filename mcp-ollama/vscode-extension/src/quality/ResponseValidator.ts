export interface ValidationResult {
  isValid: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
}

export class ResponseValidator {
  private mcpClient: any;
  
  constructor(mcpClient?: any) {
    this.mcpClient = mcpClient;
  }
  
  async validateResponse(code: string, language: string, context?: string): Promise<ValidationResult> {
    // Use backend validation if available
    if (this.mcpClient) {
      try {
        const backendResult = await this.mcpClient.request('handleResponseValidation', {
          code, language, context
        });
        return backendResult;
      } catch (error) {
        console.warn('Backend validation failed, using local validation:', error);
      }
    }
    
    // Fallback to local validation
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 1.0;
    
    // Syntax validation
    const syntaxValid = this.validateSyntax(code, language);
    if (!syntaxValid) {
      issues.push('Syntax errors detected');
      score -= 0.4;
    }
    
    // Completeness check
    if (this.isIncomplete(code)) {
      issues.push('Response appears incomplete');
      suggestions.push('Request a more complete implementation');
      score -= 0.3;
    }
    
    // Quality checks
    if (this.hasLowQuality(code)) {
      issues.push('Code quality could be improved');
      suggestions.push('Consider refactoring for better readability');
      score -= 0.2;
    }
    
    return {
      isValid: score >= 0.6,
      score: Math.max(0, score),
      issues,
      suggestions
    };
  }
  
  private validateSyntax(code: string, language: string): boolean {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.validateJSSyntax(code);
      case 'python':
        return this.validatePythonSyntax(code);
      case 'json':
        return this.validateJSONSyntax(code);
      case 'java':
        return this.validateJavaSyntax(code);
      case 'go':
        return this.validateGoSyntax(code);
      case 'rs':
        return this.validateRustSyntax(code);
      case 'tsx':
      case 'jsx':
        return this.validateJSSyntax(code);
      case 'jsonc':
        return this.validateJSONSyntax(code);
      case 'css':
        return this.validateCSSSyntax(code);
      case 'html':
        return this.validateHTMLSyntax(code);
      case 'md':
        return this.validateMDSyntax(code);
      case 'yaml':
      case 'yml':
        return this.validateYAMLSyntax(code);
      default:
        return true;
    }
  }
  
  private validateJSSyntax(code: string): boolean {
    try {
      // Strip string literals and single-line comments before counting delimiters
      const stripped = code
        .replace(/`[^`]*`/g, '""')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      const braces = (stripped.match(/{/g) || []).length - (stripped.match(/}/g) || []).length;
      const parens = (stripped.match(/\(/g) || []).length - (stripped.match(/\)/g) || []).length;
      const brackets = (stripped.match(/\[/g) || []).length - (stripped.match(/\]/g) || []).length;

      return braces === 0 && parens === 0 && brackets === 0;
    } catch {
      return false;
    }
  }
  
  private validatePythonSyntax(code: string): boolean {
    const lines = code.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const currentIndent = line.length - line.trimStart().length;
      
      // Check for proper indentation
      if (currentIndent % 4 !== 0) return false;
      
      // Check for colon at end of control structures
      if (trimmed.match(/^(if|for|while|def|class|try|except|finally|with).*[^:]$/)) {
        return false;
      }
    }
    
    return true;
  }
  
  private validateJSONSyntax(code: string): boolean {
    try {
      JSON.parse(code);
      return true;
    } catch {
      return false;
    }
  }
  
  private validateJavaSyntax(code: string): boolean {
    // Simple Java syntax validation: checks for matching brackets and semicolons
    const lines = code.split('\n');
    let bracketCount = 0;
    let semicolonCount = 0;
    
    for (const line of lines) {
      bracketCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      semicolonCount += (line.match(/;/g) || []).length;
    }
    
    return bracketCount === 0 && semicolonCount > 0;
  }
  
  private validateGoSyntax(code: string): boolean {
    // Simple Go syntax validation: checks for matching brackets and semicolons
    const lines = code.split('\n');
    let bracketCount = 0;
    let semicolonCount = 0;
    
    for (const line of lines) {
      bracketCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      semicolonCount += (line.match(/;/g) || []).length;
    }
    
    return bracketCount === 0 && semicolonCount > 0;
  }
  
  private validateRustSyntax(code: string): boolean {
    // Simple Rust syntax validation: checks for matching brackets and semicolons
    const lines = code.split('\n');
    let bracketCount = 0;
    let semicolonCount = 0;
    
    for (const line of lines) {
      bracketCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      semicolonCount += (line.match(/;/g) || []).length;
    }
    
    return bracketCount === 0 && semicolonCount > 0;
  }
  
  private validateCSSSyntax(code: string): boolean {
    // Simple CSS syntax validation: checks for matching brackets and semicolons
    const lines = code.split('\n');
    let bracketCount = 0;
    let semicolonCount = 0;
    
    for (const line of lines) {
      bracketCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      semicolonCount += (line.match(/;/g) || []).length;
    }
    
    return bracketCount === 0 && semicolonCount > 0;
  }
  
  private validateHTMLSyntax(code: string): boolean {
    // Simple HTML syntax validation: checks for matching tags
    const lines = code.split('\n');
    let tagCount = 0;
    
    for (const line of lines) {
      tagCount += (line.match(/<\/?[^>]+>/g) || []).length;
    }
    
    return tagCount % 2 === 0;
  }
  
  private validateMDSyntax(code: string): boolean {
    // Simple Markdown syntax validation: checks for headers and bold text
    const lines = code.split('\n');
    let headerCount = 0;
    let boldCount = 0;
    
    for (const line of lines) {
      headerCount += (line.match(/^#+/g) || []).length;
      boldCount += (line.match(/__|\*\*/g) || []).length;
    }
    
    return headerCount > 0 && boldCount > 0;
  }
  
  private validateYAMLSyntax(code: string): boolean {
    // Simple YAML syntax validation: checks for colon and indentation
    const lines = code.split('\n');
    let colonCount = 0;
    let indentCount = 0;
    
    for (const line of lines) {
      colonCount += (line.match(/:/g) || []).length;
      indentCount += (line.match(/^ /g) || []).length;
    }
    
    return colonCount > 0 && indentCount > 0;
  }
  
  private isIncomplete(code: string): boolean {
    const incompletePatterns: RegExp[] = [
      /^\s*\.\.\.\s*$/m,
      /TODO/i,
      /FIXME/i,
      /\/\/ Implementation needed/i,
      /# Implementation needed/i,
      /function\s+\w+\s*\(\s*\)\s*{\s*}/,
      /def\s+\w+\s*\(\s*\):\s*pass/
    ];

    return incompletePatterns.some(pattern => pattern.test(code));
  }
  
  private hasLowQuality(code: string): boolean {
    const lines = code.split('\n').filter(line => line.trim());
    
    // Too short
    if (lines.length < 3) return true;
    
    // No proper structure
    if (!code.includes('{') && !code.includes('def ') && !code.includes('class ')) {
      return lines.length > 5;
    }
    
    // Repetitive patterns
    const uniqueLines = new Set(lines.map(line => line.trim()));
    if (uniqueLines.size < lines.length * 0.7) return true;
    
    return false;
  }
}
