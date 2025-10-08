export interface SecurityIssue {
  type: 'vulnerability' | 'secret' | 'injection' | 'xss' | 'csrf';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  line: number;
  column: number;
  suggestion: string;
}

export class SecurityScanner {
  private vulnerabilityPatterns = new Map<string, RegExp[]>();
  
  constructor() {
    this.initializePatterns();
  }
  
  async scanCode(code: string, language: string): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
      issues.push(...this.scanLine(line, index, language));
    });
    
    return issues;
  }
  
  private scanLine(line: string, lineNumber: number, language: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    
    // SQL Injection
    if (this.checkSQLInjection(line)) {
      issues.push({
        type: 'injection',
        severity: 'high',
        message: 'Potential SQL injection vulnerability',
        line: lineNumber,
        column: 0,
        suggestion: 'Use parameterized queries or prepared statements'
      });
    }
    
    // XSS
    if (this.checkXSS(line)) {
      issues.push({
        type: 'xss',
        severity: 'medium',
        message: 'Potential XSS vulnerability',
        line: lineNumber,
        column: 0,
        suggestion: 'Sanitize user input before rendering'
      });
    }
    
    // Hardcoded secrets
    if (this.checkSecrets(line)) {
      issues.push({
        type: 'secret',
        severity: 'critical',
        message: 'Hardcoded secret detected',
        line: lineNumber,
        column: 0,
        suggestion: 'Use environment variables or secure key management'
      });
    }
    
    // Insecure functions
    if (this.checkInsecureFunctions(line, language)) {
      issues.push({
        type: 'vulnerability',
        severity: 'medium',
        message: 'Use of insecure function',
        line: lineNumber,
        column: 0,
        suggestion: 'Replace with secure alternative'
      });
    }
    
    return issues;
  }
  
  private checkSQLInjection(line: string): boolean {
    const patterns = [
      /query\s*\+\s*['"]/i,
      /execute\s*\(\s*['"]/i,
      /\$\{.*\}.*SELECT/i,
      /SELECT.*\+.*\$/i
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }
  
  private checkXSS(line: string): boolean {
    const patterns = [
      /innerHTML\s*=\s*[^'"].*\+/i,
      /document\.write\s*\(/i,
      /eval\s*\(/i,
      /dangerouslySetInnerHTML/i
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }
  
  private checkSecrets(line: string): boolean {
    const patterns = [
      /password\s*[:=]\s*['"][^'"]{8,}/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]{16,}/i,
      /secret\s*[:=]\s*['"][^'"]{16,}/i,
      /token\s*[:=]\s*['"][^'"]{20,}/i,
      /[A-Za-z0-9]{32,}/  // Long hex strings
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }
  
  private checkInsecureFunctions(line: string, language: string): boolean {
    const jsPatterns = [
      /eval\s*\(/,
      /setTimeout\s*\(\s*['"][^'"]*\+/,
      /setInterval\s*\(\s*['"][^'"]*\+/,
      /Function\s*\(/
    ];
    
    const pythonPatterns = [
      /exec\s*\(/,
      /eval\s*\(/,
      /os\.system\s*\(/,
      /subprocess\.call\s*\(/
    ];
    
    const patterns = language === 'python' ? pythonPatterns : jsPatterns;
    return patterns.some(pattern => pattern.test(line));
  }
  
  private initializePatterns(): void {
    // Initialize vulnerability patterns by language
    this.vulnerabilityPatterns.set('javascript', [
      /eval\s*\(/,
      /innerHTML\s*=/,
      /document\.write/
    ]);
    
    this.vulnerabilityPatterns.set('python', [
      /exec\s*\(/,
      /eval\s*\(/,
      /os\.system/
    ]);
  }
  
  async anonymizeCode(code: string): Promise<string> {
    let anonymized = code;
    
    // Replace potential secrets
    anonymized = anonymized.replace(/(['"])([A-Za-z0-9+/]{20,})\1/g, '$1<REDACTED>$1');
    
    // Replace API keys
    anonymized = anonymized.replace(/(api[_-]?key\s*[:=]\s*)(['"])[^'"]+\2/gi, '$1$2<API_KEY>$2');
    
    // Replace passwords
    anonymized = anonymized.replace(/(password\s*[:=]\s*)(['"])[^'"]+\2/gi, '$1$2<PASSWORD>$2');
    
    // Replace URLs with sensitive info
    anonymized = anonymized.replace(/https?:\/\/[^\/\s]+/g, '<URL>');
    
    // Replace email addresses
    anonymized = anonymized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<EMAIL>');
    
    return anonymized;
  }
}