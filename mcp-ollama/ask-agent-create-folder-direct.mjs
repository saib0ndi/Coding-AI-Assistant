#!/usr/bin/env node

import fetch from 'node-fetch';

async function askAgentToCreateFolder() {
  console.log('🤖 Asking agent to create a folder named "saishy"...');
  
  try {
    const response = await fetch('http://localhost:3077', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'agent_execute',
          arguments: {
            description: 'Create a directory with the name of saishy',
            type: 'implement',
            context: {
              workspacePath: process.cwd(),
              language: 'filesystem'
            },
            priority: 'high'
          }
        }
      })
    });

    const result = await response.json();
    
    if (result.result) {
      console.log('✅ Agent Response:');
      console.log(JSON.stringify(result.result, null, 2));
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