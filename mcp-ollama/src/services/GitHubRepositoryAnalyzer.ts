/**
 * GitHub Repository Analyzer
 * Comprehensive repository analysis with contextual question analysis
 */
import { GitHubService } from './GitHubService.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { loadAppConfig } from '../config/AppConfig.js';

export interface RepositoryAnalysis {
  repository: any;
  structure: any;
  documentation: any;
  codebase: any;
  dependencies: any;
  architecture: any;
  quality: any;
  completeness: number;
}

export interface QuestionAnalysis {
  intent: 'overview' | 'technical' | 'usage' | 'architecture' | 'specific_file' | 'documentation';
  confidence: number;
  requiredData: string[];
  suggestedResponse: string;
}

export class GitHubRepositoryAnalyzer {
  private static instance: GitHubRepositoryAnalyzer;
  private gitHubService: GitHubService;
  private ollamaProvider?: OllamaProvider;
  private analysisCache = new Map<string, RepositoryAnalysis>();

  private constructor() {
    this.gitHubService = GitHubService.getInstance();
  }

  private getOllamaProvider(): OllamaProvider {
    if (!this.ollamaProvider) {
      const appConfig = loadAppConfig();
      this.ollamaProvider = new OllamaProvider(
        {
          host: appConfig.ollama.host,
          model: appConfig.ollama.fastModel || appConfig.ollama.model,
          timeout: appConfig.ollama.timeoutMs,
        },
        'github'
      );
    }
    return this.ollamaProvider;
  }

  public static getInstance(): GitHubRepositoryAnalyzer {
    if (!GitHubRepositoryAnalyzer.instance) {
      GitHubRepositoryAnalyzer.instance = new GitHubRepositoryAnalyzer();
    }
    return GitHubRepositoryAnalyzer.instance;
  }

  clearAnalysisCache(): void {
    this.analysisCache.clear();
  }

