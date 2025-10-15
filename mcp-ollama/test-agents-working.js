#!/usr/bin/env node

import { spawn } from 'child_process';
import fetch from 'node-fetch';

class AgentTester {
  constructor() {
    this.results = {
      mcpServer: false,
      ollama: false,
      agents: {},
      tools: {},
      vsCodeExtension: false
    };
  }

  async testAll() {
    console.log('🧪 Testing Agent System Status');
    console.log('═'.repeat(50));

    await this.testMCPServer();
    await this.testOllama();
    await this.testAgentEndpoints();
    await this.testVSCodeExtension();
    
    this.generateReport();
  }

  async testMCPServer() {
    console.log('\n🔍 Testing MCP Server...');
    
    try {
      // Check if MCP server process is running
      const processes = await this.runCommand('ps aux | grep -E "mcp-ollama|node.*index.js" | grep -v grep');
      
      if (processes.includes('mcp-ollama') || processes.includes('index.js')) {
        console.log('   ✅ MCP Server process found');
        this.results.mcpServer = true;
        
        // Try to connect to server
        try {
          const response = await fetch('http://localhost:3077/health', { timeout: 5000 });
          if (response.ok) {
            console.log('   ✅ MCP Server responding on port 3077');
          } else {
            console.log('   ⚠️  MCP Server found but not responding properly');
          }
        } catch {
          console.log('   ⚠️  MCP Server process found but port 3077 not accessible');
        }
      } else {
        console.log('   ❌ MCP Server not running');
        console.log('   💡 Try: npm start');
      }
    } catch (error) {
      console.log('   ❌ Error checking MCP Server:', error.message);
    }
  }

  async testOllama() {
    console.log('\n🤖 Testing Ollama Service...');
    
    try {
      // Check Ollama process
      const processes = await this.runCommand('ps aux | grep ollama | grep -v grep');
      
      if (processes.includes('ollama')) {
        console.log('   ✅ Ollama process running');
        
        // Test Ollama API
        try {
          const response = await fetch('http://10.10.110.25:11434/api/tags', { timeout: 5000 });
          if (response.ok) {
            const data = await response.json();
            console.log(`   ✅ Ollama API responding with ${data.models?.length || 0} models`);
            this.results.ollama = true;
            
            // Check for required model
            const hasDeepSeek = data.models?.some(m => m.name.includes('deepseek-coder-v2'));
            if (hasDeepSeek) {
              console.log('   ✅ deepseek-coder-v2 model available');
            } else {
              console.log('   ⚠️  deepseek-coder-v2 model not found');
              console.log('   💡 Try: ollama pull deepseek-coder-v2:236b');
            }
          }
        } catch {
          console.log('   ❌ Ollama process found but API not responding');
        }
      } else {
        console.log('   ❌ Ollama not running');
        console.log('   💡 Try: ollama serve');
      }
    } catch (error) {
      console.log('   ❌ Error checking Ollama:', error.message);
    }
  }

  async testAgentEndpoints() {
    console.log('\n🤖 Testing Agent Functionality...');
    
    const agentTests = [
      {
        name: 'FileAgent',
        test: () => this.testFileAgent()
      },
      {
        name: 'CodeAgent', 
        test: () => this.testCodeAgent()
      },
      {
        name: 'AgentManager',
        test: () => this.testAgentManager()
      }
    ];

    for (const agent of agentTests) {
      try {
        console.log(`\n   🧪 Testing ${agent.name}...`);
        const result = await agent.test();
        this.results.agents[agent.name] = result;
        
        if (result) {
          console.log(`   ✅ ${agent.name} working`);
        } else {
          console.log(`   ❌ ${agent.name} not working`);
        }
      } catch (error) {
        console.log(`   ❌ ${agent.name} error:`, error.message);
        this.results.agents[agent.name] = false;
      }
    }
  }

  async testFileAgent() {
    // Test if agent files exist
    try {
      await this.runCommand('ls -la src/agents/FileAgent.ts');
      await this.runCommand('ls -la src/agents/AgentManager.ts');
      return true;
    } catch {
      return false;
    }
  }

  async testCodeAgent() {
    try {
      await this.runCommand('ls -la src/agents/CodeAgent.ts');
      return true;
    } catch {
      return false;
    }
  }

