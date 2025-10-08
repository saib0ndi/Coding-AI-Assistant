import { OllamaProvider } from '../providers/OllamaProvider.js';
import { Logger } from '../utils/Logger.js';

export class CodeHealthAgent {
    private logger: Logger;
    private ollamaProvider: OllamaProvider;
    private healthHistory = new Map<string, any[]>();

    constructor(ollamaProvider: OllamaProvider) {
        this.logger = new Logger();
        this.ollamaProvider = ollamaProvider;
    }

    async analyzeCodeHealth(code: string, language: string, filePath: string): Promise<any> {
        const prompt = `Analyze code health for this ${language} file:

${code}

Rate (1-10) and explain:
- Technical debt
- Code complexity  
- Maintainability
- Performance risks
- Security concerns

Provide brief analysis:`;

        const analysis = await this.ollamaProvider.generateText({ prompt, model: 'llama3.1:8b-instruct-q4_K_M' });

        const health = this.parseHealthAnalysis(analysis);
        this.recordHealthHistory(filePath, health);

        return {
            overallScore: health.overall,
            technicalDebt: health.debt,
            complexity: health.complexity,
            maintainability: health.maintainability,
            performance: health.performance,
            security: health.security,
            analysis,
            trends: this.getHealthTrends(filePath)
        };
    }

    private parseHealthAnalysis(analysis: string): any {
        const scores = {
            overall: 7,
            debt: 7,
            complexity: 7,
            maintainability: 7,
            performance: 7,
            security: 7
        };

        // Extract numeric scores from analysis
        const patterns = {
            debt: /technical debt.*?(\d+)/i,
            complexity: /complexity.*?(\d+)/i,
            maintainability: /maintainability.*?(\d+)/i,
            performance: /performance.*?(\d+)/i,
            security: /security.*?(\d+)/i
        };

        for (const [key, pattern] of Object.entries(patterns)) {
            const match = analysis.match(pattern);
            if (match) {
                scores[key as keyof typeof scores] = parseInt(match[1]);
            }
        }

        scores.overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
        return scores;
    }

    private recordHealthHistory(filePath: string, health: any): void {
        if (!this.healthHistory.has(filePath)) {
            this.healthHistory.set(filePath, []);
        }
        
        const history = this.healthHistory.get(filePath)!;
        history.push({ ...health, timestamp: Date.now() });
        
        // Keep only last 10 entries
        if (history.length > 10) {
            history.splice(0, history.length - 10);
        }
    }

    private getHealthTrends(filePath: string): any {
        const history = this.healthHistory.get(filePath) || [];
        if (history.length < 2) {
            return { trend: 'insufficient_data' };
        }

        const recent = history[history.length - 1];
        const previous = history[history.length - 2];

        return {
            trend: recent.overall > previous.overall ? 'improving' : 
                   recent.overall < previous.overall ? 'declining' : 'stable',
            change: recent.overall - previous.overall
        };
    }
}