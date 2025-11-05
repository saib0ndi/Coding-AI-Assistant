#!/usr/bin/env node

/**
 * Test Updated Extension Integration
 */

import { spawn } from 'child_process';
import fetch from 'node-fetch';

class ExtensionUpdateTest {
  constructor() {
    this.serverProcess = null;
  }

  async testUpdate() {
    console.log('🔄 Testing Updated Extension Integration');
    console.log('=' .repeat(50));

    try {
      await this.startServer();
      await this.waitForServer();
      await this.testExtensionEndpoints();
    } finally {
      await this.stopServer();
    }
  }

  async testExtensionEndpoints() {
    console.log('\n🧪 Testing Extension Endpoints...');

    const tests = [
      { name: 'Health Check', endpoint: '/health' },
      { name: 'Project Creation', endpoint: '/tools/ai_project_planner', method: 'POST', body: { userInput: 'Create a simple web app' } },
      { name: 'Code Generation', endpoint: '/tools/code_generation', method: 'POST', body: { prompt: 'Hello world function', language: 'javascript' } },
      { name: 'Agent Execution', endpoint: '/tools/agent_execute', method: 'POST', body: { description: 'Create test file' } }
    ];

    for (const test of tests) {
      await this.runTest(test);
    }
  }

  async runTest(test) {
    try {
      const options = {
        method: test.method || 'GET',
        timeout: 10000
      };

      if (test.body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(test.body);
      }

      const response = await fetch(`http://localhost:3077${test.endpoint}`, options);
      
      if (response.ok) {
        const data = await response.json();
        
        // Check if response has proper MCP format for tools
        if (test.endpoint.startsWith('/tools/') && data.content && data.content[0]) {
          console.log(`✅ ${test.name}: MCP format correct`);
        } else if (test.endpoint === '/health') {
          console.log(`✅ ${test.name}: Server healthy`);
        } else {
          console.log(`✅ ${test.name}: Response received`);
        }
      } else {
        console.log(`❌ ${test.name}: HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
    }
  }

  async startServer() {
    console.log('🔧 Starting server...');
    
    this.serverProcess = spawn('node', ['dist/index.js'], {
      stdio: 'pipe',
      detached: false,
      cwd: process.cwd()
    });

    this.serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Server started') || output.includes('running on port')) {
        console.log('✅ Server output detected');
      }
    });

    this.serverProcess.stderr.on('data', (data) => {
      console.log('Server error:', data.toString());
    });

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  async waitForServer() {
    console.log('⏳ Waiting for server...');
    
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch('http://localhost:3077/health', { timeout: 2000 });
        if (response.ok) {
          console.log('✅ Server ready');
          return;
        }
      } catch (error) {
        // Wait more
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      await new Promise(resolve => {
        this.serverProcess.on('exit', resolve);
        setTimeout(resolve, 2000);
      });
    }
  }
}

// Run test
const test = new ExtensionUpdateTest();
test.testUpdate().catch(console.error);