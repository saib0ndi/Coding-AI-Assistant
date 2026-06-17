#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Run a fixed agent task suite and print success rate, latency, hallucination metrics.
 *
 * Usage:
 *   npm run build && npm start   # in another terminal
 *   npm run eval
 *
 * Env:
 *   MCP_URL          default http://localhost:3078
 *   EVAL_WORKSPACE   default mcp-ollama package root
 */

const BASE = (process.env.MCP_URL || 'http://localhost:3078').replace(/\/$/, '');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.EVAL_WORKSPACE || path.resolve(__dirname, '..');

const TASKS = [
  {
    name: 'test_gen_preview',
    type: 'test',
    description: 'Generate unit tests for src/tools/FileSystemTool.ts',
    context: {
      workspacePath: WORKSPACE,
      files: ['src/tools/FileSystemTool.ts'],
      previewChanges: true,
      verify: false,
    },
    expectSuccess: true,
    expectProposed: true,
  },
  {
    name: 'index_status',
    type: 'analyze',
    description: 'Check codebase index is available',
    context: {
      workspacePath: WORKSPACE,
      previewChanges: true,
      verify: false,
    },
    tool: 'index_status',
    expectSuccess: true,
  },
];

async function callTool(name, body = {}) {
  const res = await fetch(`${BASE}/tools/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok && !data.error) {
    throw new Error(`${name} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

async function main() {
  console.log(`Evaluating MCP at ${BASE}`);
  console.log(`Workspace: ${WORKSPACE}\n`);

  try {
    const health = await fetch(`${BASE}/health`).then((r) => r.json());
    if (health.status !== 'healthy') {
      console.error('Server not healthy:', health);
      process.exit(1);
    }
  } catch (e) {
    console.error(`Cannot reach ${BASE}/health — is the server running?`);
    console.error(e.message);
    process.exit(1);
  }

  try {
    await callTool('clear_caches', { workspacePath: WORKSPACE });
    await callTool('hallucination_metrics', { action: 'reset' });
  } catch {
    console.warn('(clear_caches / hallucination_metrics unavailable — restart server after npm run build)\n');
  }

  const results = [];

  for (const task of TASKS) {
    const start = Date.now();
    let data;
    let error;

    try {
      if (task.tool === 'index_status') {
        data = await callTool('index_status', { workspacePath: WORKSPACE });
      } else {
        data = await callTool('agent_execute', {
          description: task.description,
          type: task.type,
          context: task.context,
        });
      }
    } catch (e) {
      error = e.message;
      data = null;
    }

    const ms = Date.now() - start;
    const success =
      task.tool === 'index_status'
        ? !error && data && !data.error && typeof data.chunkCount === 'number'
        : Boolean(data?.success) && !error;
    const proposed = Array.isArray(data?.proposedChanges) ? data.proposedChanges.length : 0;
    const hall = data?.hallucination?.hallucinationRate ?? null;

    const passed =
      !error &&
      (!task.expectSuccess || success) &&
      (!task.expectProposed || proposed > 0);

    results.push({
      name: task.name,
      passed,
      success,
      ms,
      proposed,
      hallucinationRate: hall,
      error,
    });

    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${task.name}  ${ms}ms  success=${success}  proposed=${proposed}  hall=${hall ?? 'n/a'}${error ? `  err=${error}` : ''}`
    );
  }

  let aggregate = null;
  try {
    aggregate = await callTool('hallucination_metrics', { action: 'get' });
  } catch {
    /* ignore */
  }

  const passed = results.filter((r) => r.passed).length;
  const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  const avgHall =
    results.filter((r) => r.hallucinationRate != null).reduce((s, r) => s + r.hallucinationRate, 0) /
      Math.max(1, results.filter((r) => r.hallucinationRate != null).length);

  console.log('\n--- Summary ---');
  console.log(`Tasks: ${passed}/${results.length} passed (${((passed / results.length) * 100).toFixed(1)}%)`);
  console.log(`Avg latency: ${avgMs}ms`);
  console.log(`Avg hallucination rate (per task): ${(avgHall * 100).toFixed(1)}%`);
  if (aggregate?.sampleCount != null) {
    console.log(`Server aggregate hallucination: ${((aggregate.hallucinationRate ?? 0) * 100).toFixed(1)}% (${aggregate.sampleCount} samples)`);
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
