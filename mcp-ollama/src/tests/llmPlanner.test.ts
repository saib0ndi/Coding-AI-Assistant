import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isComplexTask, generateLlmPlan } from '../agents/llmPlanner.js';
import { scanProject, renderProjectSummary } from '../agents/projectScanner.js';

describe('isComplexTask', () => {
  it('detects multi-component feature requests', () => {
    assert.equal(isComplexTask('build a user authentication system with JWT and password hashing'), true);
    assert.equal(isComplexTask('create a REST API with CRUD endpoints for users and products'), true);
  });

  it('treats small targeted tasks as simple', () => {
    assert.equal(isComplexTask('fix typo in README'), false);
    assert.equal(isComplexTask('add a comment to hasKeyword'), false);
    assert.equal(isComplexTask('create a file named sai'), false);
  });
});

describe('scanProject', () => {
  it('builds a bounded summary with manifest and files', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      name: 'demo', description: 'demo app',
      dependencies: { express: '^4.0.0' },
      scripts: { build: 'tsc' },
    }));
    fs.writeFileSync(path.join(workspace, 'src', 'index.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const y = 2;');

    const summary = scanProject(workspace);
    assert.equal(summary.manifest?.name, 'demo');
    assert.ok(summary.fileCount >= 3);
    assert.ok(summary.files.some((f) => f.relativePath.endsWith('index.ts')));

    const text = renderProjectSummary(summary);
    assert.match(text, /Project: demo/);
    assert.match(text, /src\/index\.ts|src\\index\.ts/);

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('skips node_modules and dist', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-skip-'));
    fs.mkdirSync(path.join(workspace, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'node_modules', 'pkg', 'index.js'), 'x');
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'x');

    const summary = scanProject(workspace);
    assert.ok(!summary.files.some((f) => f.relativePath.includes('node_modules')));

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});

describe('generateLlmPlan', () => {
  it('maps valid LLM JSON into multi-step plan with target files', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });

    const fakeProvider = {
      getModel: () => 'fake',
      generateText: async () => JSON.stringify({
        risk: 'low',
        steps: [
          { kind: 'mkdir', path: 'src/auth', action: 'auth module dir' },
          { kind: 'create_file', path: 'src/auth/jwt.ts', action: 'JWT sign and verify helpers' },
          { kind: 'create_file', path: 'src/auth/middleware.ts', action: 'express auth middleware' },
          { kind: 'generate_tests', path: 'src/auth/jwt.test.ts', action: 'tests for jwt helpers' },
        ],
      }),
    } as any;

    const plan = await generateLlmPlan(
      'implement user authentication system with JWT',
      { workspacePath: workspace, language: 'typescript', previewChanges: true },
      fakeProvider
    );

    assert.ok(plan);
    assert.equal(plan!.steps.length, 4);
    assert.equal(plan!.steps[0].action, 'mkdir src/auth');
    assert.match(plan!.steps[1].action, /^Implement src\/auth\/jwt\.ts/);
    assert.deepEqual(plan!.steps[1].params.targetFiles, [path.join(workspace, 'src/auth/jwt.ts')]);
    assert.equal(plan!.steps[3].tool, 'test');

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('rejects unsafe paths and falls back on garbage output', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bad-'));

    const escapeProvider = {
      getModel: () => 'fake',
      generateText: async () => JSON.stringify({
        steps: [
          { kind: 'create_file', path: '../../etc/passwd', action: 'bad' },
          { kind: 'create_file', path: '/abs/path.ts', action: 'bad' },
        ],
      }),
    } as any;
    assert.equal(
      await generateLlmPlan('build a system with many parts and pieces', { workspacePath: workspace }, escapeProvider),
      null
    );

    const garbageProvider = {
      getModel: () => 'fake',
      generateText: async () => 'sorry, I cannot do that',
    } as any;
    assert.equal(
      await generateLlmPlan('build a system with many parts and pieces', { workspacePath: workspace }, garbageProvider),
      null
    );

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('accepts a single-step concrete plan for an atomic task', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-atomic-'));
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'util.ts'), 'export const a = 1;');

    const provider = {
      getModel: () => 'fake',
      generateText: async () => JSON.stringify({
        risk: 'low',
        steps: [{ kind: 'edit_file', path: 'src/util.ts', action: 'add a debounce helper' }],
      }),
    } as any;

    const plan = await generateLlmPlan(
      'add a debounce helper to util.ts',
      { workspacePath: workspace, language: 'typescript' },
      provider
    );

    assert.ok(plan, 'single-step plan with concrete work should be accepted');
    assert.equal(plan!.steps.length, 1);
    assert.match(plan!.steps[0].action, /^Update src\/util\.ts/);
    assert.deepEqual(plan!.steps[0].params.targetFiles, [path.join(workspace, 'src/util.ts')]);

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('still rejects a single review-only plan (no concrete work)', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-'));
    const provider = {
      getModel: () => 'fake',
      generateText: async () => JSON.stringify({
        steps: [{ kind: 'review', action: 'review the codebase' }],
      }),
    } as any;

    const plan = await generateLlmPlan('review my code', { workspacePath: workspace }, provider);
    assert.equal(plan, null);

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('drops run_tests step in preview mode', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-preview-'));

    const provider = {
      getModel: () => 'fake',
      generateText: async () => JSON.stringify({
        steps: [
          { kind: 'create_file', path: 'src/a.ts', action: 'module a' },
          { kind: 'create_file', path: 'src/b.ts', action: 'module b' },
          { kind: 'run_tests', action: 'run suite' },
        ],
      }),
    } as any;

    const plan = await generateLlmPlan(
      'implement a complete module system with several parts',
      { workspacePath: workspace, previewChanges: true },
      provider
    );
    assert.ok(plan);
    assert.equal(plan!.steps.length, 2);
    assert.ok(plan!.steps.every((s) => s.action !== 'run_tests'));

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});
