/**
 * Minimal Prometheus-compatible metrics registry.
 * No external dependencies — emits the standard text exposition format.
 *
 * Supports three instrument types:
 *   counter   — monotonically increasing (requests, errors)
 *   gauge     — arbitrary up/down value (active tasks, queue depth)
 *   histogram — bucketed latency observations
 */

interface LabelSet { [key: string]: string }

function labelStr(labels: LabelSet): string {
    const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    return pairs.length ? `{${pairs.join(',')}}` : '';
}

function metricKey(name: string, labels: LabelSet): string {
    return `${name}${labelStr(labels)}`;
}

// ── Counter ──────────────────────────────────────────────────────────────────

class Counter {
    readonly name: string;
    readonly help: string;
    private readonly values = new Map<string, number>();

    constructor(name: string, help: string) { this.name = name; this.help = help; }

    inc(labels: LabelSet = {}, by = 1): void {
        const k = metricKey(this.name, labels);
        this.values.set(k, (this.values.get(k) ?? 0) + by);
    }

    format(): string {
        const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
        for (const [k, v] of this.values) lines.push(`${k} ${v}`);
        return lines.join('\n');
    }
}

// ── Gauge ─────────────────────────────────────────────────────────────────────

class Gauge {
    readonly name: string;
    readonly help: string;
    private readonly values = new Map<string, number>();

    constructor(name: string, help: string) { this.name = name; this.help = help; }

    set(value: number, labels: LabelSet = {}): void {
        this.values.set(metricKey(this.name, labels), value);
    }

    inc(labels: LabelSet = {}, by = 1): void {
        const k = metricKey(this.name, labels);
        this.values.set(k, (this.values.get(k) ?? 0) + by);
    }

    dec(labels: LabelSet = {}, by = 1): void {
        const k = metricKey(this.name, labels);
        this.values.set(k, (this.values.get(k) ?? 0) - by);
    }

    format(): string {
        const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
        for (const [k, v] of this.values) lines.push(`${k} ${v}`);
        return lines.join('\n');
    }
}

// ── Histogram ────────────────────────────────────────────────────────────────

const DEFAULT_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

class Histogram {
    readonly name: string;
    readonly help: string;
    private readonly buckets: number[];
    private readonly counts = new Map<string, number[]>();   // bucket counts
    private readonly sums = new Map<string, number>();
    private readonly totals = new Map<string, number>();

    constructor(name: string, help: string, buckets = DEFAULT_BUCKETS) {
        this.name = name;
        this.help = help;
        this.buckets = [...buckets].sort((a, b) => a - b);
    }

    observe(value: number, labels: LabelSet = {}): void {
        const key = JSON.stringify(labels);
        if (!this.counts.has(key)) {
            this.counts.set(key, new Array(this.buckets.length).fill(0));
            this.sums.set(key, 0);
            this.totals.set(key, 0);
        }
        const bkts = this.counts.get(key)!;
        for (let i = 0; i < this.buckets.length; i++) {
            if (value <= this.buckets[i]) bkts[i]++;
        }
        this.sums.set(key, this.sums.get(key)! + value);
        this.totals.set(key, this.totals.get(key)! + 1);
    }

    format(): string {
        const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
        for (const [key, bkts] of this.counts) {
            const labels: LabelSet = JSON.parse(key);
            const base = labelStr(labels);
            // buckets
            for (let i = 0; i < this.buckets.length; i++) {
                const bLabel = labelStr({ ...labels, le: String(this.buckets[i]) });
                lines.push(`${this.name}_bucket${bLabel} ${bkts[i]}`);
            }
            lines.push(`${this.name}_bucket${labelStr({ ...labels, le: '+Inf' })} ${this.totals.get(key) ?? 0}`);
            lines.push(`${this.name}_sum${base} ${this.sums.get(key) ?? 0}`);
            lines.push(`${this.name}_count${base} ${this.totals.get(key) ?? 0}`);
        }
        return lines.join('\n');
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

class MetricsRegistry {
    private readonly instruments = new Map<string, Counter | Gauge | Histogram>();

    counter(name: string, help: string): Counter {
        if (!this.instruments.has(name)) this.instruments.set(name, new Counter(name, help));
        return this.instruments.get(name) as Counter;
    }

    gauge(name: string, help: string): Gauge {
        if (!this.instruments.has(name)) this.instruments.set(name, new Gauge(name, help));
        return this.instruments.get(name) as Gauge;
    }

    histogram(name: string, help: string, buckets?: number[]): Histogram {
        if (!this.instruments.has(name)) this.instruments.set(name, new Histogram(name, help, buckets));
        return this.instruments.get(name) as Histogram;
    }

    format(): string {
        return Array.from(this.instruments.values()).map(i => i.format()).join('\n\n') + '\n';
    }
}

// Singleton
const registry = new MetricsRegistry();
export default registry;

// ── Pre-registered instruments ────────────────────────────────────────────────

export const httpRequestsTotal = registry.counter(
    'mcp_http_requests_total',
    'Total HTTP requests received'
);
export const httpRequestDurationMs = registry.histogram(
    'mcp_http_request_duration_ms',
    'HTTP request latency in milliseconds'
);
export const activeTasksGauge = registry.gauge(
    'mcp_active_tasks',
    'Number of agent tasks currently executing'
);
export const agentErrorsTotal = registry.counter(
    'mcp_agent_errors_total',
    'Total agent task failures'
);
export const workflowStepDurationMs = registry.histogram(
    'mcp_workflow_step_duration_ms',
    'Workflow step execution latency in milliseconds'
);
export const circuitBreakerState = registry.gauge(
    'mcp_circuit_breaker_state',
    'Circuit breaker state per agent role: 0=closed 1=half-open 2=open'
);
export const dlqSizeGauge = registry.gauge(
    'mcp_dlq_size',
    'Number of entries in the Dead Letter Queue'
);