  /**
   * Main entry point: Analyze question first, then provide contextual repository analysis
   */
  async analyzeRepositoryWithContext(repoUrl: string, userQuestion?: string): Promise<any> {
    try {
      // Step 1: Analyze the user's question to understand intent
      const questionAnalysis = userQuestion ? this.analyzeQuestion(userQuestion) : null;
      
      // Step 2: Get complete repository analysis
      const repoAnalysis = await this.getCompleteRepositoryAnalysis(repoUrl);
      
      if (!repoAnalysis.success) {
        return repoAnalysis;
      }

      // Step 3: Generate contextual response based on question analysis
      const contextualResponse = questionAnalysis 
        ? this.generateContextualResponse(repoAnalysis, questionAnalysis)
        : repoAnalysis;

      // Step 4: Generate AI-powered explanation
      const aiExplanation = await this.generateAIExplanation(repoAnalysis, userQuestion);

      return {
        success: true,
        questionAnalysis,
        repository: repoAnalysis.repository,
        analysis: repoAnalysis,
        contextualResponse,
        aiExplanation,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Repository analysis failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Analyze user question to understand intent and required information
   */
  private analyzeQuestion(question: string): QuestionAnalysis {
    const lowerQuestion = question.toLowerCase();
    
    // Overview questions
    if (lowerQuestion.includes('what is') || lowerQuestion.includes('overview') || 
        lowerQuestion.includes('about') || lowerQuestion.includes('summary')) {
      return {
        intent: 'overview',
        confidence: 0.9,
        requiredData: ['repository', 'readme', 'languages', 'structure'],
        suggestedResponse: 'Provide comprehensive repository overview'
      };
    }

    // Technical/Architecture questions
    if (lowerQuestion.includes('architecture') || lowerQuestion.includes('structure') ||
        lowerQuestion.includes('design') || lowerQuestion.includes('framework')) {
      return {
        intent: 'architecture',
        confidence: 0.85,
        requiredData: ['structure', 'dependencies', 'languages', 'key_files'],
        suggestedResponse: 'Focus on technical architecture and design patterns'
      };
    }

    // Usage/How-to questions
    if (lowerQuestion.includes('how to') || lowerQuestion.includes('install') ||
        lowerQuestion.includes('setup') || lowerQuestion.includes('use')) {
      return {
        intent: 'usage',
        confidence: 0.8,
        requiredData: ['readme', 'documentation', 'package_files', 'examples'],
        suggestedResponse: 'Provide installation and usage instructions'
      };
    }

    // Specific file questions
    if (lowerQuestion.includes('file') || lowerQuestion.includes('.js') ||
        lowerQuestion.includes('.py') || lowerQuestion.includes('.md')) {
      return {
        intent: 'specific_file',
        confidence: 0.75,
        requiredData: ['file_content', 'structure'],
        suggestedResponse: 'Focus on specific files and their content'
      };
    }

    // Documentation questions
    if (lowerQuestion.includes('documentation') || lowerQuestion.includes('docs') ||
        lowerQuestion.includes('readme') || lowerQuestion.includes('guide')) {
      return {
        intent: 'documentation',
        confidence: 0.8,
        requiredData: ['readme', 'documentation', 'examples'],
        suggestedResponse: 'Focus on documentation and guides'
      };
    }

    // Default to technical analysis
    return {
      intent: 'technical',
      confidence: 0.6,
      requiredData: ['repository', 'structure', 'languages', 'dependencies'],
      suggestedResponse: 'Provide technical analysis of the repository'
    };
  }

  /**
   * Get complete repository analysis with all relevant information
   */
  async getCompleteRepositoryAnalysis(repoUrl: string): Promise<any> {
    const cacheKey = `analysis_${repoUrl}`;
    
    // Check cache first
    if (this.analysisCache.has(cacheKey)) {
      return { success: true, ...this.analysisCache.get(cacheKey) };
    }

    try {
      // Parallel data fetching for efficiency
      const [
        repoInfo,
        rootContents,
        readme,
        languages,
        contributors,
        commits,
        packageInfo,
        srcStructure,
        docsStructure,
        codeAnalysis
      ] = await Promise.allSettled([
        this.gitHubService.getRepositoryInfo(repoUrl),
        this.gitHubService.getDirectoryContents(repoUrl, ''),
        this.gitHubService.handleSmartQuery(repoUrl, 'readme'),
        this.gitHubService.getLanguages(repoUrl),
        this.gitHubService.getContributors(repoUrl, 10),
        this.gitHubService.getRecentCommits(repoUrl, 10),
        this.getPackageInfo(repoUrl),
        this.getDirectoryStructure(repoUrl, 'src'),
        this.getDirectoryStructure(repoUrl, 'docs'),
        this.analyzeRepositoryCode(repoUrl)
      ]);

      const analysis = this.buildComprehensiveAnalysis({
        repoInfo: this.getSettledValue(repoInfo),
        rootContents: this.getSettledValue(rootContents),
        readme: this.getSettledValue(readme),
        languages: this.getSettledValue(languages),
        contributors: this.getSettledValue(contributors),
        commits: this.getSettledValue(commits),
        packageInfo: this.getSettledValue(packageInfo),
        srcStructure: this.getSettledValue(srcStructure),
        docsStructure: this.getSettledValue(docsStructure),
        codeAnalysis: this.getSettledValue(codeAnalysis)
      });

      // Cache the result
      this.analysisCache.set(cacheKey, analysis);

      return { success: true, ...analysis };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed'
      };
    }
  }

  /**
   * Build comprehensive analysis from all gathered data
   */
  private buildComprehensiveAnalysis(data: any): RepositoryAnalysis {
    const repo = data.repoInfo?.repository || {};
    const rootFiles = data.rootContents?.contents || [];
    const readmeContent = data.readme?.file?.content || '';
    const languages = data.languages?.languages || [];
    const contributors = data.contributors?.contributors || [];
    const commits = data.commits?.commits || [];

    return {
      repository: {
        ...repo,
        health: this.calculateRepoHealth(repo, commits, contributors),
        activity: this.calculateActivity(commits),
        popularity: this.calculatePopularity(repo)
      },
      structure: {
        rootFiles: rootFiles.map((f: any) => ({ name: f.name, type: f.type })),
        hasTests: rootFiles.some((f: any) => f.name.includes('test')),
        hasCI: rootFiles.some((f: any) => f.name === '.github'),
        hasDocs: rootFiles.some((f: any) => f.name === 'docs' || f.name.includes('README')),
        srcStructure: data.srcStructure,
        docsStructure: data.docsStructure
      },
      documentation: {
        readme: {
          exists: !!readmeContent,
          length: readmeContent.length,
          quality: this.assessReadmeQuality(readmeContent)
        },
        hasChangelog: rootFiles.some((f: any) => f.name.toLowerCase().includes('changelog')),
        hasLicense: rootFiles.some((f: any) => f.name.toLowerCase().includes('license')),
        hasContributing: rootFiles.some((f: any) => f.name.toLowerCase().includes('contributing'))
      },
      codebase: {
        languages: languages,
        primaryLanguage: languages[0]?.name || 'Unknown',
        linesOfCode: this.estimateLinesOfCode(languages),
        complexity: data.codeAnalysis?.complexity || this.assessComplexity(languages, data.srcStructure),
        codeStructure: data.codeAnalysis?.codeStructure || { imports: [], functions: [], classes: [], variables: [] },
        codeQuality: data.codeAnalysis?.quality || 0,
        insights: data.codeAnalysis?.codeInsights || []
      },
      dependencies: {
        packageManager: this.detectPackageManager(rootFiles),
        hasPackageFile: !!data.packageInfo,
        dependencies: data.packageInfo?.dependencies || []
      },
      architecture: {
        type: this.detectArchitectureType(rootFiles, data.srcStructure),
        patterns: this.detectPatterns(data.srcStructure),
        framework: this.detectFramework(rootFiles, data.packageInfo),
        technologies: data.codeAnalysis?.technologies || []
      },
      quality: {
        score: this.calculateQualityScore(repo, readmeContent, rootFiles, languages),
        maintainability: this.assessMaintainability(commits, contributors),
        testCoverage: this.estimateTestCoverage(rootFiles, data.srcStructure)
      },
      completeness: this.calculateCompleteness(data)
    };
  }

  /**
   * Generate contextual response based on question analysis and repository data
   */
  private generateContextualResponse(repoAnalysis: any, questionAnalysis: QuestionAnalysis): any {
    const { intent, requiredData } = questionAnalysis;
    const { repository, structure, documentation, codebase, architecture } = repoAnalysis;

    switch (intent) {
      case 'overview':
        return {
          type: 'overview',
          summary: `${repository.name} is a ${codebase.primaryLanguage} project with ${repository.stars} stars. ${repository.description || 'No description available.'}`,
          keyPoints: [
            `Primary language: ${codebase.primaryLanguage}`,
            `${repository.forks} forks, ${repository.stars} stars`,
            `Last updated: ${repository.updatedAt}`,
            `License: ${repository.license}`
          ],
          structure: structure.rootFiles,
          documentation: documentation.readme.exists ? 'Well documented' : 'Limited documentation',
          codeInsights: codebase.insights || [],
          explanation: this.generateRepoExplanation(repoAnalysis)
        };

      case 'architecture':
        return {
          type: 'architecture',
          architectureType: architecture.type,
          framework: architecture.framework,
          patterns: architecture.patterns,
          structure: structure,
          languages: codebase.languages,
          complexity: codebase.complexity,
          explanation: this.generateArchitectureExplanation(repoAnalysis)
        };

      case 'usage':
        return {
          type: 'usage',
          installation: this.extractInstallationInfo(repoAnalysis),
          usage: this.extractUsageInfo(repoAnalysis),
          examples: this.findExamples(structure),
          requirements: this.extractRequirements(repoAnalysis)
        };

      case 'documentation':
        return {
          type: 'documentation',
          readme: documentation.readme,
          hasChangelog: documentation.hasChangelog,
          hasContributing: documentation.hasContributing,
          docsStructure: structure.docsStructure,
          quality: documentation.readme.quality
        };

      default:
        return {
          type: 'technical',
          repository,
          codebase,
          architecture,
          quality: repoAnalysis.quality,
          explanation: this.generateTechnicalExplanation(repoAnalysis)
        };
    }
  }

  // Helper methods for analysis
  private getSettledValue(result: PromiseSettledResult<any>): any {
    return result.status === 'fulfilled' ? result.value : null;
  }

  private async getPackageInfo(repoUrl: string): Promise<any> {
    const packageFiles = ['package.json', 'requirements.txt', 'pom.xml', 'Cargo.toml', 'go.mod'];
    
    for (const file of packageFiles) {
      const result = await this.gitHubService.getFileContent(repoUrl, file);
      if (result.success) {
        return { file, content: result.file.content };
      }
    }
    return null;
  }

  private async getDirectoryStructure(repoUrl: string, dirName: string): Promise<any> {
    const result = await this.gitHubService.getDirectoryContents(repoUrl, dirName);
    return result.success ? result.contents : null;
  }

  private calculateRepoHealth(repo: any, commits: any[], contributors: any[]): string {
    const score = (repo.stars || 0) * 0.3 + (commits.length || 0) * 0.4 + (contributors.length || 0) * 0.3;
    return score > 50 ? 'Excellent' : score > 20 ? 'Good' : score > 5 ? 'Fair' : 'Poor';
  }

  private calculateActivity(commits: any[]): string {
    if (!commits.length) return 'Inactive';
    const lastCommit = new Date(commits[0]?.date || 0);
    const daysSince = (Date.now() - lastCommit.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < 7 ? 'Very Active' : daysSince < 30 ? 'Active' : daysSince < 90 ? 'Moderate' : 'Low';
  }

  private calculatePopularity(repo: any): string {
    const stars = repo.stars || 0;
    return stars > 1000 ? 'Very Popular' : stars > 100 ? 'Popular' : stars > 10 ? 'Moderate' : 'Low';
  }

  private assessReadmeQuality(content: string): string {
    if (!content) return 'None';
    const score = content.length > 1000 ? 2 : content.length > 500 ? 1 : 0;
    const hasInstall = content.toLowerCase().includes('install') ? 1 : 0;
    const hasUsage = content.toLowerCase().includes('usage') || content.toLowerCase().includes('example') ? 1 : 0;
    const total = score + hasInstall + hasUsage;
    return total >= 3 ? 'Excellent' : total >= 2 ? 'Good' : total >= 1 ? 'Fair' : 'Poor';
  }

  private estimateLinesOfCode(languages: any[]): number {
    return languages.reduce((total, lang) => total + (lang.bytes || 0), 0) / 50; // Rough estimate
  }

  private assessComplexity(languages: any[], srcStructure: any): string {
    const langCount = languages.length;
    const fileCount = srcStructure?.length || 0;
    const score = langCount * 2 + fileCount;
    return score > 50 ? 'High' : score > 20 ? 'Medium' : 'Low';
  }

  private detectPackageManager(rootFiles: any[]): string {
    if (rootFiles.some(f => f.name === 'package.json')) return 'npm/yarn';
    if (rootFiles.some(f => f.name === 'requirements.txt')) return 'pip';
    if (rootFiles.some(f => f.name === 'pom.xml')) return 'maven';
    if (rootFiles.some(f => f.name === 'Cargo.toml')) return 'cargo';
    if (rootFiles.some(f => f.name === 'go.mod')) return 'go modules';
    return 'unknown';
  }

  private detectArchitectureType(rootFiles: any[], srcStructure: any): string {
    if (rootFiles.some(f => f.name === 'docker-compose.yml')) return 'Microservices';
    if (srcStructure?.some((f: any) => f.name === 'components')) return 'Component-based';
    if (srcStructure?.some((f: any) => f.name === 'controllers')) return 'MVC';
    return 'Standard';
  }

  private detectPatterns(srcStructure: any): string[] {
    const patterns = [];
    if (srcStructure?.some((f: any) => f.name === 'factory')) patterns.push('Factory');
    if (srcStructure?.some((f: any) => f.name === 'singleton')) patterns.push('Singleton');
    if (srcStructure?.some((f: any) => f.name === 'observer')) patterns.push('Observer');
    return patterns;
  }

  private detectFramework(rootFiles: any[], packageInfo: any): string {
    const content = packageInfo?.content || '';
    if (content.includes('react')) return 'React';
    if (content.includes('vue')) return 'Vue.js';
    if (content.includes('angular')) return 'Angular';
    if (content.includes('express')) return 'Express.js';
    if (content.includes('django')) return 'Django';
    if (content.includes('flask')) return 'Flask';
    return 'Unknown';
  }

  private calculateQualityScore(repo: any, readme: string, rootFiles: any[], languages: any[]): number {
    let score = 0;
    score += repo.stars > 10 ? 20 : repo.stars * 2;
    score += readme.length > 500 ? 20 : readme.length / 25;
    score += rootFiles.some(f => f.name.includes('test')) ? 20 : 0;
    score += rootFiles.some(f => f.name === '.github') ? 10 : 0;
    score += languages.length > 1 ? 10 : 0;
    return Math.min(100, score);
  }

  private assessMaintainability(commits: any[], contributors: any[]): string {
    const recentCommits = commits.filter(c => {
      const commitDate = new Date(c.date);
      const monthsAgo = (Date.now() - commitDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      return monthsAgo < 6;
    }).length;
    
    const score = recentCommits * 2 + contributors.length;
    return score > 20 ? 'High' : score > 10 ? 'Medium' : 'Low';
  }

  private estimateTestCoverage(rootFiles: any[], srcStructure: any): string {
    const hasTests = rootFiles.some(f => f.name.includes('test')) || 
                    srcStructure?.some((f: any) => f.name.includes('test'));
    return hasTests ? 'Present' : 'None detected';
  }

  private calculateCompleteness(data: any): number {
    let score = 0;
    if (data.repoInfo?.success) score += 20;
    if (data.readme?.success) score += 20;
    if (data.languages?.success) score += 15;
    if (data.contributors?.success) score += 15;
    if (data.commits?.success) score += 15;
    if (data.packageInfo) score += 15;
    return score;
  }

  private extractInstallationInfo(analysis: any): string {
    const packageManager = analysis.dependencies.packageManager;
    switch (packageManager) {
      case 'npm/yarn': return 'npm install or yarn install';
      case 'pip': return 'pip install -r requirements.txt';
      case 'maven': return 'mvn install';
      case 'cargo': return 'cargo build';
      case 'go modules': return 'go mod download';
      default: return 'Check repository documentation';
    }
  }

  private extractUsageInfo(analysis: any): string {
    const framework = analysis.architecture.framework;
    const primaryLang = analysis.codebase.primaryLanguage;
    return `This is a ${primaryLang} project using ${framework}. Check the README for specific usage instructions.`;
  }

  private findExamples(structure: any): string[] {
    const examples = [];
    if (structure.rootFiles.some((f: any) => f.name === 'examples')) examples.push('examples/');
    if (structure.rootFiles.some((f: any) => f.name === 'demo')) examples.push('demo/');
    if (structure.rootFiles.some((f: any) => f.name.includes('sample'))) examples.push('samples/');
    return examples;
  }

  private extractRequirements(analysis: any): string[] {
    const requirements = [];
    const primaryLang = analysis.codebase.primaryLanguage;
    
    switch (primaryLang.toLowerCase()) {
      case 'javascript':
      case 'typescript':
        requirements.push('Node.js');
        break;
      case 'python':
        requirements.push('Python 3.x');
        break;
      case 'java':
        requirements.push('Java 8+');
        break;
      case 'go':
        requirements.push('Go 1.16+');
        break;
    }
    
    return requirements;
  }

  /**
   * Analyze repository code using context analyzer patterns
   */
  private async analyzeRepositoryCode(repoUrl: string): Promise<any> {
    try {
      const keyFiles = await this.getKeyFiles(repoUrl);
      const codeContent = await this.fetchCodeContent(repoUrl, keyFiles);
      const structure = this.analyzeCodeStructure(codeContent);
      
      return {
        patterns: this.detectCodePatterns(codeContent),
        architecture: this.analyzeCodeArchitecture(codeContent),
        complexity: this.assessCodeComplexity(codeContent),
        quality: this.calculateCodeQuality(codeContent, structure),
        technologies: this.detectTechnologies(codeContent),
        codeInsights: this.generateCodeInsights(codeContent, structure),
        codeStructure: structure
      };
    } catch (error) {
      return null;
    }
  }

  private async getKeyFiles(repoUrl: string): Promise<string[]> {
    const rootContents = await this.gitHubService.getDirectoryContents(repoUrl);
    const srcContents = await this.gitHubService.getDirectoryContents(repoUrl, 'src');
    
    const keyFiles = [];
    
    if (rootContents.success) {
      const importantFiles = rootContents.contents.filter((f: any) => 
        ['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts', 'server.js'].includes(f.name)
      );
      keyFiles.push(...importantFiles.map((f: any) => f.path));
    }
    
    if (srcContents.success) {
      const srcFiles = srcContents.contents.slice(0, 3);
      keyFiles.push(...srcFiles.map((f: any) => f.path));
    }
    
    return keyFiles.slice(0, 5);
  }

  private async fetchCodeContent(repoUrl: string, filePaths: string[]): Promise<string> {
    let combinedContent = '';
    
    for (const filePath of filePaths) {
      const fileResult = await this.gitHubService.getFileContent(repoUrl, filePath);
      if (fileResult.success) {
        combinedContent += `\n// File: ${filePath}\n${fileResult.file.content}\n`;
      }
    }
    
    return combinedContent;
  }

  private analyzeCodeStructure(code: string): any {
    const lines = code.split('\n');
    
    return {
      imports: this.extractImports(lines),
      functions: this.extractFunctions(lines),
      classes: this.extractClasses(lines),
      variables: this.extractVariables(lines)
    };
  }

  private extractImports(lines: string[]): string[] {
    const imports: string[] = [];
    const importPatterns = [
      /^import\s+(.+)\s+from\s+['"](.+)['"]/, // ES6 imports
      /^import\s+['"](.+)['"]/, // Simple imports
      /^const\s+(.+)\s*=\s*require\(['"](.+)['"]\)/ // CommonJS
    ];

    lines.forEach(line => {
      const trimmed = line.trim();
      importPatterns.forEach(pattern => {
        const match = trimmed.match(pattern);
        if (match) {
          imports.push(match[2] || match[1]);
        }
      });
    });

    return [...new Set(imports)];
  }

  private extractFunctions(lines: string[]): string[] {
    const functions: string[] = [];
    const functionPatterns = [
      /function\s+(\w+)\s*\(/, // JavaScript function
      /def\s+(\w+)\s*\(/, // Python
      /(\w+)\s*\([^)]*\)\s*=>/ // Arrow function
    ];

    lines.forEach(line => {
      const trimmed = line.trim();
      functionPatterns.forEach(pattern => {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
          functions.push(match[1]);
        }
      });
    });

    return [...new Set(functions)];
  }

  private extractClasses(lines: string[]): string[] {
    const classes: string[] = [];
    const classPatterns = [
      /class\s+(\w+)/ // JavaScript/TypeScript/Python
    ];

    lines.forEach(line => {
      const trimmed = line.trim();
      classPatterns.forEach(pattern => {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
          classes.push(match[1]);
        }
      });
    });

    return [...new Set(classes)];
  }

  private extractVariables(lines: string[]): string[] {
    const variables: string[] = [];
    const varPatterns = [
      /(?:let|const|var)\s+(\w+)/ // JavaScript
    ];

    lines.forEach(line => {
      const trimmed = line.trim();
      varPatterns.forEach(pattern => {
        const match = trimmed.match(pattern);
        if (match && match[1] && match[1].length > 1) {
          variables.push(match[1]);
        }
      });
    });

    return [...new Set(variables)].slice(0, 10);
  }

  private detectCodePatterns(code: string): string[] {
    const patterns = [];
    
    if (code.includes('class ') && code.includes('extends')) patterns.push('Inheritance');
    if (code.includes('async') && code.includes('await')) patterns.push('Async/Await');
    if (code.includes('Promise')) patterns.push('Promises');
    if (code.includes('useState') || code.includes('useEffect')) patterns.push('React Hooks');
    
    return patterns;
  }

  private analyzeCodeArchitecture(code: string): string {
    if (code.includes('components') && code.includes('jsx')) return 'Component-Based (React)';
    if (code.includes('controller') && code.includes('model')) return 'MVC';
    if (code.includes('export')) return 'Modular';
    return 'Standard';
  }

  private assessCodeComplexity(code: string): 'Low' | 'Medium' | 'High' {
    const lines = code.split('\n').length;
    const functions = (code.match(/function|=>|def /g) || []).length;
    const classes = (code.match(/class /g) || []).length;
    
    const score = (lines / 200) + (functions / 15) + (classes / 8);
    
    if (score > 15) return 'High';
    if (score > 5) return 'Medium';
    return 'Low';
  }

  private calculateCodeQuality(code: string, structure: any): number {
    let score = 50;
    
    if (structure.functions.length > 0) score += 15;
    if (structure.classes.length > 0) score += 10;
    if (structure.imports.length > 0) score += 10;
    if (code.includes('test') || code.includes('spec')) score += 15;
    
    return Math.min(100, score);
  }

  private detectTechnologies(code: string): string[] {
    const technologies = [];
    
    if (code.includes('react') || code.includes('React')) technologies.push('React');
    if (code.includes('express')) technologies.push('Express.js');
    if (code.includes('typescript')) technologies.push('TypeScript');
    
    return technologies;
  }

  private generateCodeInsights(code: string, structure: any): string[] {
    const insights = [];
    const lines = code.split('\n').length;
    
    insights.push(`Analyzed ${lines} lines of actual code`);
    insights.push(`Found ${structure.functions.length} functions and ${structure.classes.length} classes`);
    
    if (structure.functions.length > 5) {
      insights.push('Well-structured with good function decomposition');
    }
    
    if (code.includes('async') && code.includes('await')) {
      insights.push('Uses modern async/await patterns');
    }
    
    return insights;
  }

  /**
   * Generate comprehensive repository explanation
   */
  private generateRepoExplanation(analysis: any): string {
    const { repository, codebase, architecture, structure } = analysis;
    
    let explanation = `${repository.name} is a ${codebase.primaryLanguage} project `;
    
    if (repository.description) {
      explanation += `that ${repository.description.toLowerCase()}. `;
    }
    
    explanation += `It uses ${architecture.type} architecture`;
    
    if (architecture.framework !== 'Unknown') {
      explanation += ` built with ${architecture.framework}`;
    }
    
    explanation += `. `;
    
    if (codebase.codeStructure?.functions?.length > 0) {
      explanation += `The codebase contains ${codebase.codeStructure.functions.length} functions`;
      if (codebase.codeStructure.classes.length > 0) {
        explanation += ` and ${codebase.codeStructure.classes.length} classes`;
      }
      explanation += `, indicating ${codebase.complexity.toLowerCase()} complexity. `;
    }
    
    if (architecture.technologies?.length > 0) {
      explanation += `Key technologies include ${architecture.technologies.join(', ')}. `;
    }
    
    if (codebase.insights?.length > 0) {
      explanation += codebase.insights[0] + '. ';
    }
    
    explanation += `With ${repository.stars} stars and ${repository.forks} forks, it's a ${repository.popularity.toLowerCase()} project in the community.`;
    
    return explanation;
  }

  /**
   * Generate architecture-focused explanation
   */
  private generateArchitectureExplanation(analysis: any): string {
    const { codebase, architecture, structure } = analysis;
    
    let explanation = `This project follows a ${architecture.type} architecture pattern. `;
    
    if (architecture.patterns?.length > 0) {
      explanation += `It implements ${architecture.patterns.join(', ')} design patterns. `;
    }
    
    if (codebase.codeStructure) {
      const { functions, classes, imports } = codebase.codeStructure;
      explanation += `The code is organized with ${functions.length} functions, ${classes.length} classes, and ${imports.length} external dependencies. `;
    }
    
    explanation += `The overall complexity is ${codebase.complexity.toLowerCase()}, making it ${codebase.complexity === 'Low' ? 'easy to understand and maintain' : codebase.complexity === 'Medium' ? 'moderately complex but manageable' : 'complex and requiring careful attention'}.`;
    
    if (architecture.technologies?.length > 0) {
      explanation += ` Core technologies: ${architecture.technologies.join(', ')}.`;
    }
    
    return explanation;
  }

  /**
   * Generate technical explanation
   */
  private generateTechnicalExplanation(analysis: any): string {
    const { repository, codebase, architecture, quality } = analysis;
    
    let explanation = `${repository.name} is technically implemented in ${codebase.primaryLanguage} `;
    
    if (codebase.codeQuality > 0) {
      explanation += `with a code quality score of ${codebase.codeQuality}%. `;
    }
    
    if (codebase.insights?.length > 0) {
      explanation += codebase.insights.slice(0, 2).join('. ') + '. ';
    }
    
    explanation += `The project demonstrates ${quality.maintainability.toLowerCase()} maintainability `;
    explanation += `and ${repository.activity.toLowerCase()} development activity. `;
    
    if (architecture.technologies?.length > 0) {
      explanation += `It leverages ${architecture.technologies.join(', ')} for implementation.`;
    }
    
    return explanation;
  }

  /**
   * Generate AI-powered explanation using Ollama
   */
  private async generateAIExplanation(analysis: any, userQuestion?: string): Promise<string> {
    try {
      const { repository, codebase, architecture, structure } = analysis;
      
      const prompt = `Explain this GitHub repository in a clear, comprehensive way:

Repository: ${repository.name}
Description: ${repository.description || 'No description'}
Language: ${codebase.primaryLanguage}
Stars: ${repository.stars}
Architecture: ${architecture.type}
Complexity: ${codebase.complexity}
Code Quality: ${codebase.codeQuality}%
Technologies: ${architecture.technologies?.join(', ') || 'None detected'}
Functions: ${codebase.codeStructure?.functions?.length || 0}
Classes: ${codebase.codeStructure?.classes?.length || 0}

${userQuestion ? `User asked: "${userQuestion}"` : ''}

Provide a clear, informative explanation about what this repository does, how it's built, and its key characteristics. Keep it concise but comprehensive.`;

      const appConfig = loadAppConfig();
      const explanation = await this.getOllamaProvider().generateText({
        prompt,
        model: appConfig.ollama.fastModel || appConfig.ollama.model
      });

      return explanation || this.generateRepoExplanation(analysis);
    } catch (error) {
      // Fallback to rule-based explanation if AI fails
      return this.generateRepoExplanation(analysis);
    }
  }
}
