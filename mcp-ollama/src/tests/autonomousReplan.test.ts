import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousAgent } from '../agents/AutonomousAgent.js';

/**
 * Tier-2 self-correction: when a CRITICAL step exhausts param-level corrections,
 * the agent should re-plan the remaining work with a different strategy instead
 * of failing the whole task.
 */

function makeTask(): any {
  return {
    id: 't1',
    description: 'build feature X',
    context: { language: 'typescript' },
    status: 'executing',
    progress: 0,
    currentStep: '',
    startTime: Date.now(),
  };
}

function makePlan(): any {
  return {
    steps: [
      {
        id: 'step_1',
        action: 'do X with the project tool',
        tool: 'project',
        params: {},
        validation: 'done',
        critical: true,
        status: 'pending',
        attempts: 0,
        maxAttempts: 1,
      },
    ],
    riskLevel: 'low',
    estimatedTime: 5,
    dependencies: [],
  };
}

describe('AutonomousAgent strategy-level re-planning', () => {
  it('re-plans remaining work when a critical step exhausts param corrections', async () => {
    const replanJson = JSON.stringify({
      reasoning: 'switch from the project tool to direct code generation',
      steps: [
        {
          action: 'implement feature X with the code agent',
          tool: 'code',
          params: {},
          validation: 'code generated',
          critical: true,
        },
      ],
    });

    const provider: any = {
      generateText: async () => replanJson,
      getModel: () => 'fake-model',
    };

    const failAgent = { execute: async () => ({ success: false, error: 'project tool cannot do this' }) };
    let codeCalls = 0;
    const codeAgent = {
      execute: async () => {
        codeCalls++;
        return { success: true, filesModified: ['src/x.ts'] };
      },
    };

    const agents = new Map<string, any>([
      ['project', failAgent],
      ['code', codeAgent],
    ]);

    const agent = new AutonomousAgent(provider, {} as any, agents);
    const results = await (agent as any).executeWithSelfCorrection(makeTask(), makePlan());

    assert.equal(results.replans, 1, 'should have re-planned exactly once');
    assert.equal(results.success, true, 're-planned code step should succeed');
    assert.equal(codeCalls, 1, 'the re-planned code step should have executed');
    assert.ok(
      results.steps.some((s: any) => s.tool === 'planner'),
      'a planner/re-plan marker step should be recorded'
    );
    assert.ok(
      results.steps.some((s: any) => s.success && s.tool === 'code'),
      'the code step should be recorded as successful'
    );
  });

  it('fails gracefully (no crash) when the re-planner produces nothing usable', async () => {
    const provider: any = {
      generateText: async () => 'this is not json at all',
      getModel: () => 'fake-model',
    };

    const failAgent = { execute: async () => ({ success: false, error: 'always fails' }) };
    const agents = new Map<string, any>([['project', failAgent], ['code', failAgent]]);

    const agent = new AutonomousAgent(provider, {} as any, agents);
    const results = await (agent as any).executeWithSelfCorrection(makeTask(), makePlan());

    assert.equal(results.success, false, 'task should fail when no re-plan is possible');
    assert.equal(results.replans, 0, 'no re-plan should be counted when none is produced');
    assert.ok(
      results.steps.some((s: any) => s.success === false),
      'a terminal failure step should be recorded'
    );
  });

  it('respects AUTONOMOUS_MAX_REPLANS=0 (re-planning disabled)', async () => {
    const prev = process.env.AUTONOMOUS_MAX_REPLANS;
    process.env.AUTONOMOUS_MAX_REPLANS = '0';
    try {
      const replanJson = JSON.stringify({
        reasoning: 'x',
        steps: [{ action: 'y', tool: 'code', params: {}, validation: 'z', critical: true }],
      });
      const provider: any = { generateText: async () => replanJson, getModel: () => 'm' };
      const failAgent = { execute: async () => ({ success: false }) };
      const agents = new Map<string, any>([['project', failAgent], ['code', failAgent]]);

      const agent = new AutonomousAgent(provider, {} as any, agents);
      const results = await (agent as any).executeWithSelfCorrection(makeTask(), makePlan());

      assert.equal(results.replans, 0, 'no re-plan when budget is 0');
      assert.equal(results.success, false);
    } finally {
      if (prev === undefined) delete process.env.AUTONOMOUS_MAX_REPLANS;
      else process.env.AUTONOMOUS_MAX_REPLANS = prev;
    }
  });
});
