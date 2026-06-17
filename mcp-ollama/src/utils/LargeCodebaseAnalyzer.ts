import { OllamaProvider } from '../providers/OllamaProvider.js';
import { Logger } from './Logger.js';
import { loadAppConfig } from '../config/AppConfig.js';

export interface LargeCodebaseAnalyzerOptions {
    coreArchitectureFileLimit?: number;
    businessLogicFileLimit?: number;
    filePreviewLimit?: number;
    componentLimit?: number;
    recommendationLimit?: number;
    coreArchitectureTimeoutMs?: number;
    businessLogicTimeoutMs?: number;
    supportingFilesTimeoutMs?: number;
}

interface LargeCodebaseAnalyzerConfig {
    coreArchitectureFileLimit: number;
    businessLogicFileLimit: number;
    filePreviewLimit: number;
    componentLimit: number;
    recommendationLimit: number;
    coreArchitectureTimeoutMs: number;
    businessLogicTimeoutMs: number;
    supportingFilesTimeoutMs: number;
}

interface CodebaseStructure {
    coreFiles: string[];
    testFiles: string[];
    configFiles: string[];
    utilityFiles: string[];
    totalLines: number;
    languages: Set<string>;
}

type AnalysisPriority = 'high' | 'medium' | 'low';

interface AnalysisChunk {
    name: string;
    files: string[];
    priority: AnalysisPriority;
    timeout: number;
}

interface ChunkAnalysis {
    components: string[];
    recommendations: string[];
}

export interface CodebaseAnalysisResult {
    summary: string;
    architecture: string;
    keyComponents: string[];
    recommendations: string[];
    processedChunks: number;
    totalChunks: number;
}

export class LargeCodebaseAnalyzer {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private analysisCache = new Map<string, CodebaseAnalysisResult>();
    private config: LargeCodebaseAnalyzerConfig;

