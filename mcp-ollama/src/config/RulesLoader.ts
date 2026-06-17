import fs from 'fs';
import path from 'path';

/**
 * Loads persistent project-level instructions and injects them into agent /
 * chat system prompts — the equivalent of Cursor's AGENTS.md / Project Rules.
 *
 * Resolution order (highest precedence first):
 *   1. <workspace>/.coding-ai/rules/*.md   — project rule files (alphabetical)
 *   2. <workspace>/AGENTS.md               — top-level agents instruction file
 *   3. <workspace>/.cursor/rules/*.mdc     — Cursor-style rule files (plain text part)
 *
 * Any file can opt out of a rule with the frontmatter `apply: never`.
 * Files starting with `#` comment lines are included as-is.
 * The total injected text is capped at MAX_RULES_CHARS to keep prompts bounded.
 *
 * Usage:
 *   const block = RulesLoader.load(workspacePath);
 *   if (block) prompt = block + '\n\n' + prompt;
 */

const MAX_RULES_CHARS = 8_000;

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const APPLY_NEVER_RE = /^apply\s*:\s*never\s*$/im;

function readRuleFile(filePath: string): string | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        // Strip frontmatter and skip files marked apply:never
        const fm = raw.match(FRONTMATTER_RE);
        if (fm && APPLY_NEVER_RE.test(fm[1])) return null;
        const body = fm ? raw.slice(fm[0].length) : raw;
        return body.trim();
    } catch {
        return null;
    }
}

function globMd(dir: string, ext: string): string[] {
    try {
        return fs.readdirSync(dir)
            .filter(f => f.endsWith(ext) && !f.startsWith('.'))
            .sort()
            .map(f => path.join(dir, f));
    } catch {
        return [];
    }
}

export class RulesLoader {
    private static cache = new Map<string, { text: string; mtime: number }>();

    /**
     * Return a merged rule block for the workspace, or null if none exists.
     * The result is suitable for prepending to any system prompt.
     * Results are cached for 5 s per workspace to avoid per-request I/O.
     */
    static load(workspacePath: string): string | null {
        const key = path.resolve(workspacePath);
        const now = Date.now();
        const cached = RulesLoader.cache.get(key);
        if (cached && now - cached.mtime < 5_000) {
            return cached.text || null;
        }

        const sections: string[] = [];

        // 1. .coding-ai/rules/*.md
        const codingAiRulesDir = path.join(key, '.coding-ai', 'rules');
        for (const f of globMd(codingAiRulesDir, '.md')) {
            const body = readRuleFile(f);
            if (body) sections.push(body);
        }

        // 2. AGENTS.md
        const agentsMd = readRuleFile(path.join(key, 'AGENTS.md'));
        if (agentsMd) sections.push(agentsMd);

        // 3. .cursor/rules/*.mdc (treat as plain markdown, strip frontmatter)
        const cursorRulesDir = path.join(key, '.cursor', 'rules');
        for (const f of globMd(cursorRulesDir, '.mdc')) {
            const body = readRuleFile(f);
            if (body) sections.push(body);
        }

        if (sections.length === 0) {
            RulesLoader.cache.set(key, { text: '', mtime: now });
            return null;
        }

        let merged = sections.join('\n\n---\n\n');
        if (merged.length > MAX_RULES_CHARS) {
            merged = merged.slice(0, MAX_RULES_CHARS) + '\n[rules truncated]';
        }

        const text = `# Project Rules\n\n${merged}`;
        RulesLoader.cache.set(key, { text, mtime: now });
        return text;
    }

    /** Invalidate the cache for a workspace (e.g. after a rule file is edited). */
    static invalidate(workspacePath: string): void {
        RulesLoader.cache.delete(path.resolve(workspacePath));
    }
}
