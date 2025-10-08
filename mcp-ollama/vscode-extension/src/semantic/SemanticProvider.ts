import * as vscode from 'vscode';

export interface SemanticMatch {
  code: string;
  similarity: number;
  location: vscode.Location;
}

export class SemanticProvider {
  private codeIndex = new Map<string, string[]>();
  private mcpClient: any;
  
  constructor(mcpClient?: any) {
    this.mcpClient = mcpClient;
  }
  
  async indexWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java}', '**/node_modules/**');
    
    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const functions = this.extractFunctions(document.getText(), document.languageId);
        this.codeIndex.set(file.toString(), functions);
      } catch (error) {
        console.warn(`Failed to index ${file.toString()}:`, error);
      }
    }
  }
  
  async findSimilarCode(query: string, language: string): Promise<SemanticMatch[]> {
    // Use backend semantic search if available
    if (this.mcpClient) {
      try {
        const result = await this.mcpClient.request('handleSemanticProvider', {
          query, language, workspacePath: vscode.workspace.rootPath
        });
        return result.matches || [];
      } catch (error) {
        console.warn('Backend semantic search failed, using local search:', error);
      }
    }
    
    // Fallback to local search
    const matches: SemanticMatch[] = [];
    const queryTokens = this.tokenize(query);
    
    for (const [uri, functions] of this.codeIndex) {
      for (const func of functions) {
        const similarity = this.calculateSimilarity(queryTokens, this.tokenize(func));
        
        if (similarity > 0.3) {
          matches.push({
            code: func,
            similarity,
            location: new vscode.Location(vscode.Uri.parse(uri), new vscode.Range(0, 0, 0, 0))
          });
        }
      }
    }
    
    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }
  
  private extractFunctions(code: string, language: string): string[] {
    const functions: string[] = [];
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (language === 'typescript' || language === 'javascript') {
        if (line.match(/(?:function|const|let)\s+\w+|class\s+\w+/)) {
          const func = this.extractBlock(lines, i);
          if (func.length > 2) functions.push(func);
        }
      }
      
      if (language === 'python') {
        if (line.match(/def\s+\w+|class\s+\w+/)) {
          const func = this.extractPythonBlock(lines, i);
          if (func.length > 2) functions.push(func);
        }
      }
    }
    
    return functions;
  }
  
  private extractBlock(lines: string[], start: number): string {
    const result = [lines[start]];
    let braces = (lines[start].match(/{/g) || []).length - (lines[start].match(/}/g) || []).length;
    
    for (let i = start + 1; i < lines.length && braces > 0; i++) {
      result.push(lines[i]);
      braces += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
    }
    
    return result.join('\n');
  }
  
  private extractPythonBlock(lines: string[], start: number): string {
    const result = [lines[start]];
    const baseIndent = lines[start].length - lines[start].trimStart().length;
    
    for (let i = start + 1; i < lines.length; i++) {
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
  
  private tokenize(code: string): string[] {
    return code
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);
  }
  
  private calculateSimilarity(tokens1: string[], tokens2: string[]): number {
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
}