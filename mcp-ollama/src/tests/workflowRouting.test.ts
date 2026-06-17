import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferAgentTool, classifyTask } from '../agents/workflowRouting.js';

describe('inferAgentTool', () => {
    it('routes file operations to file agent', () => {
        assert.equal(inferAgentTool('create a new file'), 'file');
        assert.equal(inferAgentTool('write config'), 'file');
    });

    it('routes code operations to code agent', () => {
        assert.equal(inferAgentTool('implement login handler'), 'code');
        assert.equal(inferAgentTool('update the code'), 'code');
    });

    it('routes test operations to test agent', () => {
        assert.equal(inferAgentTool('run unit test suite'), 'test');
    });

    it('routes project operations to project agent', () => {
        assert.equal(inferAgentTool('setup build pipeline'), 'project');
        assert.equal(inferAgentTool('git commit changes'), 'project');
    });

    it('defaults to code agent', () => {
        assert.equal(inferAgentTool('do something vague'), 'code');
    });

    it('does not match "test" inside unrelated words', () => {
        assert.equal(inferAgentTool('update the latest manifest'), 'code');
    });
});

describe('classifyTask', () => {
    it('classifies implement tasks', () => {
        assert.equal(classifyTask('general', 'fix the login bug'), 'implement');
        assert.equal(classifyTask('implement', 'add feature'), 'implement');
    });

    it('classifies test tasks', () => {
        assert.equal(classifyTask('test', 'generate coverage'), 'test');
        assert.equal(classifyTask('general', 'write spec for api'), 'test');
    });

    it('classifies refactor tasks', () => {
        assert.equal(classifyTask('refactor', 'clean up module'), 'refactor');
        assert.equal(classifyTask('general', 'optimize performance'), 'refactor');
    });

    it('classifies general tasks', () => {
        assert.equal(classifyTask('general', 'explain this function'), 'general');
    });

    it('does not misclassify words containing "test" as substrings', () => {
        assert.equal(classifyTask('general', 'update the latest manifest'), 'general');
    });
});
