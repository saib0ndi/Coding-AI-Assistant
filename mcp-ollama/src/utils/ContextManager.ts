import * as fs from 'fs';
import * as path from 'path';
import { ContextData } from '../types/index.js';

export class ContextManager {
  private currentContext: ContextData | null = null;
  private contextCache: Map<string, ContextData> = new Map();

  async analyzeProject(projectPath: string, options: {
    filePatterns?: string[];
    maxFiles?: number;
  } = {}): Promise<ContextData> {
    const validatedPath = this.validatePath(projectPath, process.cwd());
    if (!validatedPath) {
      throw new Error('Invalid project path');
    }

    const cacheKey = `project:${validatedPath}`;
    if (this.contextCache.has(cacheKey)) {
      return this.contextCache.get(cacheKey)!;
    }

    const {
      filePatterns = ['**/*.js', '**/*.ts', '**/*.py', '**/*.java'],
      maxFiles = 50
    } = options;

    try {
      const [projectFiles, dependencies, gitContext] = await Promise.all([
        this.scanProjectFiles(validatedPath, filePatterns, maxFiles),
        this.extractDependencies(validatedPath),
        this.getGitContext(validatedPath)
      ]);

      const context: ContextData = {
        currentFile: { path: '', content: '', language: '' },
        projectFiles,
        dependencies,
        ...(gitContext && { gitContext })
      };

      this.contextCache.set(cacheKey, context);
      this.currentContext = context;
      return context;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error analyzing project:', this.sanitizeLogInput(errorMsg));
      throw new Error(`Failed to analyze project: ${errorMsg}`);
    }
  }

  async getCurrentContext(): Promise<ContextData | null> {
    return this.currentContext;
  }

  async updateCurrentFile(filePath: string, content: string, language: string): Promise<void> {
    if (this.currentContext) {
      this.currentContext.currentFile = {
        path: filePath,
        content,
        language
      };
    }
  }

