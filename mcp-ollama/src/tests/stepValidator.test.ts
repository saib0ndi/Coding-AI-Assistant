import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '../utils/Logger.js';
import { StepValidator, type ValidatableStep } from '../agents/StepValidator.js';

const step: ValidatableStep = {
  action: 'implement add()',
  validation: 'code generated successfully',
  tool: 'code',
};

const GOOD_TS = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
const BAD_TS = 'export const x: number = ;\n'; // expression expected -> syntax error

function makeValidator(opts?: {
  files?: Record<string, string>;
  llm?: string;
}) {
  const files = opts?.files ?? {};
  const fakeFs: any = {
    readFile: async (p: string) => {
      if (p in files) return files[p];
      throw new Error('not found');
    },
    executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
  const fakeOllama: any = {
    generateText: async () => opts?.llm ?? 'INVALID',
    getModel: () => 'fake-model',
  };
  return new StepValidator(fakeFs, fakeOllama, new Logger());
}

describe('StepValidator — hard failures', () => {
  it('rejects an explicit error', async () => {
    const v = await makeValidator().validate(step, { error: 'boom' });
    assert.equal(v.valid, false);
    assert.equal(v.method, 'deterministic');
  });

  it('rejects success=false', async () => {
    const v = await makeValidator().validate(step, { success: false });
    assert.equal(v.valid, false);
  });

  it('rejects the generated.* sentinel file', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      filesModified: ['src/generated.ts'],
    });
    assert.equal(v.valid, false);
    assert.match(v.reasons.join(' '), /generated/i);
  });
});

describe('StepValidator — stub detection', () => {
  it('rejects "not implemented" stubs in proposed changes', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      proposedChanges: [
        { filePath: 'src/a.ts', original: '', modified: "export function a() { throw new Error('Not implemented'); }", status: 'added' },
      ],
    });
    assert.equal(v.valid, false);
    assert.match(v.reasons.join(' '), /placeholder|stub/i);
  });

  it('rejects an empty "{ ... }" body', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      proposedChanges: [
        { filePath: 'src/a.ts', original: '', modified: 'function a() { ... }', status: 'added' },
      ],
    });
    assert.equal(v.valid, false);
  });
});

describe('StepValidator — syntax checks', () => {
  it('rejects a syntactically broken proposed change', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      proposedChanges: [{ filePath: 'src/a.ts', original: '', modified: BAD_TS, status: 'added' }],
    });
    assert.equal(v.valid, false);
    assert.match(v.reasons.join(' '), /syntax/i);
  });

  it('accepts a valid proposed change', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      proposedChanges: [{ filePath: 'src/a.ts', original: '', modified: GOOD_TS, status: 'added' }],
    });
    assert.equal(v.valid, true);
    assert.equal(v.method, 'deterministic');
  });

  it('deep-checks written files by re-reading them (valid)', async () => {
    const v = await makeValidator({ files: { 'src/good.ts': GOOD_TS } }).validate(step, {
      success: true,
      filesModified: ['src/good.ts'],
    });
    assert.equal(v.valid, true);
  });

  it('deep-checks written files by re-reading them (broken)', async () => {
    const v = await makeValidator({ files: { 'src/bad.ts': BAD_TS } }).validate(step, {
      success: true,
      filesModified: ['src/bad.ts'],
    });
    assert.equal(v.valid, false);
    assert.match(v.reasons.join(' '), /syntax/i);
  });
});

describe('StepValidator — preview mode', () => {
  it('rejects preview with no concrete diff', async () => {
    const v = await makeValidator().validate(
      step,
      { success: true, code: 'export const x = 1;' },
      { previewChanges: true }
    );
    assert.equal(v.valid, false);
    assert.match(v.reasons.join(' '), /preview/i);
  });

  it('accepts preview with a real diff', async () => {
    const v = await makeValidator().validate(
      step,
      { success: true, proposedChanges: [{ filePath: 'src/a.ts', original: 'old', modified: GOOD_TS, status: 'modified' }] },
      { previewChanges: true }
    );
    assert.equal(v.valid, true);
  });
});

describe('StepValidator — test output', () => {
  it('rejects when test output reports failures', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      testOutput: 'Tests: 3 passing, 2 failing',
    });
    assert.equal(v.valid, false);
    assert.match(v.reasons.join(' '), /fail/i);
  });

  it('accepts when test output reports zero failures', async () => {
    const v = await makeValidator().validate(step, {
      success: true,
      testOutput: 'Tests: 5 passing, 0 failing',
    });
    assert.equal(v.valid, true);
  });
});

describe('StepValidator — LLM fallback', () => {
  it('uses the LLM only when deterministic signals are inconclusive', async () => {
    const v = await makeValidator({ llm: 'VALID' }).validate(step, { note: 'ambiguous payload' });
    assert.equal(v.method, 'llm');
    assert.equal(v.valid, true);
  });

  it('honors an INVALID LLM verdict', async () => {
    const v = await makeValidator({ llm: 'INVALID' }).validate(step, { note: 'ambiguous payload' });
    assert.equal(v.method, 'llm');
    assert.equal(v.valid, false);
  });
});
