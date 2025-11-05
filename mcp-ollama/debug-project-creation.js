#!/usr/bin/env node

/**
 * Debug Project Creation Issue
 */

import fetch from 'node-fetch';
import { spawn } from 'child_process';

class ProjectCreationDebugger {
  constructor() {
    this.serverProcess = null;
  }

  async debug() {
    console.log('🔍 Debugging Project Creation Issue');
    console.log('=' .repeat(50));

    try {
      await this.startServer();
      await this.waitForServer();
      await this.testProjectCreation();
    } finally {
      await this.stopServer();
    }
  }

  async testProjectCreation() {
    console.log('\n🏗️ Testing Project Creation with Debug Info...');
    
    try {
      const response = await fetch('http://localhost:3077/tools/ai_project_planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: 'I want to create a React todo application with TypeScript'
        }),
        timeout: 20000
      });

      console.log('📊 Response Status:', response.status);
      console.log('📊 Response Headers:', Object.fromEntries(response.headers));

      if (response.ok) {
        const data = await response.json();
        console.log('\n📋 Raw Response Data:');
        console.log(JSON.stringify(data, null, 2));

        // Try to parse the content
        if (data.content && Array.isArray(data.content) && data.content[0]) {
          console.log('\n🔍 Content[0] exists:', !!data.content[0]);
          console.log('🔍 Content[0] type:', typeof data.content[0]);
          console.log('🔍 Content[0] structure:', Object.keys(data.content[0] || {}));
          
          if (data.content[0].text) {
            console.log('\n📝 Content[0].text:');
            console.log(data.content[0].text);
            
            try {
              const parsed = JSON.parse(data.content[0].text);
              console.log('\n✅ Successfully parsed JSON:');
              console.log(JSON.stringify(parsed, null, 2));
            } catch (parseError) {
              console.log('\n❌ JSON Parse Error:', parseError.message);
              console.log('📝 Raw text that failed to parse:');
              console.log(data.content[0].text);
            }
          } else {
            console.log('\n❌ No text property in content[0]');
          }
        } else {
          console.log('\n❌ No content[0] found');
          console.log('🔍 Content structure:', data.content);
        }
      } else {
        console.log('❌ HTTP Error:', response.status, response.statusText);
        const errorText = await response.text();
        console.log('Error body:', errorText);
      }
    } catch (error) {
      console.log('❌ Request Error:', error.message);
      console.log('Stack:', error.stack);
    }
  }

  async startServer() {
    console.log('🔧 Starting server...');
    
    this.serverProcess = spawn('node', ['dist/index.js'], {
      stdio: 'pipe',
      detached: false
    });

    this.serverProcess.stdout.on('data', (data) => {
      // Silent
    });
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

// Run debugger
const debug = new ProjectCreationDebugger();
debug.debug().catch(console.error);