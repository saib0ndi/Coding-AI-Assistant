import fetch from 'node-fetch';
import fs from 'fs';

async function testDirectExecution() {
  console.log('🚀 Testing Direct Execution Agent (Like Amazon Q/Copilot)');
  
  try {
    const response = await fetch('http://localhost:3077/tools/agent_execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'create directory test-direct-execution'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ Agent Response:');
    console.log(JSON.stringify(result, null, 2));
    
    // Verify directory was actually created
    const expectedPath = '/home/sb57213v/test-direct-execution';
    if (fs.existsSync(expectedPath)) {
      console.log('🎯 SUCCESS: Directory created immediately!');
      console.log('📁 Location:', expectedPath);
      
      // Clean up
      fs.rmSync(expectedPath, { recursive: true });
      console.log('🧹 Cleaned up test directory');
    } else {
      console.log('❌ Directory not found at expected path');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testDirectExecution();