export interface PerformanceMetrics {
  fixSuccessRate: number;
  averageFixTime: number;
  totalErrorsFixed: number;
  languageStats: Record<string, number>;
  errorTypeStats: Record<string, number>;
  userSatisfactionScore: number;
}

export class PerformanceTracker {
  private metrics: Map<string, any> = new Map();
  private fixHistory: Array<{
    timestamp: number;
    errorType: string;
    language: string;
    fixTime: number;
    success: boolean;
    userRating?: number;
  }> = [];

  recordFix(errorType: string, language: string, fixTime: number, success: boolean, userRating?: number): void {
    const fixRecord: {
      timestamp: number;
      errorType: string;
      language: string;
      fixTime: number;
      success: boolean;
      userRating?: number;
    } = {
      timestamp: Date.now(),
      errorType,
      language,
      fixTime,
      success
    };
    
    if (userRating !== undefined) {
      fixRecord.userRating = userRating;
    }
    
    this.fixHistory.push(fixRecord);
    this.updateMetrics();
  }

  private updateMetrics(): void {
    const recent = this.fixHistory.filter(f => Date.now() - f.timestamp < 30 * 24 * 60 * 60 * 1000);
    
    const successfulFixes = recent.filter(f => f.success);
    const fixSuccessRate = recent.length > 0 ? successfulFixes.length / recent.length : 0;
    
    const averageFixTime = successfulFixes.length > 0 
      ? successfulFixes.reduce((sum, f) => sum + f.fixTime, 0) / successfulFixes.length 
      : 0;

    const languageStats: Record<string, number> = {};
    const errorTypeStats: Record<string, number> = {};
    
    recent.forEach(f => {
      languageStats[f.language] = (languageStats[f.language] || 0) + 1;
      errorTypeStats[f.errorType] = (errorTypeStats[f.errorType] || 0) + 1;
    });

    const ratingsWithValues = recent.filter(f => f.userRating !== undefined);
    const userSatisfactionScore = ratingsWithValues.length > 0
      ? ratingsWithValues.reduce((sum, f) => sum + (f.userRating || 0), 0) / ratingsWithValues.length
      : 0;

    this.metrics.set('current', {
      fixSuccessRate,
      averageFixTime,
      totalErrorsFixed: successfulFixes.length,
      languageStats,
      errorTypeStats,
      userSatisfactionScore
    });
  }

  getMetrics(): PerformanceMetrics {
    return this.metrics.get('current') || {
      fixSuccessRate: 0,
      averageFixTime: 0,
      totalErrorsFixed: 0,
      languageStats: {},
      errorTypeStats: {},
      userSatisfactionScore: 0
    };
  }

  generateReport(): string {
    const metrics = this.getMetrics();
    return `Performance Report:
- Fix Success Rate: ${(metrics.fixSuccessRate * 100).toFixed(1)}%
- Average Fix Time: ${metrics.averageFixTime.toFixed(0)}ms
- Total Errors Fixed: ${metrics.totalErrorsFixed}
- User Satisfaction: ${metrics.userSatisfactionScore.toFixed(1)}/5`;
  }
}
