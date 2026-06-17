export interface AgentTask {
    id: string;
    type: 'implement' | 'fix' | 'test' | 'refactor' | 'analyze';
    description: string;
    context: {
        workspacePath: string;
        files?: string[];
        language?: string;
    };
    priority: 'low' | 'medium' | 'high';
    status: 'pending' | 'planning' | 'executing' | 'completed' | 'failed';
}

export interface WorkflowStep {
    id: string;
    action: string;
    tool: string;
    params: Record<string, any>;
    dependencies?: string[];
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: any;
    error?: string;
}

export interface WorkflowPlan {
    taskId: string;
    steps: WorkflowStep[];
    estimatedTime: number;
    requiredApprovals: string[];
}

export interface HallucinationSummary {
    hallucinationRate: number;
    groundedScore: number;
    flagCount: number;
    flags: Array<{ type: string; severity: string; message: string }>;
    samplesAnalyzed: number;
    measuredAt: string;
}

export interface VerificationSummary {
    passed: boolean;
    summary: string;
    checks: Array<{
        name: string;
        command: string;
        passed: boolean;
        exitCode: number;
        skipped?: boolean;
    }>;
}

export interface AgentResult {
    taskId: string;
    success: boolean;
    steps: WorkflowStep[];
    summary: string;
    filesModified: string[];
    proposedChanges?: Array<{
        filePath: string;
        original: string;
        modified: string;
        status: 'added' | 'modified' | 'deleted';
        changeSummary?: string;
        additions?: Array<{ line: number; text: string }>;
        anchorLine?: number;
        anchorText?: string;
    }>;
    error?: string;
    executionTime?: number;
    autonomous?: boolean;
    verification?: VerificationSummary;
    verified?: boolean;
    hallucination?: HallucinationSummary;
}

export interface AgentCapability {
    name: string;
    description: string;
    tools: string[];
    examples: string[];
}
