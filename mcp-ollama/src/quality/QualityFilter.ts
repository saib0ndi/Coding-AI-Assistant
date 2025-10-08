export interface QualityScore {
  overall: number;
  syntax: number;
  completeness: number;
  relevance: number;
  confidence: number;
}

export class QualityFilter {
  private readonly minScore = 0.6;
  
  async scoreResponse(code: string, language: string, context?: string): Promise<QualityScore> {
    const syntax = await this.scoreSyntax(code, language);
    const completeness = this.scoreCompleteness(code);
    const relevance = this.scoreRelevance(code, context);
    const confidence = this.scoreConfidence(code, language);
    
    const overall = (syntax + completeness + relevance + confidence) / 4;
    
    return { overall, syntax, completeness, relevance, confidence };
  }
  
  async validateSyntax(code: string, language: string): Promise<boolean> {
    try {
      switch (language) {
        case 'javascript':
        case 'typescript':
          return this.validateJS(code);
        case 'python':
          return this.validatePython(code);
        case 'json':
          return this.validateJSON(code);
        default:
          return true;
      }
    } catch {
      return false;
    }
  }
  
  private async scoreSyntax(code: string, language: string): Promise<number> {
    const isValid = await this.validateSyntax(code, language);
    if (!isValid) return 0;
    
    // Check for common syntax patterns
    const lines = code.split('\n');
    let score = 1.0;
    
    // Penalize for obvious syntax issues
    if (language === 'javascript' || language === 'typescript') {
      const hasUnmatchedBraces = this.countBraces(code) !== 0;
      const hasUnmatchedParens = this.countParens(code) !== 0;
      
      if (hasUnmatchedBraces) score -= 0.3;
      if (hasUnmatchedParens) score -= 0.3;
    }
    
    return Math.max(0, score);
  }
  
  private scoreCompleteness(code: string): number {
    const lines = code.split('\n').filter(line => line.trim());
    
    // Very short responses are likely incomplete
    if (lines.length < 3) return 0.3;
    if (lines.length < 5) return 0.6;
    
    // Check for incomplete patterns
    if (code.includes('...') || code.includes('TODO') || code.includes('FIXME')) {
      return 0.4;
    }
    
    return 1.0;
  }
  
  private scoreRelevance(code: string, context?: string): number {
    if (!context) return 0.8;
    
    const codeWords = this.extractKeywords(code);
    const contextWords = this.extractKeywords(context);
    
    const overlap = codeWords.filter(word => contextWords.includes(word));
    const relevanceRatio = overlap.length / Math.max(contextWords.length, 1);
    
    return Math.min(1.0, relevanceRatio + 0.3);
  }
  
  private scoreConfidence(code: string, language: string): number {
    let score = 0.8;
    
    // Boost for proper structure
    if (language === 'javascript' || language === 'typescript') {
      if (code.includes('function') || code.includes('=>')) score += 0.1;
      if (code.includes('const') || code.includes('let')) score += 0.1;
    }
    
    if (language === 'python') {
      if (code.includes('def ') || code.includes('class ')) score += 0.1;
      if (code.match(/^\s{4}/m)) score += 0.1; // Proper indentation
    }
    
    return Math.min(1.0, score);
  }
  
  private validateJS(code: string): boolean {
    try {
      // Basic syntax validation
      const braceCount = this.countBraces(code);
      const parenCount = this.countParens(code);
      
      return braceCount === 0 && parenCount === 0;
    } catch {
      return false;
    }
  }
  
  private validatePython(code: string): boolean {
    const lines = code.split('\n');
    
    // Check for basic Python syntax
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // Check for invalid characters at line start
        if (trimmed.match(/^[}\])]/) && !line.startsWith(' ')) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  private validateJSON(code: string): boolean {
    try {
      JSON.parse(code);
      return true;
    } catch {
      return false;
    }
  }
  
  private countBraces(code: string): number {
    const open = (code.match(/{/g) || []).length;
    const close = (code.match(/}/g) || []).length;
    return open - close;
  }
  
  private countParens(code: string): number {
    const open = (code.match(/\(/g) || []).length;
    const close = (code.match(/\)/g) || []).length;
    return open - close;
  }
  
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .match(/\b\w{3,}\b/g) || [];
  }
  
  shouldAccept(score: QualityScore): boolean {
    return score.overall >= this.minScore && score.syntax >= 0.7;
  }
}