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

export interface AgentResult {
    taskId: string;
    success: boolean;
    steps: WorkflowStep[];
    summary: string;
    filesModified: string[];
    error?: string;
    executionTime?: number;
    autonomous?: boolean;
}

export interface AgentCapability {
    name: string;
    description: string;
    tools: string[];
    examples: string[];
}