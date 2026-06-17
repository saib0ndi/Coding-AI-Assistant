import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withTrace, withSpan, currentTrace, spanElapsedMs } from '../utils/Tracing.js';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Validates the AsyncLocalStorage-based trace propagation (Phase 3) that the
 * Logger and metrics rely on: ids must follow the async call chain across
 * awaits and stay isolated between concurrent branches.
 */
describe('Tracing (AsyncLocalStorage context propagation)', () => {
    it('has no ambient trace outside of withTrace/withSpan', () => {
        assert.equal(currentTrace(), undefined);
        assert.equal(spanElapsedMs(), undefined);
    });

    it('establishes a trace that survives across awaits', async () => {
        const seen = await withTrace('root-op', async () => {
            const before = currentTrace();
            await delay(10);
            const after = currentTrace();
            return { before, after };
        });

        assert.ok(seen.before);
        assert.ok(seen.after);
        assert.equal(seen.before!.traceId, seen.after!.traceId, 'traceId is stable across awaits');
        assert.equal(seen.before!.spanId, seen.after!.spanId);
        assert.equal(seen.after!.operation, 'root-op');
        // And the context is torn down once the trace completes
        assert.equal(currentTrace(), undefined);
    });

    it('child spans inherit the traceId, get a fresh spanId, and link the parent', async () => {
        await withTrace('parent', async () => {
            const root = currentTrace()!;
            await withSpan('child', async () => {
                const child = currentTrace()!;
                assert.equal(child.traceId, root.traceId, 'same trace');
                assert.notEqual(child.spanId, root.spanId, 'distinct span');
                assert.equal(child.parentSpanId, root.spanId, 'parent link');
                assert.equal(child.operation, 'child');
            });
            // Returning from the child restores the parent context
            assert.equal(currentTrace()!.spanId, root.spanId);
        });
    });

    it('keeps sibling spans in the same trace but with independent span ids', async () => {
        await withTrace('root', async () => {
            const root = currentTrace()!;
            const [a, b] = await Promise.all([
                withSpan('branch-a', async () => { await delay(8); return currentTrace()!; }),
                withSpan('branch-b', async () => { await delay(4); return currentTrace()!; }),
            ]);

            assert.equal(a.traceId, root.traceId);
            assert.equal(b.traceId, root.traceId);
            assert.notEqual(a.spanId, b.spanId);
            assert.equal(a.parentSpanId, root.spanId);
            assert.equal(b.parentSpanId, root.spanId);
        });
    });

    it('isolates entirely separate concurrent traces from each other', async () => {
        const [t1, t2] = await Promise.all([
            withTrace('A', async () => { await delay(20); return currentTrace()!.traceId; }),
            withTrace('B', async () => { await delay(5); return currentTrace()!.traceId; }),
        ]);
        assert.notEqual(t1, t2, 'concurrent root traces must not bleed into each other');
    });

    it('auto-creates a root trace when withSpan is used with no active trace', async () => {
        const ctx = await withSpan('orphan', async () => currentTrace()!);
        assert.ok(ctx.traceId);
        assert.ok(ctx.spanId);
        assert.equal(ctx.parentSpanId, undefined, 'no parent when started standalone');
    });

    it('reports a non-negative elapsed time inside a span', async () => {
        const elapsed = await withSpan('timed', async () => {
            await delay(15);
            return spanElapsedMs();
        });
        assert.equal(typeof elapsed, 'number');
        assert.ok((elapsed as number) >= 10, `expected >= ~15ms, got ${elapsed}`);
        assert.equal(spanElapsedMs(), undefined, 'cleared after the span exits');
    });

    it('preserves the root traceId through deeply nested spans', async () => {
        await withTrace('depth-0', async () => {
            const root = currentTrace()!;
            await withSpan('depth-1', async () =>
                withSpan('depth-2', async () =>
                    withSpan('depth-3', async () => {
                        const leaf = currentTrace()!;
                        assert.equal(leaf.traceId, root.traceId);
                        assert.equal(leaf.operation, 'depth-3');
                    })
                )
            );
        });
    });
});
