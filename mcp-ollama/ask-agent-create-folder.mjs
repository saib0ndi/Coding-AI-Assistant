#!/usr/bin/env node

import fetch from 'node-fetch';

async function askAgentToCreateFolder() {
  console.log('🤖 Asking agent to create a folder...');
  
  try {
    const response = await fetch('http://localhost:3077', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'agent/execute',
        params: {
          message: 'Create a new folder called "agent-test-folder" in the current directory',
          agentMode: true,
          context: {
            workspacePath: process.cwd(),
            task: 'create folder'
          }
        }
      })
    });

    const result = await response.json();
    
    if (result.result) {
      console.log('✅ Agent Response:', result.result);
    } else if (result.error) {
      console.log('❌ Agent Error:', result.error.message);
    } else {
      console.log('📝 Raw Response:', JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.log('❌ Failed to communicate with agent:', error.message);
  }
}

askAgentToCreateFolder();