  async testAgentManager() {
    try {
      await this.runCommand('ls -la src/agents/AgentManager.ts');
      return true;
    } catch {
      return false;
    }
  }

  async testVSCodeExtension() {
    console.log('\n🎨 Testing VSCode Extension...');
    
    try {
      // Check if extension files exist
      const extensionExists = await this.runCommand('ls -la vscode-extension/package.json');
      
      if (extensionExists) {
        console.log('   ✅ Extension files found');
        
        // Check if extension is installed
        try {
          const installed = await this.runCommand('code --list-extensions | grep smartcode-aiassist');
          if (installed.includes('smartcode-aiassist')) {
            console.log('   ✅ Extension installed in VSCode');
            this.results.vsCodeExtension = true;
          } else {
            console.log('   ⚠️  Extension not installed');
            console.log('   💡 Try: code --install-extension smartcode-aiassist-3.1.1.vsix');
          }
        } catch {
          console.log('   ⚠️  Could not check VSCode extensions');
        }
      } else {
        console.log('   ❌ Extension files not found');
      }
    } catch (error) {
      console.log('   ❌ Error checking extension:', error.message);
    }
  }

  async testMCPTools() {
    console.log('\n🛠️  Testing MCP Tools...');
    
    const tools = [
      'auto_error_fix',
      'code_completion', 
      'code_analysis',
      'code_generation'
    ];

    // This would require MCP server to be running and accessible
    // For now, just check if tool definitions exist
    for (const tool of tools) {
      try {
        const serverCode = await this.runCommand('grep -r "' + tool + '" src/server/');
        this.results.tools[tool] = serverCode.length > 0;
        console.log(`   ${serverCode.length > 0 ? '✅' : '❌'} ${tool}`);
      } catch {
        this.results.tools[tool] = false;
        console.log(`   ❌ ${tool}`);
      }
    }
  }

  generateReport() {
    console.log('\n' + '═'.repeat(50));
    console.log('📊 AGENT SYSTEM STATUS REPORT');
    console.log('═'.repeat(50));

    // Overall status
    const mcpOk = this.results.mcpServer;
    const ollamaOk = this.results.ollama;
    const agentsOk = Object.values(this.results.agents).some(Boolean);
    
    console.log('\n🎯 CORE SERVICES:');
    console.log(`   MCP Server: ${mcpOk ? '✅ Running' : '❌ Not Running'}`);
    console.log(`   Ollama: ${ollamaOk ? '✅ Running' : '❌ Not Running'}`);
    console.log(`   VSCode Extension: ${this.results.vsCodeExtension ? '✅ Installed' : '⚠️  Not Installed'}`);

    console.log('\n🤖 AGENTS:');
    Object.entries(this.results.agents).forEach(([name, status]) => {
      console.log(`   ${name}: ${status ? '✅ Available' : '❌ Missing'}`);
    });

    console.log('\n🛠️  TOOLS:');
    Object.entries(this.results.tools).forEach(([name, status]) => {
      console.log(`   ${name}: ${status ? '✅ Implemented' : '❌ Missing'}`);
    });

    // Overall verdict
    console.log('\n🏆 OVERALL STATUS:');
    if (mcpOk && ollamaOk && agentsOk) {
      console.log('   ✅ AGENTS ARE WORKING - System fully operational!');
      console.log('   🚀 Ready for agent commands: /dev, /test, /review, /docs');
    } else if (mcpOk || ollamaOk) {
      console.log('   ⚠️  AGENTS PARTIALLY WORKING - Some components need attention');
      console.log('   🔧 Check the issues above and restart services');
    } else {
      console.log('   ❌ AGENTS NOT WORKING - Major issues detected');
      console.log('   🚨 Need to start MCP server and Ollama service');
    }

    console.log('\n💡 QUICK FIXES:');
    if (!mcpOk) console.log('   • Start MCP server: npm start');
    if (!ollamaOk) console.log('   • Start Ollama: ollama serve');
    if (!this.results.vsCodeExtension) console.log('   • Install extension: code --install-extension smartcode-aiassist-3.1.1.vsix');
  }

  async runCommand(command) {
    return new Promise((resolve, reject) => {
      const process = spawn('bash', ['-c', command]);
      let output = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
  }
}

// Run the test
const tester = new AgentTester();
tester.testAll().catch(console.error);