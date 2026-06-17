import type { HallucinationReport } from './HallucinationDetector.js';

export interface HallucinationMetricsSummary {
  sampleCount: number;
  /** Average hallucination rate across measured tasks (0–1). */
  hallucinationRate: number | null;
  /** Average grounded score (1 − hallucinationRate). */
  groundedRate: number | null;
  highRiskCount: number;
  highRiskPercent: number;
  byTaskType: Record<string, { count: number; avgHallucinationRate: number }>;
  recent: Array<{
    taskId?: string;
    taskType: string;
    hallucinationRate: number;
    flagCount: number;
    measuredAt: string;
  }>;
}

interface Sample {
  taskId?: string;
  taskType: string;
  report: HallucinationReport;
}

/**
 * In-process aggregator for hallucination measurements (survives until server restart).
 */
export class HallucinationMetrics {
  private static instance: HallucinationMetrics;
  private samples: Sample[] = [];
  private readonly maxSamples = 500;

  static getInstance(): HallucinationMetrics {
    if (!HallucinationMetrics.instance) {
      HallucinationMetrics.instance = new HallucinationMetrics();
    }
    return HallucinationMetrics.instance;
  }

  record(report: HallucinationReport, meta: { taskId?: string; taskType?: string } = {}): void {
    const sample: Sample = {
      taskType: meta.taskType || 'unknown',
      report,
    };
    if (meta.taskId) sample.taskId = meta.taskId;
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }
  }

  reset(): void {
    this.samples = [];
  }

  getSummary(): HallucinationMetricsSummary {
    if (this.samples.length === 0) {
      return {
        sampleCount: 0,
        hallucinationRate: null,
        groundedRate: null,
        highRiskCount: 0,
        highRiskPercent: 0,
        byTaskType: {},
        recent: [],
      };
    }

    const rates = this.samples.map((s) => s.report.hallucinationRate);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const highRisk = this.samples.filter((s) => s.report.hallucinationRate >= 0.5);

    const byTaskType: Record<string, { count: number; total: number }> = {};
    for (const s of this.samples) {
      const bucket = byTaskType[s.taskType] || { count: 0, total: 0 };
      bucket.count += 1;
      bucket.total += s.report.hallucinationRate;
      byTaskType[s.taskType] = bucket;
    }

    const byTaskTypeOut: HallucinationMetricsSummary['byTaskType'] = {};
    for (const [taskType, { count, total }] of Object.entries(byTaskType)) {
      byTaskTypeOut[taskType] = {
        count,
        avgHallucinationRate: Math.round((total / count) * 1000) / 1000,
      };
    }

    return {
      sampleCount: this.samples.length,
      hallucinationRate: Math.round(avgRate * 1000) / 1000,
      groundedRate: Math.round((1 - avgRate) * 1000) / 1000,
      highRiskCount: highRisk.length,
      highRiskPercent: Math.round((highRisk.length / this.samples.length) * 1000) / 10,
      byTaskType: byTaskTypeOut,
      recent: this.samples.slice(-8).map((s) => {
        const entry: HallucinationMetricsSummary['recent'][number] = {
          taskType: s.taskType,
          hallucinationRate: s.report.hallucinationRate,
          flagCount: s.report.flags.length,
          measuredAt: s.report.measuredAt,
        };
        if (s.taskId) entry.taskId = s.taskId;
        return entry;
      }),
    };
  }
}
