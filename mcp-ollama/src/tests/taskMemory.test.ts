import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskMemory } from '../agents/TaskMemory.js';

// Empty-embedding embedder forces the deterministic lexical-overlap path,
// so tests don't depend on a running embedding backend.
const lexicalEmbedder = { embed: async () => [] as number[] };

function tmpFile(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'task-memory.json');
}

async function seed(mem: TaskMemory) {
  await mem.record({
    description: 'add a debounce helper to util',
    taskType: 'implement',
    success: true,
    summary: 'added debounce helper',
    planSteps: ['Update src/util.ts: add debounce'],
    corrections: 0,
    replans: 0,
    filesModified: ['src/util.ts'],
  });
  await mem.record({
    description: 'build payment gateway integration',
    taskType: 'implement',
    success: false,
    summary: 'failed to integrate gateway',
    planSteps: [],
    corrections: 2,
    replans: 1,
    failureReasons: ['Syntax check failed for gateway.ts'],
    filesModified: [],
  });
}

describe('TaskMemory — record & recall', () => {
  it('recalls the most lexically similar past episode', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-recall-'), embedder: lexicalEmbedder });
    await seed(mem);

    const hits = await mem.recall('add a debounce function to utils', 3);
    assert.ok(hits.length >= 1);
    assert.match(hits[0].episode.description, /debounce/);
    assert.ok(hits[0].score > 0.1);
  });

  it('ranks the relevant failed episode first for a related query', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-rank-'), embedder: lexicalEmbedder });
    await seed(mem);

    const hits = await mem.recall('create a payment gateway', 3);
    assert.match(hits[0].episode.description, /payment gateway/);
    assert.equal(hits[0].episode.success, false);
  });

  it('returns nothing when there is no relevant history', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-empty-'), embedder: lexicalEmbedder });
    await seed(mem);
    const hits = await mem.recall('completely unrelated quantum chromodynamics topic', 3);
    assert.equal(hits.length, 0);
  });
});

describe('TaskMemory — renderLessons', () => {
  it('formats a WORKED lesson with the approach', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-worked-'), embedder: lexicalEmbedder });
    await seed(mem);
    const lessons = await mem.renderLessons('add debounce helper', 3);
    assert.match(lessons, /\[WORKED\]/);
    assert.match(lessons, /add debounce/i);
  });

  it('formats a FAILED lesson with what to avoid', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-failed-'), embedder: lexicalEmbedder });
    await seed(mem);
    const lessons = await mem.renderLessons('payment gateway integration', 3);
    assert.match(lessons, /\[FAILED\]/);
    assert.match(lessons, /avoid:/);
    assert.match(lessons, /Syntax check failed/);
  });

  it('returns an empty string with no relevant history', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-none-'), embedder: lexicalEmbedder });
    const lessons = await mem.renderLessons('anything at all', 3);
    assert.equal(lessons, '');
  });
});

describe('TaskMemory — persistence & bounds', () => {
  it('persists episodes across instances', async () => {
    const file = tmpFile('tm-persist-');
    const mem1 = new TaskMemory({ path: file, embedder: lexicalEmbedder });
    await seed(mem1);

    const mem2 = new TaskMemory({ path: file, embedder: lexicalEmbedder });
    assert.equal(mem2.size(), 2);
    const hits = await mem2.recall('debounce util', 3);
    assert.ok(hits.length >= 1);
  });

  it('bounds the number of stored episodes', async () => {
    const mem = new TaskMemory({ path: tmpFile('tm-bound-'), embedder: lexicalEmbedder, maxEpisodes: 2 });
    for (let i = 0; i < 4; i++) {
      await mem.record({
        description: `task number ${i}`,
        success: true,
        summary: 's',
        planSteps: [],
        corrections: 0,
        replans: 0,
      });
    }
    assert.equal(mem.size(), 2);
  });
});
