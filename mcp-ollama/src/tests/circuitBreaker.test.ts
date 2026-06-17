import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const boom = () => Promise.reject(new Error('boom'));

/**
 * Exercises the full circuit-breaker state machine that now guards every
 * agent role's request path (Fix #2). These tests pin down the exact
 * closed → open → half-open → closed transitions, the fail-fast contract,
 * and the consecutive-failure accounting.
 */
describe('CircuitBreaker state machine', () => {
    it('stays closed and transparently returns results while healthy', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, label: 'healthy' });
        for (let i = 0; i < 25; i++) {
            const out = await cb.execute(async () => i * 2);
            assert.equal(out, i * 2);
        }
        assert.equal(cb.getState(), 'closed');
        assert.equal(cb.getStats().failures, 0);
        assert.equal(cb.getStats().openedAt, null);
    });

    it('opens only after exactly N consecutive failures', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 10_000, label: 'count' });

        for (let i = 0; i < 4; i++) {
            await assert.rejects(cb.execute(boom), /boom/);
            assert.equal(cb.getState(), 'closed', `still closed after ${i + 1} failures`);
        }

        // 5th consecutive failure trips it
        await assert.rejects(cb.execute(boom), /boom/);
        assert.equal(cb.getState(), 'open');
        assert.equal(cb.getStats().failures, 5);
        assert.equal(typeof cb.getStats().openedAt, 'number');
    });

    it('a single success resets the consecutive-failure counter while closed', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 10_000, label: 'reset-count' });

        await assert.rejects(cb.execute(boom));
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getStats().failures, 2);

        await cb.execute(async () => 'ok'); // resets streak
        assert.equal(cb.getStats().failures, 0);

        // It should now take a fresh run of 3 failures to open
        await assert.rejects(cb.execute(boom));
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'closed');
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'open');
    });

    it('fails fast WITHOUT invoking the wrapped fn once open', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, label: 'fast' });
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'open');

        let invoked = 0;
        await assert.rejects(
            cb.execute(async () => { invoked++; return 'should-not-run'; }),
            /is OPEN/
        );
        assert.equal(invoked, 0, 'the protected operation must not be called while open');
    });

    it('moves open → half-open after cooldown and needs successThreshold wins to close', async () => {
        const cb = new CircuitBreaker({
            failureThreshold: 2,
            successThreshold: 2,
            cooldownMs: 40,
            label: 'half-open',
        });

        await assert.rejects(cb.execute(boom));
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'open');

        await delay(55); // cooldown elapsed

        // First post-cooldown call probes (half-open); one success is not enough
        assert.equal(await cb.execute(async () => 1), 1);
        assert.equal(cb.getState(), 'half-open');

        // Second success meets the threshold and closes the circuit
        assert.equal(await cb.execute(async () => 2), 2);
        assert.equal(cb.getState(), 'closed');
        assert.equal(cb.getStats().openedAt, null);
    });

    it('re-opens immediately if the probe fails during half-open', async () => {
        const cb = new CircuitBreaker({
            failureThreshold: 1,
            successThreshold: 3,
            cooldownMs: 30,
            label: 'reopen',
        });

        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'open');

        await delay(45);

        // Probe fails → straight back to open, no partial credit
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'open');
    });

    it('reset() force-closes a tripped breaker and clears counters', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, label: 'manual-reset' });
        await assert.rejects(cb.execute(boom));
        assert.equal(cb.getState(), 'open');

        cb.reset();

        assert.equal(cb.getState(), 'closed');
        assert.equal(cb.getStats().failures, 0);
        assert.equal(cb.getStats().openedAt, null);
        assert.equal(await cb.execute(async () => 'alive'), 'alive');
    });

    it('isolates failures per breaker instance (one role down does not trip another)', async () => {
        const roleA = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000, label: 'A' });
        const roleB = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000, label: 'B' });

        await assert.rejects(roleA.execute(boom));
        await assert.rejects(roleA.execute(boom));

        assert.equal(roleA.getState(), 'open');
        assert.equal(roleB.getState(), 'closed', 'B is unaffected by A failing');
        assert.equal(await roleB.execute(async () => 'B-ok'), 'B-ok');
    });
});
