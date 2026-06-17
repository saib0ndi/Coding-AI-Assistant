import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * End-to-end test for Fix #2: the per-role circuit breaker is now wired into
 * OllamaProvider's real request path via setRequestGuard(). These tests drive
 * the public generateText() API with a stubbed network layer and assert the
 * breaker actually trips on real failures and short-circuits while open.
 */
describe('OllamaProvider request guard + CircuitBreaker integration', () => {
    beforeEach(() => {
        // Keep generateText on the local Ollama path (not the cloud branch).
        delete process.env.CLOUD_API_KEY;
        delete process.env.OPENAI_API_KEY;
    });

    function makeProvider(): OllamaProvider {
        return new OllamaProvider({ host: 'http://localhost:11434', model: 'm', timeout: 500 });
    }

    it('trips the circuit after repeated real failures and then fails fast', async () => {
        const provider = makeProvider();
        let networkCalls = 0;
        // 404 is treated as non-transient → exactly one attempt per request (no retry/backoff).
        (provider as any).callOllamaWithTimeout = async () => {
            networkCalls++;
            throw new Error('Ollama API error: 404 Not Found');
        };

        const breaker = new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 1,
            cooldownMs: 60,
            label: 'code',
        });
        provider.setRequestGuard(<T>(fn: () => Promise<T>) => breaker.execute(fn));

        // generateText swallows the error and returns a graceful message, but the
        // breaker still observes the underlying throw.
        for (let i = 0; i < 3; i++) {
            const out = await provider.generateText({ prompt: 'hi' });
            assert.match(out, /unable to generate/i);
        }
        assert.equal(breaker.getState(), 'open', 'three failures should open the circuit');
        assert.equal(networkCalls, 3, 'one network attempt per request (404 is non-transient)');

        // While open: fail fast, the network must NOT be touched.
        const callsBeforeFastFail = networkCalls;
        const fast = await provider.generateText({ prompt: 'hi' });
        assert.match(fast, /unable to generate/i);
        assert.equal(networkCalls, callsBeforeFastFail, 'open circuit must not hit the network');

        // After cooldown, a healthy response closes the circuit again.
        await delay(75);
        (provider as any).callOllamaWithTimeout = async () => ({ response: 'recovered' });
        const recovered = await provider.generateText({ prompt: 'hi' });
        assert.equal(recovered, 'recovered');
        assert.equal(breaker.getState(), 'closed', 'a successful probe re-closes the circuit');
    });

    it('counts an entire retry sequence as ONE breaker operation for transient errors', async () => {
        const provider = makeProvider();
        let networkCalls = 0;
        // A transient error message → callOllamaWithRetry retries up to 3 times internally.
        (provider as any).callOllamaWithTimeout = async () => {
            networkCalls++;
            throw new Error('socket hang up');
        };

        const breaker = new CircuitBreaker({
            failureThreshold: 10,
            successThreshold: 1,
            cooldownMs: 10_000,
            label: 'code',
        });
        provider.setRequestGuard(<T>(fn: () => Promise<T>) => breaker.execute(fn));

        const out = await provider.generateText({ prompt: 'hi' });

        assert.match(out, /unable to generate/i);
        assert.equal(networkCalls, 3, 'the retry loop runs inside a single guarded operation');
        assert.equal(breaker.getStats().failures, 1, 'the whole request counts as one breaker failure, not three');
        assert.equal(breaker.getState(), 'closed');
    });

    it('runs unguarded providers directly (guard is opt-in)', async () => {
        const provider = makeProvider();
        (provider as any).callOllamaWithTimeout = async () => ({ response: 'direct' });
        // No setRequestGuard() call — should behave exactly as before.
        const out = await provider.generateText({ prompt: 'hi' });
        assert.equal(out, 'direct');
    });
});
