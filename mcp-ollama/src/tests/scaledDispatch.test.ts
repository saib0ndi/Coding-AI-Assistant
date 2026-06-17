import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ScaledOllamaProvider } from '../scaling/ScaledOllamaProvider.js';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Covers Fix #1: the scaling layer now actually serves agent traffic via
 * dispatch() (shared concurrency queue + load-balancer accounting) with a
 * no-throw fallback so it can never block real requests.
 */
describe('ScaledOllamaProvider.dispatch', () => {
    let sp: ScaledOllamaProvider;

    beforeEach(() => {
        sp = new ScaledOllamaProvider();
    });

    afterEach(() => {
        // Release the LoadBalancer health-check interval so the process can exit.
        (sp as any).loadBalancer?.stopHealthChecks?.();
    });

    it('runs the operation and returns its resolved value', async () => {
        const out = await sp.dispatch(async () => 'result-42');
        assert.equal(out, 'result-42');
    });

    it('propagates rejections from the dispatched operation', async () => {
        await assert.rejects(
            sp.dispatch(async () => { throw new Error('downstream failure'); }),
            /downstream failure/
        );
    });

    it('runs many operations concurrently and resolves each with its own value', async () => {
        let active = 0;
        let peak = 0;

        const tasks = Array.from({ length: 20 }, (_, i) =>
            sp.dispatch(async () => {
                active++;
                peak = Math.max(peak, active);
                await delay(25);
                active--;
                return i;
            })
        );

        const results = await Promise.all(tasks);

        assert.deepEqual(results, Array.from({ length: 20 }, (_, i) => i));
        assert.ok(peak > 1, `expected genuine concurrency, peak was ${peak}`);
    });

    it('still runs the fn (no-throw fallback) when no healthy instance is available', async () => {
        // Force the load balancer to report nothing schedulable.
        for (const inst of (sp as any).loadBalancer.instances as any[]) {
            inst.isHealthy = false;
        }
        assert.equal((sp as any).loadBalancer.getNextInstance(), null);

        const out = await sp.dispatch(async () => 'ran-without-instance');
        assert.equal(out, 'ran-without-instance', 'dispatch must never block real traffic');
    });

    it('accounts an active request on an instance while the op is in-flight', async () => {
        const instances = (sp as any).loadBalancer.instances as Array<{ activeRequests: number }>;
        assert.ok(instances.length >= 1, 'at least one instance is configured from app config');

        let observedActive = 0;
        const p = sp.dispatch(async () => {
            observedActive = instances.reduce((sum, i) => sum + i.activeRequests, 0);
            return 'done';
        });

        await p;
        assert.ok(observedActive >= 1, 'an in-flight dispatch should be counted against an instance');
        // Counter is released afterwards
        assert.equal(instances.reduce((sum, i) => sum + i.activeRequests, 0), 0);
    });

    it('exposes a coherent system-stats snapshot for /api/stats', () => {
        const stats = sp.getSystemStats();
        assert.ok(stats.queue && typeof stats.queue.concurrency === 'number');
        assert.ok(stats.cache && typeof stats.cache.size === 'number');
        assert.ok(Array.isArray(stats.instances));
        assert.ok(stats.instances.length >= 1);
        for (const inst of stats.instances) {
            assert.equal(typeof inst.id, 'string');
            assert.equal(typeof inst.healthy, 'boolean');
            assert.equal(typeof inst.active, 'number');
        }
    });
});
