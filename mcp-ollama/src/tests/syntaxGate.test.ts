import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxGate } from '../verify/SyntaxGate.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';

/*
 * Validates the deterministic syntax gate that guards generated-code writes.
 *
 * The motivating real-world failures (observed in the running server):
 *   - a regex with nothing to repeat (the double-star alternation bug) -> TS1507
 *   - LLM emitting trailing JSON garbage / unbalanced braces
 *
 * The gate must REJECT these while ACCEPTING valid TypeScript, with no false
 * positives from missing imports (i.e. it must not behave like per-file tsc).
 */
describe('SyntaxGate', () => {
    const fs = new FileSystemTool();

    it('accepts valid TypeScript even with unresolved imports', async () => {
        const code = `import { Foo } from './nowhere.js';\nexport function bar(x: number): number { return x * 2; }\n`;
        const res = await SyntaxGate.validate('sample.ts', code, fs);
        assert.equal(res.ok, true, res.output);
        assert.equal(res.checker, 'typescript');
    });

    it('rejects the invalid regex that corrupted ResponseValidator.ts (TS1507)', async () => {
        const code = `const n = (line.match(/__|**/g) || []).length;\n`;
        const res = await SyntaxGate.validate('Validator.ts', code, fs);
        assert.equal(res.ok, false);
        assert.equal(res.checker, 'typescript');
        assert.ok(
            /repeat|repetition|invalid regular expression|1507/i.test(res.output ?? ''),
            `expected an invalid-regex error, got: ${res.output}`
        );
    });

    it('rejects unbalanced braces / trailing JSON garbage', async () => {
        const code = `export const x = { a: 1 };\n}\n]\n`;
        const res = await SyntaxGate.validate('broken.ts', code, fs);
        assert.equal(res.ok, false);
    });

    it('accepts valid JSON and rejects malformed JSON', async () => {
        const good = await SyntaxGate.validate('a.json', '{"k": [1, 2, 3]}', fs);
        assert.equal(good.ok, true);

        const bad = await SyntaxGate.validate('b.json', '{"k": [1, 2, }', fs);
        assert.equal(bad.ok, false);
        assert.equal(bad.checker, 'json');
    });

    it('falls back to a delimiter check for unknown languages', async () => {
        const ok = await SyntaxGate.validate('a.rb', 'def foo\n  bar()\nend\n', fs);
        assert.equal(ok.ok, true);
        assert.equal(ok.checker, 'delimiters');

        const bad = await SyntaxGate.validate('b.rb', 'def foo( unclosed\n', fs);
        assert.equal(bad.ok, false);
        assert.equal(bad.checker, 'delimiters');
    });

    it('ignores delimiters inside string literals (no false positive)', async () => {
        const res = await SyntaxGate.validate('a.txt', 'const s = "a ( b [ c { not real";\n', fs);
        assert.equal(res.ok, true);
    });
});
