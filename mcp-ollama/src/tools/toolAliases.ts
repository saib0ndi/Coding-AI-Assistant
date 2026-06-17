/**
 * Legacy tool name aliases — map deprecated names to canonical tools.
 */

export const TOOL_ALIASES: Record<string, string> = {
    code_explanation: 'explain_code',
    refactoring_suggestions: 'refactor_code',
};

export const LEGACY_TOOL_NAMES = new Set(Object.keys(TOOL_ALIASES));

/** Normalize legacy params to canonical tool shape. */
export function normalizeAliasParams(alias: string, params: Record<string, unknown>): Record<string, unknown> {
    if (alias === 'code_explanation') {
        const level = params.level as string | undefined;
        const detail = levelToDetail(level) ?? params.detail;
        return { ...params, detail };
    }
    if (alias === 'refactoring_suggestions') {
        const focusAreas = params.focusAreas;
        if (Array.isArray(focusAreas)) {
            return { ...params, focus: focusAreas.join(', ') };
        }
        return params;
    }
    return params;
}

function levelToDetail(level?: string): string | undefined {
    if (!level) return undefined;
    const map: Record<string, string> = {
        beginner: 'brief',
        intermediate: 'detailed',
        expert: 'comprehensive',
    };
    return map[level];
}

export function resolveToolName(name: string): { canonical: string; alias: string | null } {
    const canonical = TOOL_ALIASES[name] ?? name;
    return { canonical, alias: TOOL_ALIASES[name] ? name : null };
}
