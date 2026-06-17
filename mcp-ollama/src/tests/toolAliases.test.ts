import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToolName, normalizeAliasParams, TOOL_ALIASES } from '../tools/toolAliases.js';

describe('resolveToolName', () => {
    it('maps legacy aliases to canonical tools', () => {
        assert.equal(resolveToolName('code_explanation').canonical, 'explain_code');
        assert.equal(resolveToolName('code_explanation').alias, 'code_explanation');
        assert.equal(resolveToolName('refactoring_suggestions').canonical, 'refactor_code');
    });

    it('passes through canonical names unchanged', () => {
        const result = resolveToolName('explain_code');
        assert.equal(result.canonical, 'explain_code');
        assert.equal(result.alias, null);
    });
});

describe('normalizeAliasParams', () => {
    it('maps level to detail for code_explanation', () => {
        const normalized = normalizeAliasParams('code_explanation', {
            code: 'x',
            language: 'ts',
            level: 'beginner',
        });
        assert.equal(normalized.detail, 'brief');
    });

    it('maps focusAreas array to focus string for refactoring_suggestions', () => {
        const normalized = normalizeAliasParams('refactoring_suggestions', {
            code: 'x',
            language: 'ts',
            focusAreas: ['readability', 'performance'],
        });
        assert.equal(normalized.focus, 'readability, performance');
    });

    it('returns params unchanged for unknown aliases', () => {
        const params = { code: 'x' };
        assert.deepEqual(normalizeAliasParams('explain_code', params), params);
    });
});

describe('TOOL_ALIASES', () => {
    it('covers both deprecated tool pairs', () => {
        assert.ok(TOOL_ALIASES.code_explanation);
        assert.ok(TOOL_ALIASES.refactoring_suggestions);
    });
});
