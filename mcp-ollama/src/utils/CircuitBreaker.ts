export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
    failureThreshold: number;  // consecutive failures before opening
    successThreshold: number;  // successes in half-open before closing
    cooldownMs: number;        // time in open state before trying half-open
    label: string;
}

const DEFAULTS: CircuitBreakerOptions = {
    failureThreshold: 5,
    successThreshold: 2,
    cooldownMs: 30_000,
    label: 'unknown',
};

export class CircuitBreaker {
    private state: CircuitState = 'closed';
    private failures = 0;
    private successes = 0;
    private openedAt = 0;
    private readonly opts: CircuitBreakerOptions;

    constructor(opts: Partial<CircuitBreakerOptions> = {}) {
        this.opts = { ...DEFAULTS, ...opts };
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.openedAt >= this.opts.cooldownMs) {
                this.state = 'half-open';
                this.successes = 0;
            } else {
                const remaining = Math.round((this.opts.cooldownMs - (Date.now() - this.openedAt)) / 1000);
                throw new Error(`Circuit [${this.opts.label}] is OPEN — cooldown ${remaining}s remaining`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    getState(): CircuitState { return this.state; }
    getFailures(): number { return this.failures; }

    getStats(): { state: CircuitState; failures: number; successes: number; openedAt: number | null } {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            openedAt: this.state !== 'closed' ? this.openedAt : null,
        };
    }

    reset(): void {
        this.state = 'closed';
        this.failures = 0;
        this.successes = 0;
        this.openedAt = 0;
    }

    private onSuccess(): void {
        this.failures = 0;
        if (this.state === 'half-open') {
            this.successes++;
            if (this.successes >= this.opts.successThreshold) {
                this.state = 'closed';
                this.successes = 0;
            }
        }
    }

    private onFailure(): void {
        this.failures++;
        if (this.state === 'half-open') {
            // Any failure in half-open re-opens immediately
            this.state = 'open';
            this.openedAt = Date.now();
            return;
        }
        if (this.state === 'closed' && this.failures >= this.opts.failureThreshold) {
            this.state = 'open';
            this.openedAt = Date.now();
        }
    }
}
