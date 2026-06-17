import fs from 'fs';
import path from 'path';
import { WorkflowStep } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';

export interface DLQEntry {
    id: string;
    taskId: string;
    step: WorkflowStep;
    error: string;
    attempts: number;
    failedAt: string;
    context?: Record<string, unknown>;
}

/**
 * Dead Letter Queue — persists failed workflow steps to disk so they can be
 * inspected and selectively replayed without restarting the server.
 *
 * File: <logsDir>/dlq.json  (one JSON array, rewritten on each mutation)
 * Env: DLQ_PATH overrides the default path.
 */
export class DeadLetterQueue {
    private readonly filePath: string;
    private readonly logger = new Logger();
    private entries: DLQEntry[] = [];

    constructor() {
        this.filePath = process.env.DLQ_PATH
            ?? path.join(process.cwd(), 'logs', 'dlq.json');
        this.load();
    }

    push(entry: Omit<DLQEntry, 'id' | 'failedAt'>): void {
        const record: DLQEntry = {
            ...entry,
            id: `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            failedAt: new Date().toISOString(),
        };
        this.entries.push(record);
        this.persist();
        this.logger.warn(`DLQ: enqueued failed step "${record.step.action}" (task ${record.taskId})`);
    }

    list(): DLQEntry[] {
        return [...this.entries];
    }

    remove(id: string): boolean {
        const before = this.entries.length;
        this.entries = this.entries.filter(e => e.id !== id);
        if (this.entries.length !== before) {
            this.persist();
            return true;
        }
        return false;
    }

    clear(): void {
        this.entries = [];
        this.persist();
    }

    size(): number {
        return this.entries.length;
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.entries = parsed as DLQEntry[];
                    if (this.entries.length > 0) {
                        this.logger.info(`DLQ: loaded ${this.entries.length} unresolved entries from ${this.filePath}`);
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`DLQ: failed to load from disk — starting empty: ${error instanceof Error ? error.message : error}`);
            this.entries = [];
        }
    }

    private persist(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf8');
        } catch (error) {
            this.logger.error(`DLQ: failed to persist to disk: ${error instanceof Error ? error.message : error}`);
        }
    }
}

// Singleton so WorkflowExecutor and HTTPServer share the same instance
let instance: DeadLetterQueue | null = null;
export function getDLQ(): DeadLetterQueue {
    if (!instance) instance = new DeadLetterQueue();
    return instance;
}
