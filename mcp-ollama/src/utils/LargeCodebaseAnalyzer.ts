import { OllamaProvider } from '../providers/OllamaProvider.js';
import { Logger } from './Logger.js';

export class LargeCodebaseAnalyzer {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private analysisCache = new Map<string, any>();

    constructor(ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
    }

    async analyzeEntireCodebase(files: string[], workspacePath: string): Promise<any> {
        this.logger.info(`🔍 Analyzing ${files.length} files in enterprise codebase`);
        
        // Phase 1: Quick structural analysis
        const structure = await this.analyzeCodeStructure(files);
        
        // Phase 2: Intelligent chunking by importance
        const chunks = this.createIntelligentChunks(files, structure);
        
        // Phase 3: Progressive analysis with user feedback
        return await this.progressiveAnalysis(chunks, workspacePath);
    }

    private async analyzeCodeStructure(files: string[]): Promise<any> {
        const structure = {
            coreFiles: [] as string[],
            testFiles: [] as string[],
            configFiles: [] as string[],
            utilityFiles: [] as string[],
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

    private createIntelligentChunks(files: string[], structure: any): any[] {
        // Priority-based chunking for million-line codebases
        return [
            { 
                name: 'Core Architecture', 
                files: structure.coreFiles.slice(0, 20),
                priority: 'high',
                timeout: 120000 // 2 minutes for core files
            },
            { 
                name: 'Business Logic', 
                files: structure.coreFiles.slice(20, 100),
                priority: 'medium',
                timeout: 60000
            },
            { 
                name: 'Supporting Files', 
                files: [...structure.utilityFiles, ...structure.configFiles],
                priority: 'low',
                timeout: 30000
            }
        ];
    }

    private async progressiveAnalysis(chunks: any[], workspacePath: string): Promise<any> {
        const results = {
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

    private async analyzeChunk(chunk: any, workspacePath: string): Promise<any> {
        const prompt = `Analyze this ${chunk.name} section of a large enterprise codebase:

Files: ${chunk.files.slice(0, 10).join(', ')}
Priority: ${chunk.priority}

Provide:
1. Key architectural patterns
2. Main components and their roles  
3. Potential issues or improvements
4. Dependencies and relationships

Focus on high-level insights for million-line codebase understanding.`;

        const response = await this.ollamaProvider.generateText({
            prompt,
            model: 'deepseek-r1:70b' // Use reasoning model for architecture
        });

        return this.parseChunkAnalysis(response);
    }

    private parseChunkAnalysis(response: string): any {
        const components = this.extractComponents(response);
        const recommendations = this.extractRecommendations(response);
        
        return { components, recommendations };
    }

    private extractComponents(text: string): string[] {
        const lines = text.split('\n');
        return lines
            .filter(line => line.includes('component') || line.includes('class') || line.includes('module'))
            .slice(0, 5)
            .map(line => line.trim());
    }

    private extractRecommendations(text: string): string[] {
        const lines = text.split('\n');
        return lines
            .filter(line => line.includes('recommend') || line.includes('improve') || line.includes('consider'))
            .slice(0, 3)
            .map(line => line.trim());
    }

    private async generateComprehensiveSummary(results: any): Promise<string> {
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
            model: 'deepseek-r1:70b'
        });
    }
}