import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger.js';
import { EmbeddingService } from '../indexing/EmbeddingService.js';

/**
 * TaskMemory — persistent, cross-task learning for the autonomous agent.
 *
 * Every completed task is recorded as an "episode": what was asked, the plan
 * that actually ran, whether it succeeded, how much correction/re-planning it
 * needed, and why steps failed. Before planning a new task, the agent recalls
 * the most similar past episodes and feeds their lessons into the planner so it
 * can repeat what worked and avoid what failed.
 *
 * This is the difference between *retrieval* (look up code) and *learning*
 * (accumulate outcomes over time and let them shape future behavior).
 *
 * Storage: a bounded JSON ring buffer on disk (default logs/task-memory.json,
 * override with TASK_MEMORY_PATH). Recall uses embedding cosine similarity when
 * embeddings are available, falling back to lexical token overlap so it still
 * works when the embedding backend is degraded.
 */

export interface TaskEpisode {
    id: string;
    description: string;
    taskType?: string;
    success: boolean;
    summary: string;
    /** Actions that executed (successful steps), in order. */
    planSteps: string[];
    corrections: number;
    replans: number;
    /** Concrete validation reasons for steps that failed. */
    failureReasons: string[];
    filesModified: string[];
    embedding: number[];
    createdAt: string;
}

export interface RecalledEpisode {
    episode: TaskEpisode;
    score: number;
}

/** Minimal embedder contract so tests can inject a deterministic fake. */
export interface EmbedderLike {
    embed(text: string): Promise<number[]>;
}

const DEFAULT_MAX_EPISODES = 500;

export class TaskMemory {
    private readonly logger = new Logger();
    private readonly filePath: string;
    private readonly maxEpisodes: number;
    private readonly explicitEmbedder: EmbedderLike | undefined;
    private episodes: TaskEpisode[] = [];
    private loaded = false;

    constructor(opts?: { path?: string; embedder?: EmbedderLike; maxEpisodes?: number }) {
        this.filePath =
            opts?.path ??
            process.env.TASK_MEMORY_PATH ??
            path.join(process.cwd(), 'logs', 'task-memory.json');
        this.maxEpisodes = opts?.maxEpisodes ?? DEFAULT_MAX_EPISODES;
        this.explicitEmbedder = opts?.embedder;
    }

    /** Record a completed task. Best-effort: never throws into the caller. */
    async record(input: {
        description: string;
        taskType?: string;
        success: boolean;
        summary: string;
        planSteps: string[];
        corrections: number;
        replans: number;
        failureReasons?: string[];
        filesModified?: string[];
    }): Promise<void> {
        try {
            this.ensureLoaded();
            const embedding = await this.safeEmbed(input.description);
            const episode: TaskEpisode = {
                id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                description: input.description.slice(0, 1000),
                success: input.success,
                summary: (input.summary || '').slice(0, 500),
                planSteps: (input.planSteps || []).slice(0, 12).map((s) => s.slice(0, 200)),
                corrections: input.corrections ?? 0,
                replans: input.replans ?? 0,
                failureReasons: (input.failureReasons || []).slice(0, 8).map((s) => s.slice(0, 200)),
                filesModified: (input.filesModified || []).slice(0, 20),
                embedding,
                createdAt: new Date().toISOString(),
            };
            if (input.taskType) episode.taskType = input.taskType;
            this.episodes.push(episode);
            if (this.episodes.length > this.maxEpisodes) {
                this.episodes = this.episodes.slice(-this.maxEpisodes);
            }
            this.persist();
        } catch (error) {
            this.logger.warn(
                `TaskMemory.record failed (non-fatal): ${error instanceof Error ? error.message : error}`
            );
        }
    }

    /** Recall the most similar past episodes for a new task description. */
    async recall(description: string, limit = 3): Promise<RecalledEpisode[]> {
        this.ensureLoaded();
        if (this.episodes.length === 0) return [];

        const queryEmbedding = await this.safeEmbed(description);
        const queryTokens = tokenize(description);

        const scored: RecalledEpisode[] = this.episodes.map((episode) => {
            let score: number;
            if (queryEmbedding.length > 0 && episode.embedding.length === queryEmbedding.length) {
                score = EmbeddingService.cosineSimilarity(queryEmbedding, episode.embedding);
            } else {
                score = lexicalOverlap(queryTokens, tokenize(episode.description));
            }
            return { episode, score };
        });

        return scored
            .filter((s) => s.score > 0.1)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Render a compact "lessons learned" block for injection into the planner
     * prompt. Returns '' when nothing relevant is known.
     */
    async renderLessons(description: string, limit = 3): Promise<string> {
        const recalled = await this.recall(description, limit);
        if (recalled.length === 0) return '';

        const lines = recalled.map(({ episode }) => {
            if (episode.success) {
                const plan = episode.planSteps.slice(0, 5).join(' | ') || '(no recorded steps)';
                return `- [WORKED] "${episode.description}" → approach: ${plan}`;
            }
            const reasons = episode.failureReasons.slice(0, 3).join('; ') || episode.summary;
            return `- [FAILED] "${episode.description}" → avoid: ${reasons}`;
        });

        return `Lessons from similar past tasks (repeat what worked, avoid what failed):\n${lines.join('\n')}`;
    }

    /** Number of episodes currently held (for stats/health). */
    size(): number {
        this.ensureLoaded();
        return this.episodes.length;
    }

    private async safeEmbed(text: string): Promise<number[]> {
        try {
            const embedder = await this.getEmbedder();
            if (!embedder) return [];
            const vec = await embedder.embed(text.slice(0, 8000));
            return Array.isArray(vec) ? vec : [];
        } catch {
            return [];
        }
    }

    private async getEmbedder(): Promise<EmbedderLike | undefined> {
        if (this.explicitEmbedder) return this.explicitEmbedder;
        return getSharedEmbedder();
    }

    private ensureLoaded(): void {
        if (this.loaded) return;
        this.loaded = true;
        try {
            if (!fs.existsSync(this.filePath)) return;
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.episodes = parsed.filter(isEpisode).slice(-this.maxEpisodes);
            }
        } catch (error) {
            this.logger.warn(
                `TaskMemory: failed to load — starting fresh: ${error instanceof Error ? error.message : error}`
            );
            this.episodes = [];
        }
    }

    private persist(): void {
        try {
            const dir = path.dirname(this.filePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.episodes), 'utf8');
        } catch (error) {
            this.logger.warn(
                `TaskMemory: failed to persist: ${error instanceof Error ? error.message : error}`
            );
        }
    }
}

// --- Shared embedder (cached) -------------------------------------------------

let cachedEmbedder: EmbedderLike | undefined;
let embedderResolved = false;

async function getSharedEmbedder(): Promise<EmbedderLike | undefined> {
    if (embedderResolved) return cachedEmbedder;
    embedderResolved = true;
    try {
        // Resolve the registry lazily via dynamic import so we never construct the
        // shared EmbeddingService at module-import time (before env is loaded).
        const mod = await import('../indexing/CodebaseIndexerRegistry.js');
        cachedEmbedder = mod?.CodebaseIndexerRegistry?.getEmbedder?.();
    } catch {
        cachedEmbedder = undefined;
    }
    return cachedEmbedder;
}

// --- Helpers ------------------------------------------------------------------

function tokenize(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((t) => t.length > 2)
    );
}

function lexicalOverlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

function isEpisode(x: any): x is TaskEpisode {
    return (
        x &&
        typeof x.id === 'string' &&
        typeof x.description === 'string' &&
        typeof x.success === 'boolean' &&
        Array.isArray(x.embedding)
    );
}