    constructor(ollamaProvider: OllamaProvider, options: LargeCodebaseAnalyzerOptions = {}) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
        const appConfig = loadAppConfig();
        this.config = {
            coreArchitectureFileLimit: options.coreArchitectureFileLimit ?? appConfig.largeCodebase.coreFileLimit,
            businessLogicFileLimit: options.businessLogicFileLimit ?? appConfig.largeCodebase.businessFileLimit,
            filePreviewLimit: options.filePreviewLimit ?? appConfig.largeCodebase.filePreviewLimit,
            componentLimit: options.componentLimit ?? appConfig.largeCodebase.componentLimit,
            recommendationLimit: options.recommendationLimit ?? appConfig.largeCodebase.recommendationLimit,
            coreArchitectureTimeoutMs: options.coreArchitectureTimeoutMs ?? appConfig.largeCodebase.coreTimeoutMs,
            businessLogicTimeoutMs: options.businessLogicTimeoutMs ?? appConfig.largeCodebase.businessTimeoutMs,
            supportingFilesTimeoutMs: options.supportingFilesTimeoutMs ?? appConfig.largeCodebase.supportingTimeoutMs,
        };
    }

    async analyzeEntireCodebase(files: string[], workspacePath: string): Promise<CodebaseAnalysisResult> {
        this.logger.info(`🔍 Analyzing ${files.length} files in enterprise codebase`);
        const cacheKey = `${workspacePath}:${files.join('|')}`;
        const cached = this.analysisCache.get(cacheKey);
        if (cached) return cached;
        
        // Phase 1: Quick structural analysis
        const structure = await this.analyzeCodeStructure(files);
        
        // Phase 2: Intelligent chunking by importance
        const chunks = this.createIntelligentChunks(structure);
        
        // Phase 3: Progressive analysis with user feedback
        const result = await this.progressiveAnalysis(chunks, workspacePath);
        this.analysisCache.set(cacheKey, result);
        return result;
    }

    private async analyzeCodeStructure(files: string[]): Promise<CodebaseStructure> {
        const structure: CodebaseStructure = {
            coreFiles: [],
            testFiles: [],
            configFiles: [],
            utilityFiles: [],
            totalLines: 0,
            languages: new Set<string>()
        };

        for (const file of files) {
            const ext = file.split('.').pop()?.toLowerCase();
            if (ext) structure.languages.add(ext);

            if (file.includes('test') || file.includes('spec')) {
                structure.testFiles.push(file);
            } else if (file.includes('config') || file.includes('.json')) {
                structure.configFiles.push(file);
            } else if (file.includes('util') || file.includes('helper')) {
                structure.utilityFiles.push(file);
            } else {
                structure.coreFiles.push(file);
            }
        }

        return structure;
    }

    private createIntelligentChunks(structure: CodebaseStructure): AnalysisChunk[] {
        const coreEnd = this.config.coreArchitectureFileLimit;
        const businessEnd = coreEnd + this.config.businessLogicFileLimit;

        // Priority-based chunking for million-line codebases
        return [
            { 
                name: 'Core Architecture', 
                files: structure.coreFiles.slice(0, coreEnd),
                priority: 'high',
                timeout: this.config.coreArchitectureTimeoutMs
            },
            { 
                name: 'Business Logic', 
                files: structure.coreFiles.slice(coreEnd, businessEnd),
                priority: 'medium',
                timeout: this.config.businessLogicTimeoutMs
            },
            { 
                name: 'Supporting Files', 
                files: [...structure.utilityFiles, ...structure.configFiles],
                priority: 'low',
                timeout: this.config.supportingFilesTimeoutMs
            }
        ];
    }

    private async progressiveAnalysis(chunks: AnalysisChunk[], workspacePath: string): Promise<CodebaseAnalysisResult> {
        const results: CodebaseAnalysisResult = {
            summary: '',
            architecture: '',
            keyComponents: [] as string[],
            recommendations: [] as string[],
            processedChunks: 0,
            totalChunks: chunks.length
        };

        for (const chunk of chunks) {
            this.logger.info(`📊 Analyzing ${chunk.name} (${chunk.files.length} files)`);
            
            try {
                const chunkAnalysis = await this.analyzeChunk(chunk, workspacePath);
                results.keyComponents.push(...chunkAnalysis.components);
                results.recommendations.push(...chunkAnalysis.recommendations);
                results.processedChunks++;
                
                // Update user with progress
                this.logger.info(`✅ Completed ${chunk.name} - ${results.processedChunks}/${results.totalChunks}`);
                
            } catch (error) {
                this.logger.warn(`⚠️ Skipped ${chunk.name} due to complexity`);
            }
        }

        results.summary = await this.generateComprehensiveSummary(results);
        return results;
    }

    private async analyzeChunk(chunk: AnalysisChunk, workspacePath: string): Promise<ChunkAnalysis> {
        const prompt = `Analyze this ${chunk.name} section of a large enterprise codebase:

Workspace: ${workspacePath}
Files: ${chunk.files.slice(0, this.config.filePreviewLimit).join(', ')}
Priority: ${chunk.priority}

Provide:
1. Key architectural patterns
2. Main components and their roles  
3. Potential issues or improvements
4. Dependencies and relationships

Focus on high-level insights for million-line codebase understanding.`;

        const response = await this.ollamaProvider.generateText({
            prompt,
            model: this.ollamaProvider.getModel(undefined, 'code') // Use reasoning model for architecture
        });

        return this.parseChunkAnalysis(response);
    }

    private parseChunkAnalysis(response: string): ChunkAnalysis {
        const components = this.extractComponents(response);
        const recommendations = this.extractRecommendations(response);
        
        return { components, recommendations };
    }

    private extractComponents(text: string): string[] {
        const lines = text.split('\n');
        return lines
            .filter(line => line.includes('component') || line.includes('class') || line.includes('module'))
            .slice(0, this.config.componentLimit)
            .map(line => line.trim());
    }

    private extractRecommendations(text: string): string[] {
        const lines = text.split('\n');
        return lines
            .filter(line => line.includes('recommend') || line.includes('improve') || line.includes('consider'))
            .slice(0, this.config.recommendationLimit)
            .map(line => line.trim());
    }

    private async generateComprehensiveSummary(results: CodebaseAnalysisResult): Promise<string> {
        const prompt = `Generate executive summary for enterprise codebase analysis:

Processed: ${results.processedChunks}/${results.totalChunks} sections
Key Components: ${results.keyComponents.length}
Recommendations: ${results.recommendations.length}

Provide 3-paragraph executive summary focusing on:
1. Overall architecture and scale
2. Key strengths and technical debt
3. Strategic recommendations for development team`;

        return await this.ollamaProvider.generateText({
            prompt,
            model: this.ollamaProvider.getModel(undefined, 'code')
        });
    }
}
