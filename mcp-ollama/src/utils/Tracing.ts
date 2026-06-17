import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    operation: string;
    startedAt: number;
}

const storage = new AsyncLocalStorage<TraceContext>();

function shortId(): string {
    return Math.random().toString(36).slice(2, 10) +
           Math.random().toString(36).slice(2, 10);
}

/** Start a new root trace and run `fn` inside it. Returns fn's result. */
export function withTrace<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const ctx: TraceContext = {
        traceId: shortId(),
        spanId: shortId(),
        operation,
        startedAt: Date.now(),
    };
    return storage.run(ctx, fn);
}

/**
 * Create a child span under the current trace and run `fn` inside it.
 * If there's no active trace, a new root trace is created automatically.
 */
export function withSpan<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const parent = storage.getStore();
    const ctx: TraceContext = {
        traceId: parent?.traceId ?? shortId(),
        spanId: shortId(),
        operation,
        startedAt: Date.now(),
        ...(parent?.spanId ? { parentSpanId: parent.spanId } : {}),
    };
    return storage.run(ctx, fn);
}

/** Returns the active trace context, or undefined if called outside any trace. */
export function currentTrace(): TraceContext | undefined {
    return storage.getStore();
}

/** Elapsed milliseconds since the current span started, or undefined. */
export function spanElapsedMs(): number | undefined {
    const ctx = storage.getStore();
    return ctx ? Date.now() - ctx.startedAt : undefined;
}
