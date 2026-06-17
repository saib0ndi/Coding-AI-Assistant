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
  private conversationHistory: string[] = [];
  
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
    }

    if (files.length > 0) {
      await this.vectorStore.indexCodebase(files);
    }
  }

  populateFromIndexer(chunks: any[]): void {
    this.symbolTable.clear();
    this.dependencyGraph.clear();

    // 1. Populate all symbol definitions
    for (const chunk of chunks) {
      if (chunk.symbolName && chunk.symbolType && chunk.symbolType !== 'file') {
        const existing = this.symbolTable.get(chunk.symbolName) || {
          name: chunk.symbolName,
          type: chunk.symbolType,
          usages: [],
          definition: { file: chunk.filePath, line: chunk.startLine }
        };
        
        if (!existing.definition) {
          existing.definition = { file: chunk.filePath, line: chunk.startLine };
        }
        this.symbolTable.set(chunk.symbolName, existing);
      }
    }

    // 2. Scan chunk contents to populate symbol usages and build codebase-wide dependency links
    for (const chunk of chunks) {
      if (!chunk.content) continue;

      const words = chunk.content.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
      const uniqueWords = new Set<string>(words);

      for (const word of uniqueWords) {
        if (word === chunk.symbolName) continue; // Skip self references

        const ref = this.symbolTable.get(word);
        if (ref && ref.definition && ref.definition.file !== chunk.filePath) {
          // Add usage location
          if (!ref.usages.some((u: any) => u.file === chunk.filePath && u.line === chunk.startLine)) {
            ref.usages.push({ file: chunk.filePath, line: chunk.startLine });
          }

          // Build file-to-file dependency mapping
          const fileNode = this.dependencyGraph.get(chunk.filePath) || {
            name: chunk.filePath,
            dependencies: [] as string[],
            type: 'direct' as const
          };
          if (!fileNode.dependencies.includes(ref.definition.file)) {
            fileNode.dependencies.push(ref.definition.file);
          }
          this.dependencyGraph.set(chunk.filePath, fileNode);
        }
      }
    }
  }
  
  async findSemanticMatches(query: string, limit = 5, workspacePath?: string): Promise<any[]> {
    return await this.vectorStore.search(query, limit, workspacePath);
  }
  
  async parseNaturalLanguage(input: string, context?: any): Promise<{intent: string, target: string, confidence: number, semanticMatches: any[]}> {
    // Get intent from VectorStore NLP
    const intentResult = this.vectorStore.parseIntent(input);
    
    // Get semantic matches for context
    const semanticMatches = await this.findSemanticMatches(input, 5, context?.workspacePath);
    
    // Add to conversation history
    this.conversationHistory.push(input);
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
    
    return {
      ...intentResult,
      semanticMatches
    };
  }
  
  getConversationContext(): string[] {
    return this.conversationHistory.slice(-5);
  }

  resetState(): void {
    this.dependencyGraph.clear();
    this.symbolTable.clear();
    this.conversationHistory = [];
  }
  
  async findSimilarCode(code: string, language: string, workspacePath?: string): Promise<any[]> {
    return await this.vectorStore.findSimilar(code, language, 5, workspacePath);
  }
  
  async enhanceWithSemanticContext(input: string, context?: any): Promise<any> {
    const nlpResult = await this.parseNaturalLanguage(input, context);
    const similarCode = context?.code
      ? await this.findSimilarCode(context.code, context.language || 'typescript', context.workspacePath)
      : [];
    
    return {
      ...nlpResult,
      similarCode,
      conversationContext: this.getConversationContext(),
      workspaceContext: context
    };
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