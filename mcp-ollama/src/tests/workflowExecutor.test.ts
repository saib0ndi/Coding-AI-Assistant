import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Route the DLQ singleton at a throwaway file BEFORE the queue is first used.
const DLQ_FILE = path.join(os.tmpdir(), `dlq-workflow-test-${process.pid}.json`);
process.env.DLQ_PATH = DLQ_FILE;

import { WorkflowExecutor } from '../workflows/WorkflowExecutor.js';
import { getDLQ } from '../workflows/DeadLetterQueue.js';
import type { WorkflowStep, WorkflowPlan } from '../types/agent.js';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Tracker {
    order: string[];
    active: number;
    peak: number;
    seenDeps: Record<string, string[]>;
}

function makeTracker(): Tracker {
    return { order: [], active: 0, peak: 0, seenDeps: {} };
}

/** A configurable mock agent that records execution order, concurrency, and the
 *  shared-context keys visible to each step (to prove result threading). */
class MockAgent {
    constructor(
        private tracker: Tracker,
        private opts: { delayMs?: number; failIds?: Set<string>; hangIds?: Set<string> } = {}
    ) {}

    async executeStep(step: WorkflowStep, context: any): Promise<any> {
        this.tracker.seenDeps[step.id] = Object.keys(context.stepResults ?? {});
        this.tracker.active++;
        this.tracker.peak = Math.max(this.tracker.peak, this.tracker.active);
        try {
            if (this.opts.hangIds?.has(step.id)) {
                await delay(this.opts.delayMs ?? 1000);
            } else if (this.opts.delayMs) {
                await delay(this.opts.delayMs);
            }
            if (this.opts.failIds?.has(step.id)) {
                throw new Error(`boom:${step.id}`);
            }
            this.tracker.order.push(step.id);
            return { success: true, filesModified: [`${step.id}.ts`] };
        } finally {
            this.tracker.active--;
        }
    }
}

function mkStep(id: string, deps?: string[], tool = 'code'): WorkflowStep {
    const s: WorkflowStep = { id, action: `do ${id}`, tool, params: {}, status: 'pending' };
    if (deps) s.dependencies = deps;
    return s;
}

function mkPlan(steps: WorkflowStep[]): WorkflowPlan {
    return { taskId: 'wf-task', steps, estimatedTime: 0, requiredApprovals: [] };
}

function executorFor(tracker: Tracker, opts?: ConstructorParameters<typeof MockAgent>[1]): WorkflowExecutor {
    const agent = new MockAgent(tracker, opts);
    return new WorkflowExecutor(new Map<string, any>([['code', agent]]));
}

/** Guards against the cyclic-dependency hang the executor's wave builder used to risk. */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        delay(ms).then(() => { throw new Error(`Deadline exceeded (${ms}ms): ${label}`); }),
    ]) as Promise<T>;
}

