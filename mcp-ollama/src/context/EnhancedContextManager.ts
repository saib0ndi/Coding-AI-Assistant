import { VectorStore } from '../semantic/VectorStore.js';
import { ContextManager } from '../utils/ContextManager.js';

export interface DependencyNode {
  name: string;
  version?: string;
  dependencies: string[];
  type: 'direct' | 'transitive';
}

export interface SymbolReference {
  name: string;
  type: string;
  usages: Array<{ file: string; line: number }>;
  definition?: { file: string; line: number };
}

export class EnhancedContextManager extends ContextManager {
  private vectorStore: VectorStore;
  private dependencyGraph = new Map<string, DependencyNode>();
  private symbolTable = new Map<string, SymbolReference>();
  
  constructor() {
    super();
    this.vectorStore = new VectorStore();
  }
  
  async buildDependencyGraph(projectPath: string): Promise<Map<string, DependencyNode>> {
    const packageFiles = await this.findPackageFiles(projectPath);
    
    for (const file of packageFiles) {
      const deps = await this.parseDependencies(file);
      deps.forEach(dep => this.dependencyGraph.set(dep.name, dep));
    }
    
    return this.dependencyGraph;
  }
  
  async buildSymbolTable(files: Array<{path: string; content: string; language: string}>): Promise<void> {
    for (const file of files) {
      const symbols = this.extractSymbols(file.content, file.language);
      
      symbols.forEach(symbol => {
        const existing = this.symbolTable.get(symbol.name) || {
          name: symbol.name,
          type: symbol.type,
          usages: [],
          definition: { file: file.path, line: symbol.line }
        };
        
        this.symbolTable.set(symbol.name, existing);
      });
      
      // Index in vector store
      await this.vectorStore.indexCodebase([file]);
    }
  }
  
  async findSemanticMatches(query: string, limit = 5): Promise<any[]> {
    return await this.vectorStore.search(query, limit);
  }
  
  async findSimilarCode(code: string, language: string): Promise<any[]> {
    return await this.vectorStore.findSimilar(code, language);
  }
  
  getSymbolUsages(symbolName: string): SymbolReference | undefined {
    return this.symbolTable.get(symbolName);
  }
  
  getDependencyInfo(depName: string): DependencyNode | undefined {
    return this.dependencyGraph.get(depName);
  }
  
  private async findPackageFiles(projectPath: string): Promise<string[]> {
    return ['package.json', 'requirements.txt', 'pom.xml'].map(f => `${projectPath}/${f}`);
  }
  
  private async parseDependencies(filePath: string): Promise<DependencyNode[]> {
    const deps: DependencyNode[] = [];
    
    if (filePath.endsWith('package.json')) {
      try {
        const fs = await import('fs');
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const pkg = JSON.parse(content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        
        Object.entries(allDeps).forEach(([name, version]) => {
          deps.push({
            name,
            version: version as string,
            dependencies: [],
            type: 'direct'
          });
        });
      } catch {}
    }
    
    return deps;
  }
  
  private extractSymbols(code: string, language: string): Array<{name: string; type: string; line: number}> {
    const symbols: Array<{name: string; type: string; line: number}> = [];
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
      if (language === 'javascript' || language === 'typescript') {
        const funcMatch = line.match(/(?:function|const|let)\s+(\w+)|(\w+)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/);
        if (funcMatch) {
          symbols.push({ name: funcMatch[1] || funcMatch[2], type: 'function', line: index });
        }
        
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          symbols.push({ name: classMatch[1], type: 'class', line: index });
        }
      }
      
      if (language === 'python') {
        const funcMatch = line.match(/def\s+(\w+)/);
        if (funcMatch) {
          symbols.push({ name: funcMatch[1], type: 'function', line: index });
        }
        
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          symbols.push({ name: classMatch[1], type: 'class', line: index });
        }
      }
    });
    
    return symbols;
  }
}