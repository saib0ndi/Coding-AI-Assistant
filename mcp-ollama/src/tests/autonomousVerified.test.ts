import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVerifiedFlag } from '../agents/AutonomousAgent.js';

describe('resolveVerifiedFlag', () => {
  it('is false in preview mode regardless of files', () => {
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: true,
        proposedOnly: false,
        verifyDisabled: false,
        filesModifiedCount: 3,
      }),
      false
    );
  });

  it('is false for a proposed-only (diff preview) result', () => {
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: false,
        proposedOnly: true,
        verifyDisabled: false,
        filesModifiedCount: 0,
      }),
      false
    );
  });

  it('reflects passing verification', () => {
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: false,
        proposedOnly: false,
        verifyDisabled: false,
        verification: { passed: true },
        filesModifiedCount: 2,
      }),
      true
    );
  });

  it('reflects failing verification', () => {
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: false,
        proposedOnly: false,
        verifyDisabled: false,
        verification: { passed: false },
        filesModifiedCount: 2,
      }),
      false
    );
  });

  it('does NOT claim verified when nothing was written and no verification ran', () => {
    // Regression guard: analysis/review or code-only steps that touch no files
    // must not report verified=true just because verification was skipped.
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: false,
        proposedOnly: false,
        verifyDisabled: false,
        filesModifiedCount: 0,
      }),
      false
    );
  });

  it('trusts the caller when verification is explicitly disabled and files changed', () => {
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: false,
        proposedOnly: false,
        verifyDisabled: true,
        filesModifiedCount: 1,
      }),
      true
    );
  });

  it('does not claim verified when verify is disabled but nothing changed', () => {
    assert.equal(
      resolveVerifiedFlag({
        previewChanges: false,
        proposedOnly: false,
        verifyDisabled: true,
        filesModifiedCount: 0,
      }),
      false
    );
  });
});