describe('WorkflowExecutor — topological parallel waves (Fix #3 & #4)', () => {
    beforeEach(() => {
        getDLQ().clear();
        delete process.env.WORKFLOW_MAX_CONCURRENT_STEPS;
        delete process.env.WORKFLOW_STEP_TIMEOUT_MS;
    });

    after(() => {
        try { fs.rmSync(DLQ_FILE, { force: true }); } catch { /* ignore */ }
    });

    it('runs a linear dependency chain strictly in order and threads results downstream', async () => {
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 10 });
        const plan = mkPlan([
            mkStep('s0'),
            mkStep('s1', ['s0']),
            mkStep('s2', ['s1']),
        ]);

        const progress: number[] = [];
        const result = await exec.executeWorkflow(plan, {}, p => progress.push(p));

        assert.equal(result.success, true);
        assert.deepEqual(tracker.order, ['s0', 's1', 's2']);

        // Each step must see exactly its predecessors' results in the shared context
        assert.deepEqual(tracker.seenDeps['s0'], []);
        assert.deepEqual(tracker.seenDeps['s1'], ['s0']);
        assert.deepEqual(tracker.seenDeps['s2'], ['s0', 's1']);

        // Files from every step are aggregated, and progress climbs to 100
        assert.deepEqual(result.filesModified.sort(), ['s0.ts', 's1.ts', 's2.ts']);
        assert.equal(progress[progress.length - 1], 100);
        assert.equal(progress.length, 3);
    });

    it('runs independent steps in parallel but never exceeds maxConcurrentSteps', async () => {
        process.env.WORKFLOW_MAX_CONCURRENT_STEPS = '2';
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 40 });
        const plan = mkPlan(['a', 'b', 'c', 'd', 'e'].map(id => mkStep(id)));

        const result = await exec.executeWorkflow(plan, {});

        assert.equal(result.success, true);
        assert.equal(tracker.order.length, 5);
        assert.equal(tracker.peak, 2, 'concurrency cap of 2 must be honored exactly');
    });

    it('fans all independent steps out together when the cap is high', async () => {
        process.env.WORKFLOW_MAX_CONCURRENT_STEPS = '16';
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 50 });
        const plan = mkPlan(['a', 'b', 'c', 'd'].map(id => mkStep(id)));

        const start = Date.now();
        const result = await exec.executeWorkflow(plan, {});
        const elapsed = Date.now() - start;

        assert.equal(result.success, true);
        assert.equal(tracker.peak, 4, 'all four independent steps run at once');
        assert.ok(elapsed < 4 * 50, `parallel execution should be ~one step long, took ${elapsed}ms`);
    });

    it('handles a diamond graph: parallel fan-out, join waits for both branches', async () => {
        process.env.WORKFLOW_MAX_CONCURRENT_STEPS = '16';
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 25 });
        //      s0
        //     /  \
        //   s1    s2
        //     \  /
        //      s3
        const plan = mkPlan([
            mkStep('s0'),
            mkStep('s1', ['s0']),
            mkStep('s2', ['s0']),
            mkStep('s3', ['s1', 's2']),
        ]);

        const result = await exec.executeWorkflow(plan, {});

        assert.equal(result.success, true);
        // s0 strictly first, s3 strictly last; s1/s2 in the middle
        assert.equal(tracker.order[0], 's0');
        assert.equal(tracker.order[tracker.order.length - 1], 's3');
        assert.deepEqual([...tracker.order].slice(1, 3).sort(), ['s1', 's2']);
        // The join sees results from all three upstream steps
        assert.deepEqual(tracker.seenDeps['s3'].sort(), ['s0', 's1', 's2']);
    });

    it('aborts the workflow on a failed step and records it to the DLQ', async () => {
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 5, failIds: new Set(['s1']) });
        const plan = mkPlan([
            mkStep('s0'),
            mkStep('s1', ['s0']),
            mkStep('s2', ['s1']),
        ]);

        const result = await exec.executeWorkflow(plan, {});

        assert.equal(result.success, false);
        assert.match(result.summary, /s1/);
        assert.ok(tracker.order.includes('s0'));
        assert.ok(!tracker.order.includes('s2'), 'downstream step must not run after an upstream failure');

        const dlq = getDLQ().list();
        assert.equal(dlq.length, 1);
        assert.equal(dlq[0].taskId, 'wf-task');
        assert.equal(dlq[0].step.id, 's1');
        assert.match(dlq[0].error, /boom:s1/);
    });

    it('enforces stepTimeoutMs, fails the slow step, and dead-letters it', async () => {
        process.env.WORKFLOW_STEP_TIMEOUT_MS = '40';
        const tracker = makeTracker();
        const exec = executorFor(tracker, { hangIds: new Set(['s0']), delayMs: 400 });
        const plan = mkPlan([mkStep('s0')]);

        const result = await exec.executeWorkflow(plan, {});

        assert.equal(result.success, false);
        assert.match(result.error ?? '', /timed out/i);
        const dlq = getDLQ().list();
        assert.equal(dlq.length, 1);
        assert.equal(dlq[0].step.id, 's0');
        assert.match(dlq[0].error, /timed out/i);
    });

    it('TERMINATES on a cyclic dependency graph instead of hanging (cycle guard)', async () => {
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 5 });
        // s0 ↔ s1 mutual dependency
        const plan = mkPlan([
            mkStep('s0', ['s1']),
            mkStep('s1', ['s0']),
        ]);

        const result = await withDeadline(exec.executeWorkflow(plan, {}), 1000, 'cyclic workflow');

        assert.equal(result.success, true, 'cycle is broken and both steps still execute');
        assert.deepEqual([...tracker.order].sort(), ['s0', 's1']);
    });

    it('tolerates a self-referential dependency without hanging', async () => {
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 5 });
        const plan = mkPlan([mkStep('s0', ['s0'])]);

        const result = await withDeadline(exec.executeWorkflow(plan, {}), 1000, 'self-dependency');

        assert.equal(result.success, true);
        assert.deepEqual(tracker.order, ['s0']);
    });

    it('ignores unknown dependency ids gracefully', async () => {
        const tracker = makeTracker();
        const exec = executorFor(tracker, { delayMs: 5 });
        const plan = mkPlan([mkStep('s0', ['ghost-step'])]);

        const result = await exec.executeWorkflow(plan, {});

        assert.equal(result.success, true);
        assert.deepEqual(tracker.order, ['s0']);
    });
});
