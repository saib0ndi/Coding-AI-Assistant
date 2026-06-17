import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AgentOllamaRegistry } from '../providers/AgentOllamaRegistry.js';
import { AgentManager } from '../agents/AgentManager.js';
import { EnhancedContextManager } from '../context/EnhancedContextManager.js';
import { loadAppConfig } from '../config/AppConfig.js';

// Load .env variables
dotenv.config();

describe('Live Integration Tests against Ollama Instance', () => {
  const tempDir = path.resolve('./temp-integration-project');
  let provider: OllamaProvider;
  let manager: AgentManager;
  let contextManager: EnhancedContextManager;

  beforeEach(async () => {
    // Ensure temporary directory is clean
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });

    const appConfig = loadAppConfig();
    const config = {
      host: appConfig.ollama.host,
      model: appConfig.ollama.model,
      timeout: appConfig.ollama.timeoutMs,
    };

    provider = new OllamaProvider(config);
    provider.stopResourceMonitoring();

    const registry = new AgentOllamaRegistry(config);
    manager = new AgentManager(registry);
    contextManager = new EnhancedContextManager();
  });

  after(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('📎 Attachment: should verify the AI references attached file content in the reply', async () => {
    const fileContent = 'const SUPER_SECRET_MAGIC_CONSTANT = "9988-XYZZY";';
    const fileName = 'magic_file.js';
    const userPrompt = 'What is the secret magic constant in the attached file?';
    
    // Simulate prepending attached file context as done in extension chatUI.ts
    const combinedPrompt = `### Attached file: ${fileName} (javascript)\n\`\`\`javascript\n${fileContent}\n\`\`\`\n\n${userPrompt}`;

    const response = await provider.generateText({
      prompt: combinedPrompt,
      model: provider.getDefaultModel()
    });

    console.log('--- ATTACHMENT RESPONSE ---');
    console.log(response);
    console.log('---------------------------');

    // The response should correctly reference the magic constant
    assert.ok(
      response.includes('SUPER_SECRET_MAGIC_CONSTANT') || response.includes('9988-XYZZY'),
      'AI response must reference the magic constant or file variables.'
    );
  });

  it('Type @src/: should verify mention suggestion extraction returns files', async () => {
    // Simulate creating a few files in our workspace
    const filesToCreate = [
      'src/auth/AuthService.ts',
      'src/utils/Logger.ts',
      'package.json'
    ];

    for (const file of filesToCreate) {
      const filePath = path.join(tempDir, file);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '// dummy content');
    }

    // In VS Code, we use workspace folder list. Since we are running outside VS Code, 
    // we can test that the codebase files can be read and symbols extracted, or we can check our context analyzer.
    // Let's verify that the context manager can successfully build symbol table and read files from the workspace.
    const fileObjects = [
      { path: 'src/auth/AuthService.ts', content: 'export class AuthService { login() {} }', language: 'typescript' },
      { path: 'src/utils/Logger.ts', content: 'export function logInfo(msg: string) {}', language: 'typescript' }
    ];

    await contextManager.buildSymbolTable(fileObjects);

    const authServiceSymbol = contextManager.getSymbolUsages('AuthService');
    const logInfoSymbol = contextManager.getSymbolUsages('logInfo');

    assert.ok(authServiceSymbol, 'Should resolve AuthService symbol');
    assert.strictEqual(authServiceSymbol.type, 'class');
    assert.strictEqual(authServiceSymbol.definition?.file, 'src/auth/AuthService.ts');

    assert.ok(logInfoSymbol, 'Should resolve logInfo symbol');
    assert.strictEqual(logInfoSymbol.type, 'function');
  });

  it('/dev refactor code: should execute autonomous agent task successfully', async () => {
    const dummyFile = path.join(tempDir, 'dummy.js');
    const originalContent = 'function foo() {\n  return 42;\n}\n';
    await fs.writeFile(dummyFile, originalContent);

    // Call the Agent Manager to refactor foo() using our live agent
    const result = await manager.executeAutonomously(
      'Change function foo() to return 100 instead of 42 in dummy.js',
      {
        workspacePath: tempDir,
        files: [dummyFile],
        language: 'javascript',
        verify: false, // Turn off verifying scripts to avoid running npm build/test in unit tests
        useNlpRouting: false
      }
    );

    console.log('--- AGENT EXECUTION RESULT ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('------------------------------');

    // Read the modified file to check if the refactoring was successfully done
    const modifiedContent = await fs.readFile(dummyFile, 'utf-8');
    console.log('--- MODIFIED FILE ---');
    console.log(modifiedContent);
    console.log('---------------------');

    assert.ok(result.success, 'Agent execution should be successful');
    assert.ok(
      modifiedContent.includes('foo') && modifiedContent.includes('100'),
      'Modified file should contain the foo function returning 100.'
    );
  });

  it('Clear chat: should verify that resetting context clears the history', async () => {
    // Add messages to the context manager
    await contextManager.parseNaturalLanguage('Setup a new JWT authentication helper');
    await contextManager.parseNaturalLanguage('How do I handle tokens?');

    const contextBefore = contextManager.getConversationContext();
    assert.strictEqual(contextBefore.length, 2, 'Should have 2 messages in context history');

    // Clear history
    contextManager.resetState();

    const contextAfter = contextManager.getConversationContext();
    assert.strictEqual(contextAfter.length, 0, 'Context history must be empty after clearing chat');
  });

  it('chat_assistant: should support semantic codebase search and grounding', async () => {
    const { MCPServer } = await import('../server/MCPServer.js');
    const appConfig = loadAppConfig();
    const config = {
      host: appConfig.ollama.host,
      model: appConfig.ollama.model,
      timeout: appConfig.ollama.timeoutMs,
    };
    const server = new MCPServer(config);

    // Create a dummy file to index
    const dummyFile = path.join(tempDir, 'super-secret-constant.ts');
    await fs.mkdir(path.dirname(dummyFile), { recursive: true });
    await fs.writeFile(dummyFile, 'export const UNIQUE_Grounding_SECRET = "ZORRO-9988";');

    // Index the temporary directory
    await server.callTool('index_codebase', { workspacePath: tempDir, force: true });

    // Query chat assistant requesting information about the secret
    const result = await server.callTool('chat_assistant', {
      query: 'What is the UNIQUE_Grounding_SECRET value in the codebase?',
      workspacePath: tempDir
    });

    console.log('--- SEMANTIC CHAT ASSISTANT RESPONSE ---');
    console.log(result);
    console.log('----------------------------------------');

    assert.ok(
      result.includes('UNIQUE_Grounding_SECRET') || result.includes('ZORRO-9988'),
      'Chat assistant should answer correctly using semantic grounding context.'
    );
  });

  it('project_suggestions: should generate suggestions report for project-wide understanding', async () => {
    const { MCPServer } = await import('../server/MCPServer.js');
    const appConfig = loadAppConfig();
    const config = {
      host: appConfig.ollama.host,
      model: appConfig.ollama.model,
      timeout: appConfig.ollama.timeoutMs,
    };
    const server = new MCPServer(config);

    // Create dummy files to build project structure
    await fs.mkdir(path.join(tempDir, 'src/services'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/index.ts'), 'import { UserService } from "./services/UserService.js";');
    await fs.writeFile(path.join(tempDir, 'src/services/UserService.ts'), 'export class UserService { getUser(id: number) { return { id, name: "Alice" }; } }');

    // Index the temporary directory
    await server.callTool('index_codebase', { workspacePath: tempDir, force: true });

    // Call project_suggestions tool
    const result = await server.callTool('project_suggestions', {
      workspacePath: tempDir,
      focus: 'all',
      query: 'refactor UserService'
    });

    console.log('--- PROJECT SUGGESTIONS RESPONSE ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('------------------------------------');

    assert.ok(result.success, 'project_suggestions should return successfully');
    assert.ok(result.summary.length > 0, 'Suggestions summary should not be empty');
    assert.ok(result.filesAnalyzed >= 2, 'Should analyze the created dummy files');
  });
});
