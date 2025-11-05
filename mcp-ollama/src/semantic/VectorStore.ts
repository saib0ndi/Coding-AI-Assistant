export interface CodeEmbedding {
  id: string;
  code: string;
  embedding: number[];
  metadata: {
    language: string;
    filePath: string;
    functionName?: string;
    className?: string;
  };
}

export interface SearchResult {
  code: string;
  similarity: number;
  metadata: any;
}

export class VectorStore {
  private embeddings = new Map<string, CodeEmbedding>();
  private index = new Map<string, number[]>();
  private intentPatterns = new Map<string, RegExp[]>();
  
  constructor() {
    this.initializeNLPPatterns();
  }
  
  private initializeNLPPatterns(): void {
    this.intentPatterns.set('create_directory', [
      /create\s+(?:a\s+)?(?:directory|folder)\s+(?:named|called|with.*name.*of)?\s*([a-zA-Z0-9_-]+)/i,
      /make\s+(?:a\s+)?(?:directory|folder)\s+([a-zA-Z0-9_-]+)/i,
      /mkdir\s+([a-zA-Z0-9_-]+)/i
    ]);
    
    this.intentPatterns.set('create_file', [
      /create\s+(?:a\s+)?file\s+(?:named|called)?\s*([a-zA-Z0-9_.-]+)/i,
      /make\s+(?:a\s+)?file\s+([a-zA-Z0-9_.-]+)/i
    ]);
    
    this.intentPatterns.set('implement_feature', [
      /implement\s+(.+)/i,
      /create\s+(?:a\s+)?(.+)\s+(?:feature|component|system)/i,
      /build\s+(?:a\s+)?(.+)/i
    ]);
  }
  
  async embed(code: string, language: string): Promise<number[]> {
    // Simple embedding using character frequency
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789{}()[];.,';
    const vector = new Array(chars.length).fill(0);
    
    const normalized = code.toLowerCase().replace(/\s+/g, '');
    for (const char of normalized) {
      const idx = chars.indexOf(char);
      if (idx >= 0) vector[idx]++;
    }
    
    // Normalize vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(val => val / magnitude) : vector;
  }
  
  async addCode(id: string, code: string, metadata: any): Promise<void> {
    const embedding = await this.embed(code, metadata.language);
    
    this.embeddings.set(id, {
      id,
      code,
      embedding,
      metadata
    });
    
    this.index.set(id, embedding);
  }
  
  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const queryEmbedding = await this.embed(query, 'text');
    const results: SearchResult[] = [];
    
    for (const [id, codeEmb] of this.embeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, codeEmb.embedding);
      
      results.push({
        code: codeEmb.code,
        similarity,
        metadata: codeEmb.metadata
      });
    }
    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
  
  parseIntent(input: string): {intent: string, target: string, confidence: number} {
    for (const [intent, patterns] of this.intentPatterns) {
      for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) {
          return {
            intent,
            target: match[1] || 'unknown',
            confidence: 0.9
          };
        }
      }
    }
    
    return { intent: 'unknown', target: 'unknown', confidence: 0.2 };
  }
  
  async searchWithIntent(query: string, limit = 5): Promise<SearchResult[] & {intent?: any}> {
    const intent = this.parseIntent(query);
    const semanticResults = await this.search(query, limit);
    
    return Object.assign(semanticResults, { intent });
  }
  
  async findSimilar(code: string, language: string, limit = 3): Promise<SearchResult[]> {
    const embedding = await this.embed(code, language);
    const results: SearchResult[] = [];
    
    for (const [id, codeEmb] of this.embeddings) {
      if (codeEmb.metadata.language === language) {
        const similarity = this.cosineSimilarity(embedding, codeEmb.embedding);
        
        results.push({
          code: codeEmb.code,
          similarity,
          metadata: codeEmb.metadata
        });
      }
    }
    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  async indexCodebase(files: Array<{path: string; content: string; language: string}>): Promise<void> {
    for (const file of files) {
      // Extract functions and classes
      const functions = this.extractFunctions(file.content, file.language);
      
      for (const func of functions) {
        const id = `${file.path}:${func.name}`;
        await this.addCode(id, func.code, {
          language: file.language,
          filePath: file.path,
          functionName: func.name,
          type: func.type
        });
      }
    }
  }
  
  private extractFunctions(code: string, language: string): Array<{name: string; code: string; type: string}> {
    const functions: Array<{name: string; code: string; type: string}> = [];
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // JavaScript/TypeScript functions
      if (language === 'javascript' || language === 'typescript') {
        const funcMatch = line.match(/(?:function|const|let)\s+(\w+)|(\w+)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/);
        if (funcMatch) {
          const name = funcMatch[1] || funcMatch[2];
          const funcCode = this.extractBlock(lines, i);
          functions.push({ name, code: funcCode, type: 'function' });
        }
        
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          const name = classMatch[1];
          const classCode = this.extractBlock(lines, i);
          functions.push({ name, code: classCode, type: 'class' });
        }
      }
      
      // Python functions
      if (language === 'python') {
        const funcMatch = line.match(/def\s+(\w+)/);
        if (funcMatch) {
          const name = funcMatch[1];
          const funcCode = this.extractPythonBlock(lines, i);
          functions.push({ name, code: funcCode, type: 'function' });
        }
        
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          const name = classMatch[1];
          const classCode = this.extractPythonBlock(lines, i);
          functions.push({ name, code: classCode, type: 'class' });
        }
      }
    }
    
    return functions;
  }
  
  private extractBlock(lines: string[], startIndex: number): string {
    const result = [lines[startIndex]];
    let braceCount = (lines[startIndex].match(/{/g) || []).length - (lines[startIndex].match(/}/g) || []).length;
    
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