  private async scanProjectFiles(
    projectPath: string,
    patterns: string[],
    maxFiles: number
  ): Promise<Array<{ path: string; content: string; language: string }>> {
    try {
      const allFiles = await this.walkDirectory(projectPath);
      const filteredFiles = this.filterFilesByPatterns(allFiles, patterns).slice(0, maxFiles);

      const filePromises = filteredFiles.map(async (filePath) => {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          return {
            path: path.relative(projectPath, filePath),
            content: content.length > 5000 ? content.substring(0, 5000) + '...' : content,
            language: this.detectLanguage(filePath)
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`Could not read file ${this.sanitizeLogInput(filePath)}: ${this.sanitizeLogInput(errorMsg)}`);
          return null;
        }
      });

      const results = await Promise.all(filePromises);
      return results.filter(Boolean) as Array<{ path: string; content: string; language: string }>;
    } catch (error) {
      console.error('Error scanning project files:', error);
      return [];
    }
  }

  private async walkDirectory(dir: string, depth: number = 0, maxDepth: number = 10): Promise<string[]> {
    if (depth > maxDepth) return [];
    
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      const subdirPromises: Promise<string[]>[] = [];
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile()) {
          files.push(fullPath);
        } else if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(entry.name)) {
          subdirPromises.push(this.walkDirectory(fullPath, depth + 1, maxDepth));
        }
      }

      const subdirResults = await Promise.all(subdirPromises);
      return files.concat(...subdirResults);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Could not read directory ${this.sanitizeLogInput(dir)}: ${this.sanitizeLogInput(errorMsg)}`);
      return [];
    }
  }

  private filterFilesByPatterns(files: string[], patterns: string[]): string[] {
    const extensionPatterns = new Set<string>();
    
    for (const pattern of patterns) {
      if (pattern.startsWith('**/*')) {
        extensionPatterns.add(pattern.substring(4));
      }
    }
    
    return files.filter(file => {
      const extension = path.extname(file);
      return extensionPatterns.has(extension);
    });
  }

  private static readonly LANGUAGE_MAP: Record<string, string> = {
    '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.java': 'java', '.cpp': 'cpp', '.c': 'c', '.cs': 'csharp',
    '.php': 'php', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.kt': 'kotlin',
    '.swift': 'swift', '.dart': 'dart', '.scala': 'scala', '.clj': 'clojure',
    '.hs': 'haskell', '.ml': 'ocaml', '.fs': 'fsharp', '.vb': 'vb', '.pl': 'perl',
    '.lua': 'lua', '.r': 'r', '.m': 'matlab', '.sh': 'bash', '.ps1': 'powershell',
    '.sql': 'sql', '.html': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'sass',
    '.less': 'less', '.xml': 'xml', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini', '.md': 'markdown', '.tex': 'latex'
  };

  private detectLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    return ContextManager.LANGUAGE_MAP[extension] || 'text';
  }

  private async extractDependencies(projectPath: string): Promise<string[]> {
    const dependencyFiles = [
      { file: 'package.json', parser: this.parsePackageJson.bind(this) },
      { file: 'requirements.txt', parser: this.parseRequirements.bind(this) },
      { file: 'pom.xml', parser: this.parsePomXml.bind(this) },
      { file: 'Cargo.toml', parser: this.parseCargoToml.bind(this) },
      { file: 'go.mod', parser: this.parseGoMod.bind(this) }
    ];

    const allDependencies = await Promise.all(
      dependencyFiles.map(async ({ file, parser }) => {
        try {
          const filePath = this.validatePath(path.join(projectPath, file), projectPath);
          if (filePath && await this.fileExists(filePath)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return parser(content);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`Failed to parse ${file}: ${this.sanitizeLogInput(errorMsg)}`);
        }
        return [];
      })
    );

    return [...new Set(allDependencies.flat())];
  }

  private parsePackageJson(content: string): string[] {
    const packageJson = JSON.parse(content);
    return [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {})
    ];
  }

  private parseRequirements(content: string): string[] {
    return content
      .split('\n')
      .map(line => line.split(/[=<>]/)[0].trim())
      .filter(dep => dep && !dep.startsWith('#'));
  }

  private parsePomXml(content: string): string[] {
    const matches = content.match(/<artifactId>([^<]+)<\/artifactId>/g);
    return matches ? matches.map(match => match.replace(/<\/?artifactId>/g, '')) : [];
  }

  private parseCargoToml(content: string): string[] {
    const section = content.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
    if (!section) return [];
    return section[1]
      .split('\n')
      .map(line => line.split('=')[0].trim())
      .filter(dep => dep && !dep.startsWith('#'));
  }

  private parseGoMod(content: string): string[] {
    const matches = content.match(/require\s+([^\s]+)/g);
    return matches ? matches.map(match => match.replace(/require\s+/, '').split(' ')[0]) : [];
  }

  private async getGitContext(projectPath: string): Promise<{ branch: string; recentCommits: string[] } | undefined> {
    try {
      const gitDir = this.validatePath(path.join(projectPath, '.git'), projectPath);
      if (!gitDir || !await this.fileExists(gitDir)) {
        return undefined;
      }

      let branch = 'main';
      try {
        const headPath = this.validatePath(path.join(gitDir, 'HEAD'), projectPath);
        if (headPath) {
          const headContent = await fs.promises.readFile(headPath, 'utf-8');
          const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
          if (branchMatch) {
            branch = branchMatch[1].trim();
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Could not determine git branch: ${this.sanitizeLogInput(errorMsg)}`);
      }

      return { branch, recentCommits: [] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Error getting git context: ${this.sanitizeLogInput(errorMsg)}`);
      return undefined;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private validatePath(targetPath: string, basePath: string): string | null {
    try {
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(basePath);
      
      if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
        console.warn(`Path traversal attempt detected: ${this.sanitizeLogInput(targetPath)}`);
        return null;
      }
      
      return resolvedTarget;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Path validation failed: ${this.sanitizeLogInput(errorMsg)}`);
      return null;
    }
  }

  private sanitizeLogInput(input: string): string {
    return input
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
      .substring(0, 200);
  }

  clearCache(): void {
    this.contextCache.clear();
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.contextCache.size,
      keys: Array.from(this.contextCache.keys())
    };
  }
}