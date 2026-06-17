import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LSPClient } from '../dist/lsp/LSPClient.js';
import { CodeAgent } from '../dist/agents/CodeAgent.js';
import { OllamaProvider } from '../dist/providers/OllamaProvider.js';
import { GitHubService } from '../dist/services/GitHubService.js';

async function testLspClient() {
  const client = new LSPClient();
  const code = [
    'import thing from "pkg"',
    'var answer = 41',
    'function add(value) {',
    '  return value == null ? 0 : value + answer;',
    '}',
    'console.log(add(1))',
    'ad'
  ].join('\n');

  const diagnostics = await client.getDiagnostics('sample.ts', code, 'typescript');
  assert.equal(diagnostics.some(d => d.code === 'no-var'), true, 'detects var usage');
  assert.equal(diagnostics.some(d => d.code === 'strict-equality'), true, 'detects loose equality');
  assert.equal(diagnostics.some(d => d.code === 'missing-semicolon'), true, 'detects missing semicolon on console.log');

  const symbols = await client.getSymbols('sample.ts', code);
  assert.equal(symbols.some(s => s.name === 'add' && s.kind === 'function'), true, 'extracts function symbols');
  assert.equal(symbols.some(s => s.name === 'answer' && s.kind === 'variable'), true, 'extracts variable symbols');

  const completions = await client.getCompletions('sample.ts', code, { line: 6, character: 2 }, 'typescript');
  assert.equal(completions.some(c => c.label === 'add'), true, 'returns symbol completions');

  const hover = await client.getHover('sample.ts', code, { line: 5, character: 12 });
  assert.match(hover.contents.value, /\*\*function\*\*: add/, 'returns hover information for known symbols');
}

async function testCodeAgentFixRouting() {
  const filePath = path.join(process.cwd(), 'tmp-smoke.ts');
  const original = 'export const value = 1;\n';
  const modified = 'export const value = 2;\n';
  const writes = new Map();
  const reads = new Map([[filePath, original]]);

  const ollamaProvider = {
    getModel(override, purpose) {
      return 'test-model';
    },
    async generateText() {
      return JSON.stringify({
        edits: [{ target: 'export const value = 1;', replacement: 'export const value = 2;' }]
      });
    }
  };

  const fileSystemTool = {
    async readFile(targetPath) {
      if (writes.has(targetPath)) return writes.get(targetPath);
      if (reads.has(targetPath)) return reads.get(targetPath);
      throw new Error(`missing file: ${targetPath}`);
    },
    async writeFile(targetPath, content) {
      writes.set(targetPath, content);
      return true;
    }
  };

  const agent = new CodeAgent(ollamaProvider, fileSystemTool);
  const result = await agent.executeStep(
    { id: 'fix', action: 'Fix critical errors', tool: 'code', params: {}, status: 'pending' },
    { files: [filePath], language: 'typescript' }
  );

  assert.equal(result.success, true, 'capitalized fix action succeeds');
  assert.deepEqual(result.filesModified, [filePath], 'reports the modified file');
  assert.equal(writes.get(filePath), modified, 'applies targeted edit to the original file');
  assert.equal([...writes.keys()].some(key => key.includes('.backup.')), true, 'creates a backup before editing');
}

async function testOllamaNodeStreamParsing() {
  const provider = new OllamaProvider({
    host: 'http://localhost:11434',
    model: 'test-model',
    timeout: 1000
  });

  provider.stopResourceMonitoring();

  const body = Readable.from([
    '{"response":"hello ","done":false}\n',
    Buffer.from('{"response":"world","done":true}\n')
  ]);

  const text = await provider.readOllamaStreamingResponse({ body });
  assert.equal(text, 'hello world', 'parses node-fetch async iterable response bodies');
}

async function testGitHubInvalidTokenPublicRetry() {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  const calls = [];

  process.env.GITHUB_TOKEN = 'invalid-token';
  globalThis.fetch = async (_url, init = {}) => {
    calls.push(init.headers || {});
    if (calls.length === 1) {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
          return { message: 'Bad credentials' };
        }
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          name: 'react-native',
          full_name: 'facebook/react-native',
          description: 'A framework for building native applications using React',
          language: 'C++',
          stargazers_count: 120000,
          forks_count: 24000,
          open_issues_count: 1000,
          size: 1000,
          created_at: '2015-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          default_branch: 'main',
          topics: ['react', 'native'],
          license: { name: 'MIT' },
          owner: { login: 'facebook', type: 'Organization' }
        };
      }
    };
  };

  try {
    const result = await GitHubService.getInstance().getRepositoryInfo('https://github.com/facebook/react-native.git');
    assert.equal(result.success, true, 'retries public GitHub repo info after token 401');
    assert.equal(result.repository.fullName, 'facebook/react-native');
    assert.equal(calls.length, 2, 'makes authenticated request and public retry');
    assert.equal(Boolean(calls[0].Authorization), true, 'first request includes token');
    assert.equal(Boolean(calls[1].Authorization), false, 'retry omits invalid token');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  }
}

await testLspClient();
await testCodeAgentFixRouting();
await testOllamaNodeStreamParsing();
await testGitHubInvalidTokenPublicRetry();
console.log('Smoke tests passed');
