import { WorkflowStep } from '../types/agent.js';

export class WorkflowTemplates {
    static implementFeature(description: string, language: string): WorkflowStep[] {
        return [
            {
                id: 'analyze_requirements',
                action: `Analyze requirements for: ${description}`,
                tool: 'project',
                params: { analysisType: 'requirements' },
                status: 'pending'
            },
            {
                id: 'implement_core',
                action: `Implement core functionality: ${description}`,
                tool: 'code',
                params: { language, type: 'implementation' },
                dependencies: ['analyze_requirements'],
                status: 'pending'
            },
            {
                id: 'generate_tests',
                action: `Generate tests for ${description}`,
                tool: 'test',
                params: { language, testType: 'unit' },
                dependencies: ['implement_core'],
                status: 'pending'
            },
            {
                id: 'run_tests',
                action: 'Run test suite',
                tool: 'test',
                params: { action: 'run' },
                dependencies: ['generate_tests'],
                status: 'pending'
            },
            {
                id: 'commit_changes',
                action: `Commit implementation of ${description}`,
                tool: 'project',
                params: { action: 'commit', message: `feat: implement ${description}` },
                dependencies: ['run_tests'],
                status: 'pending'
            }
        ];
    }

    static fixAllErrors(language: string): WorkflowStep[] {
        return [
            {
                id: 'analyze_errors',
                action: 'Analyze all project errors',
                tool: 'project',
                params: { analysisType: 'errors' },
                status: 'pending'
            },
            {
                id: 'fix_critical_errors',
                action: 'Fix critical errors',
                tool: 'code',
                params: { language, severity: 'critical' },
                dependencies: ['analyze_errors'],
                status: 'pending'
            },
            {
                id: 'verify_fixes',
                action: 'Verify all fixes work',
                tool: 'project',
                params: { action: 'build' },
                dependencies: ['fix_critical_errors'],
                status: 'pending'
            },
            {
                id: 'commit_fixes',
                action: 'Commit error fixes',
                tool: 'project',
                params: { action: 'commit', message: 'fix: resolve all project errors' },
                dependencies: ['verify_fixes'],
                status: 'pending'
            }
        ];
    }

    static addTestSuite(language: string): WorkflowStep[] {
        return [
            {
                id: 'analyze_coverage',
                action: 'Analyze current test coverage',
                tool: 'test',
                params: { action: 'coverage' },
                status: 'pending'
            },
            {
                id: 'generate_tests',
                action: 'Generate comprehensive tests',
                tool: 'test',
                params: { language, testType: 'unit' },
                dependencies: ['analyze_coverage'],
                status: 'pending'
            },
            {
                id: 'run_tests',
                action: 'Run complete test suite',
                tool: 'test',
                params: { action: 'run_all' },
                dependencies: ['generate_tests'],
                status: 'pending'
            },
            {
                id: 'commit_tests',
                action: 'Commit test suite',
                tool: 'project',
                params: { action: 'commit', message: 'test: add comprehensive test suite' },
                dependencies: ['run_tests'],
                status: 'pending'
            }
        ];
    }

    static getTemplate(type: string, params: any): WorkflowStep[] {
        const { language = 'typescript', description = '' } = params;

        switch (type) {
            case 'implement':
                return this.implementFeature(description, language);
            case 'fix':
                return this.fixAllErrors(language);
            case 'test':
                return this.addTestSuite(language);
            default:
                return [
                    {
                        id: 'generic_task',
                        action: description || 'Execute generic task',
                        tool: 'code',
                        params: { language },
                        status: 'pending'
                    }
                ];
        }
    }
}