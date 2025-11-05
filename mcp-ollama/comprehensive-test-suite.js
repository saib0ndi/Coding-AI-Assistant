#!/usr/bin/env node

/**
 * Comprehensive Test Suite for MCP-Ollama Project
 * Tests all functionality across the entire codebase
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

class ComprehensiveTestSuite {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      details: []
    };
    this.startTime = Date.now();
  }

  async runAllTests() {
    console.log('🚀 Starting Comprehensive Test Suite for MCP-Ollama');
    console.log('=' .repeat(60));

    // Test categories
    const testCategories = [
      { name: 'Core Infrastructure', tests: this.testCoreInfrastructure.bind(this) },
      { name: 'Agent System', tests: this.testAgentSystem.bind(this) },
      { name: 'Providers & Services', tests: this.testProvidersServices.bind(this) },
      { name: 'Server Components', tests: this.testServerComponents.bind(this) },
      { name: 'Tools & Utilities', tests: this.testToolsUtilities.bind(this) },
      { name: 'VS Code Extension', tests: this.testVSCodeExtension.bind(this) },
      { name: 'Integration Tests', tests: this.testIntegration.bind(this) },
      { name: 'Performance Tests', tests: this.testPerformance.bind(this) }
    ];

    for (const category of testCategories) {
      console.log(`\n📋 Testing: ${category.name}`);
      console.log('-'.repeat(40));
      await category.tests();
    }

    this.printSummary();
  }

  async testCoreInfrastructure() {
    await this.testFile('Package Configuration', 'package.json');
    await this.testFile('TypeScript Config', 'tsconfig.json');
    await this.testFile('Environment Config', '.env.example');
    await this.testDirectory('Source Directory', 'src');
    await this.testDirectory('Types Directory', 'src/types');
    await this.testCompilation();
  }

  async testAgentSystem() {
    const agentFiles = [
      'src/agents/AgentManager.ts',
      'src/agents/AutonomousAgent.ts',
      'src/agents/CodeAgent.ts',
      'src/agents/EnhancedAgentManager.ts',
      'src/agents/ProjectAgent.ts'
    ];

    for (const file of agentFiles) {
      await this.testFile(`Agent: ${path.basename(file)}`, file);
    }

    // Test agent functionality
    await this.testScript('Agent Directory Creation', 'test-agent-directory-capability.mjs');
    await this.testScript('Agent Execution', 'test-agents-working.js');
    await this.testScript('Autonomous Agent', 'test-autonomous.cjs');
  }

  async testProvidersServices() {
    const providerFiles = [
      'src/providers/OllamaProvider.ts',
      'src/services/GitHubService.ts',
      'src/services/GitHubRepositoryAnalyzer.ts',
      'src/semantic/VectorStore.ts',
      'src/security/SecurityScanner.ts'
    ];

    for (const file of providerFiles) {
      await this.testFile(`Provider/Service: ${path.basename(file)}`, file);
    }

    // Test provider functionality
    await this.testScript('Ollama Provider', 'test-real-ollama.cjs');
    await this.testScript('GitHub Service', 'test-github-client.js');
    await this.testScript('Repository Analyzer', 'test-repository-analyzer.js');
  }

  async testServerComponents() {
    const serverFiles = [
      'src/server/MCPServer.ts',
      'src/server/HTTPServer.ts',
      'src/server/RequestRouter.ts'
    ];

    for (const file of serverFiles) {
      await this.testFile(`Server: ${path.basename(file)}`, file);
    }

    // Test server functionality
    await this.testScript('Server Basic', 'test-server.cjs');
    await this.testScript('Fast Server', 'fast-server.js');
  }

  async testToolsUtilities() {
    const utilFiles = [
      'src/utils/CacheManager.ts',
      'src/utils/ContextManager.ts',
      'src/utils/ErrorAnalyzer.ts',
      'src/utils/Logger.ts',
      'src/tools/FileSystemTool.ts',
      'src/tools/BuildTool.ts'
    ];

    for (const file of utilFiles) {
      await this.testFile(`Utility: ${path.basename(file)}`, file);
    }

    // Test tool functionality
    await this.testScript('File System Tool', 'test-file-system-tool.mjs');
    await this.testScript('Tools Simple', 'test-tools-simple.mjs');
  }

  async testVSCodeExtension() {
    const extensionFiles = [
      'vscode-extension/src/extension.ts',
      'vscode-extension/src/mcpClient.ts',
      'vscode-extension/src/chatUI.ts',
      'vscode-extension/src/inlineCompletionProvider.ts'
    ];

    for (const file of extensionFiles) {
      await this.testFile(`Extension: ${path.basename(file)}`, file);
    }

    await this.testFile('Extension Package', 'vscode-extension/package.json');
  }

  async testIntegration() {
    const integrationTests = [
      'test-all-functionality.js',
      'test-complete-analysis.js',
      'test-integrated-nlp-semantic.mjs',
      'test-semantic-integration.cjs'
    ];

    for (const test of integrationTests) {
      await this.testScript(`Integration: ${test}`, test);
    }
  }

  async testPerformance() {
    const performanceTests = [
      'test-capacity-gradual.js',
      'test-high-capacity.js',
      'quick-test.js'
    ];

    for (const test of performanceTests) {
      await this.testScript(`Performance: ${test}`, test, 30000); // 30s timeout
    }
  }

  async testFile(name, filePath) {
    try {
      const fullPath = path.resolve(filePath);
      await fs.access(fullPath);
      const stats = await fs.stat(fullPath);
      
      if (stats.size === 0) {
        this.recordResult(name, false, 'File is empty');
        return;
      }

      // Basic syntax check for TypeScript files
      if (filePath.endsWith('.ts')) {
        const content = await fs.readFile(fullPath, 'utf8');
        if (!content.includes('export') && !content.includes('import')) {
          this.recordResult(name, false, 'No exports/imports found');
          return;
        }
      }

      this.recordResult(name, true, `File exists (${stats.size} bytes)`);
    } catch (error) {
      this.recordResult(name, false, error.message);
    }
  }

  async testDirectory(name, dirPath) {
    try {
      const fullPath = path.resolve(dirPath);
      await fs.access(fullPath);
      const files = await fs.readdir(fullPath);
      this.recordResult(name, true, `Directory exists (${files.length} files)`);
    } catch (error) {
      this.recordResult(name, false, error.message);
    }
  }

  async testScript(name, scriptPath, timeout = 15000) {
    return new Promise((resolve) => {
      try {
        const fullPath = path.resolve(scriptPath);
        const child = spawn('node', [fullPath], {
          stdio: 'pipe',
          timeout
        });

        let output = '';
        let errorOutput = '';

        child.stdout?.on('data', (data) => {
          output += data.toString();
        });

        child.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        const timer = setTimeout(() => {
          child.kill();
          this.recordResult(name, false, 'Timeout');
          resolve();
        }, timeout);

        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            this.recordResult(name, true, 'Script executed successfully');
          } else {
            this.recordResult(name, false, `Exit code: ${code}, Error: ${errorOutput.slice(0, 100)}`);
          }
          resolve();
        });

        child.on('error', (error) => {
          clearTimeout(timer);
          this.recordResult(name, false, error.message);
          resolve();
        });

      } catch (error) {
        this.recordResult(name, false, `Cannot execute: ${error.message}`);
        resolve();
      }
    });
  }

  async testCompilation() {
    return new Promise((resolve) => {
      const child = spawn('npx', ['tsc', '--noEmit'], {
        stdio: 'pipe'
      });

      let output = '';
      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          this.recordResult('TypeScript Compilation', true, 'No compilation errors');
        } else {
          const errors = output.split('\n').filter(line => line.includes('error')).length;
          this.recordResult('TypeScript Compilation', false, `${errors} compilation errors`);
        }
        resolve();
      });

      child.on('error', (error) => {
        this.recordResult('TypeScript Compilation', false, error.message);
        resolve();
      });
    });
  }

  recordResult(testName, passed, details) {
    const result = {
      name: testName,
      passed,
      details,
      timestamp: new Date().toISOString()
    };

    this.results.details.push(result);
    
    if (passed) {
      this.results.passed++;
      console.log(`✅ ${testName}: ${details}`);
    } else {
      this.results.failed++;
      console.log(`❌ ${testName}: ${details}`);
    }
  }

  printSummary() {
    const duration = Date.now() - this.startTime;
    const total = this.results.passed + this.results.failed + this.results.skipped;

    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏭️  Skipped: ${this.results.skipped}`);
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`📈 Success Rate: ${((this.results.passed / total) * 100).toFixed(1)}%`);

    if (this.results.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.details
        .filter(r => !r.passed)
        .forEach(r => console.log(`   • ${r.name}: ${r.details}`));
    }

    // Save detailed results
    this.saveResults();
  }

  async saveResults() {
    const report = {
      summary: {
        total: this.results.passed + this.results.failed + this.results.skipped,
        passed: this.results.passed,
        failed: this.results.failed,
        skipped: this.results.skipped,
        duration: Date.now() - this.startTime,
        timestamp: new Date().toISOString()
      },
      details: this.results.details
    };

    try {
      await fs.writeFile('test-results.json', JSON.stringify(report, null, 2));
      console.log('\n📄 Detailed results saved to test-results.json');
    } catch (error) {
      console.log(`\n⚠️  Could not save results: ${error.message}`);
    }
  }
}

// Run the comprehensive test suite
const testSuite = new ComprehensiveTestSuite();
testSuite.runAllTests().catch(console.error);