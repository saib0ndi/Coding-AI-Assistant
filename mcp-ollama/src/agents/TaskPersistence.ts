import fs from 'fs';
import path from 'path';
import { AgentTask } from '../types/agent.js';
import { Logger } from '../utils/Logger.js';

interface PersistedTask {
    taskId: string;
    type: AgentTask['type'];
    description: string;
    status: AgentTask['status'];
    priority: AgentTask['priority'];
    startedAt: string;
    updatedAt: string;
}

/**
 * Persists active task state to disk so in-flight tasks are recoverable
 * after a server restart. Tasks are written on start and removed on
 * completion/failure. At startup, any leftover entries are logged as
 * "interrupted" so operators know work was lost.
 *
 * File: <logsDir>/tasks.json  (one JSON object keyed by taskId)
 * Env: TASK_PERSISTENCE_PATH overrides the default path.
 */
export class TaskPersistence {
    private readonly filePath: string;
    private readonly logger = new Logger();
    private tasks: Map<string, PersistedTask> = new Map();

    constructor() {
        this.filePath = process.env.TASK_PERSISTENCE_PATH
            ?? path.join(process.cwd(), 'logs', 'tasks.json');
        this.load();
    }

    save(task: AgentTask): void {
        const record: PersistedTask = {
            taskId: task.id,
            type: task.type,
            description: task.description,
            status: task.status,
            priority: task.priority,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.tasks.set(task.id, record);
        this.persist();
    }

    update(taskId: string, status: AgentTask['status']): void {
        const existing = this.tasks.get(taskId);
        if (existing) {
            existing.status = status;
            existing.updatedAt = new Date().toISOString();
            this.persist();
        }
    }

    remove(taskId: string): void {
        if (this.tasks.delete(taskId)) this.persist();
    }

    listInterrupted(): PersistedTask[] {
        return Array.from(this.tasks.values()).filter(
            t => t.status === 'planning' || t.status === 'executing'
        );
    }

    private load(): void {
        try {
            if (!fs.existsSync(this.filePath)) return;
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, PersistedTask>;
            this.tasks = new Map(Object.entries(parsed));

            const interrupted = this.listInterrupted();
            if (interrupted.length > 0) {
                this.logger.warn(
                    `TaskPersistence: ${interrupted.length} task(s) were interrupted by a previous shutdown: ` +
                    interrupted.map(t => `${t.taskId} (${t.type})`).join(', ')
                );
            }
        } catch (error) {
            this.logger.warn(`TaskPersistence: failed to load — starting fresh: ${error instanceof Error ? error.message : error}`);
            this.tasks = new Map();
        }
    }

    private persist(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const obj = Object.fromEntries(this.tasks.entries());
            fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
        } catch (error) {
            this.logger.error(`TaskPersistence: failed to persist: ${error instanceof Error ? error.message : error}`);
        }
    }
}
