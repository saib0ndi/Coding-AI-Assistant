/**
 * Pure rule-based routing helpers for agent workflow planning.
 * Extracted for testability — no LLM calls.
 */

function hasKeyword(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some((word) => {
        const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return pattern.test(lower);
    });
}

export function inferAgentTool(action: string): string {
    const lower = action.toLowerCase();
    if (hasKeyword(lower, ['file']) || lower.includes('create') || lower.includes('write')) return 'file';
    if (hasKeyword(lower, ['code']) || lower.includes('implement')) return 'code';
    if (hasKeyword(lower, ['test'])) return 'test';
    if (hasKeyword(lower, ['project']) || lower.includes('setup') || lower.includes('build')) return 'project';
    if (hasKeyword(lower, ['analyze']) || lower.includes('git') || lower.includes('commit')) return 'project';
    return 'code';
}

export type WorkflowCategory = 'implement' | 'test' | 'refactor' | 'general';

export function classifyTask(type: string, description: string): WorkflowCategory {
    const desc = description.toLowerCase();
    if (
        type === 'fix' ||
        type === 'implement' ||
        hasKeyword(desc, ['fix', 'implement']) ||
        desc.includes('create') ||
        desc.includes('add')
    ) {
        return 'implement';
    }
    if (type === 'test' || hasKeyword(desc, ['test', 'spec'])) {
        return 'test';
    }
    if (type === 'refactor' || hasKeyword(desc, ['refactor']) || desc.includes('clean') || desc.includes('optimize')) {
        return 'refactor';
    }
    return 'general';
}
