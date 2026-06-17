import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeCommand, inferTaskType, isChatOnlyQuestion } from '../agents/intentRouter.js';

describe('inferTaskType', () => {
  it('infers fix from bug reports', () => {
    assert.equal(inferTaskType('fix the login bug'), 'fix');
  });

  it('infers test from generate tests', () => {
    assert.equal(inferTaskType('generate unit tests for UserService'), 'test');
  });

  it('respects explicit non-default type', () => {
    assert.equal(inferTaskType('create a helper', 'analyze'), 'analyze');
  });

  it('ignores default implement type and infers from description', () => {
    assert.equal(inferTaskType('fix AuthService.ts', 'implement'), 'fix');
  });
});

describe('routeCommand', () => {
  it('routes mkdir to fast_fs', () => {
    const route = routeCommand('create a folder inside mcp-ollama with the name sai');
    assert.equal(route.strategy, 'fast_fs');
    assert.equal(route.tool, 'file');
    assert.equal(route.target, 'mcp-ollama/sai');
  });

  it('routes create file to fast_fs', () => {
    const route = routeCommand('create a file inside mcp-ollama with the name sai');
    assert.equal(route.strategy, 'fast_fs');
    assert.equal(route.semanticIntent, 'create_file');
  });

  it('routes implement feature to semantic or autonomous', () => {
    const route = routeCommand('implement user authentication with JWT');
    assert.equal(route.taskType, 'implement');
    assert.ok(['semantic_agent', 'autonomous'].includes(route.strategy));
  });

  it('routes fix code with fix task type', () => {
    const route = routeCommand('fix the error in AuthService.ts');
    assert.equal(route.taskType, 'fix');
  });

  it('does not treat code tasks as mkdir', () => {
    const route = routeCommand('create a login handler for users');
    assert.notEqual(route.strategy, 'fast_fs');
  });
});

describe('isChatOnlyQuestion', () => {
  it('detects pure questions', () => {
    assert.equal(isChatOnlyQuestion('how does authentication work?'), true);
  });

  it('allows action questions', () => {
    assert.equal(isChatOnlyQuestion('how do I fix the login bug'), false);
  });

  it('treats knowledge/recommendation requests with no code target as chat', () => {
    assert.equal(isChatOnlyQuestion('suggest me best ai agent papers'), true);
    assert.equal(isChatOnlyQuestion('recommend a vector database for embeddings'), true);
    assert.equal(isChatOnlyQuestion('what are the best practices for prompt design'), true);
    assert.equal(isChatOnlyQuestion('list some good resources to learn rust'), true);
  });

  it('still routes actionable code requests to the agent', () => {
    assert.equal(isChatOnlyQuestion('refactor the authentication module'), false);
    assert.equal(isChatOnlyQuestion('implement user login'), false);
    assert.equal(isChatOnlyQuestion('add a dark mode toggle to the settings page'), false);
    assert.equal(isChatOnlyQuestion('update src/index.ts to export the new helper'), false);
    assert.equal(isChatOnlyQuestion('the project build is failing with a type error'), false);
  });
});
