import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import registry, { httpRequestsTotal } from '../utils/Metrics.js';

/**
 * Validates the zero-dependency Prometheus registry (Phase 3) that backs the
 * /metrics endpoint: counters, gauges, and the cumulative-bucket histogram
 * must emit valid text-exposition output.
 */
describe('Metrics registry (Prometheus text format)', () => {
    it('counters accumulate per label set and emit HELP/TYPE headers', () => {
        const c = registry.counter('test_counter_total_unit', 'unit test counter');
        c.inc({ route: '/a' });
        c.inc({ route: '/a' });
        c.inc({ route: '/b' }, 5);

        const out = c.format();
        assert.match(out, /# HELP test_counter_total_unit unit test counter/);
        assert.match(out, /# TYPE test_counter_total_unit counter/);
        assert.match(out, /test_counter_total_unit\{route="\/a"\} 2/);
        assert.match(out, /test_counter_total_unit\{route="\/b"\} 5/);
    });

    it('gauges support set / inc / dec to an arbitrary value', () => {
        const g = registry.gauge('test_gauge_unit', 'unit test gauge');
        g.set(10);
        g.inc();          // +1 -> 11
        g.dec({}, 3);     // -3 -> 8

        const out = g.format();
        assert.match(out, /# TYPE test_gauge_unit gauge/);
        assert.match(out, /^test_gauge_unit 8$/m);
    });

    it('histograms produce cumulative buckets, +Inf, sum, and count', () => {
        const h = registry.histogram('test_hist_unit', 'unit test histogram', [10, 100, 1000]);
        h.observe(5);
        h.observe(50);
        h.observe(500);
        h.observe(5000);

        const out = h.format();
        assert.match(out, /# TYPE test_hist_unit histogram/);
        // Cumulative counts: <=10 -> 1, <=100 -> 2, <=1000 -> 3, +Inf -> 4
        assert.match(out, /test_hist_unit_bucket\{le="10"\} 1/);
        assert.match(out, /test_hist_unit_bucket\{le="100"\} 2/);
        assert.match(out, /test_hist_unit_bucket\{le="1000"\} 3/);
        assert.match(out, /test_hist_unit_bucket\{le="\+Inf"\} 4/);
        assert.match(out, /test_hist_unit_sum 5555/);
        assert.match(out, /test_hist_unit_count 4/);
    });

    it('the shared registry aggregates pre-registered instruments', () => {
        httpRequestsTotal.inc({ method: 'GET', path: '/metrics', status: '200' });
        const all = registry.format();
        assert.match(all, /mcp_http_requests_total/);
        assert.match(all, /method="GET"/);
        // Output ends with a trailing newline (well-formed exposition text)
        assert.ok(all.endsWith('\n'));
    });

    it('returns the same instrument instance for a repeated name', () => {
        const a = registry.counter('test_dupe_total_unit', 'x');
        const b = registry.counter('test_dupe_total_unit', 'x');
        assert.equal(a, b);
    });
});
