#!/usr/bin/env node

import fetch from 'node-fetch';

const SERVERS = [
  'http://10.10.110.24:11434',
  'http://10.10.110.25:11434'
];

async function testSingleRequest(server) {
  console.log(`🧪 Testing single request to ${server}...`);
  
  try {
    const response = await fetch(`${server}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-coder-v2:236b',
        prompt: 'Hello world',
        stream: false,
        options: { num_predict: 10 }
      }),
      timeout: 30000
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Success: ${data.response?.substring(0, 50)}...`);
      return true;
    } else {
      console.log(`   ❌ Failed: HTTP ${response.status}`);
      const text = await response.text();
      console.log(`   📄 Response: ${text.substring(0, 100)}`);
      return false;
    }
  } catch (error) {
    console.log(`   💥 Error: ${error.message}`);
    return false;
  }
}

async function testConcurrent(server, count) {
  console.log(`\n🚀 Testing ${count} concurrent requests to ${server}...`);
  
  const promises = Array.from({length: count}, async (_, i) => {
    try {
      const response = await fetch(`${server}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-coder-v2:236b',
          prompt: `Test ${i}`,
          stream: false,
          options: { num_predict: 5 }
        }),
        timeout: 45000
      });
      return response.ok ? 'success' : `failed-${response.status}`;
    } catch (error) {
      return `error-${error.message}`;
    }
  });

  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled' && r.value === 'success').length;
  
  console.log(`   📊 Results: ${successful}/${count} successful`);
  
  // Show error details
  const errors = results
    .filter(r => r.status === 'fulfilled' && r.value !== 'success')
    .map(r => r.value)
    .slice(0, 3);
  
  if (errors.length > 0) {
    console.log(`   ❌ Sample errors: ${errors.join(', ')}`);
  }
  
  return successful;
}

async function main() {
  console.log('🔍 DEBUGGING SERVER ISSUES\n');

  // Test each server individually
  for (const server of SERVERS) {
    console.log(`\n🖥️  Testing ${server}:`);
    
    // Single request test
    const singleWorks = await testSingleRequest(server);
    
    if (singleWorks) {
      // Test increasing concurrency
      for (const count of [2, 5, 10]) {
        const successful = await testConcurrent(server, count);
        if (successful === 0) {
          console.log(`   🛑 Server fails at ${count} concurrent requests`);
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // Test the working server (10.10.110.25) more thoroughly
  console.log('\n\n🎯 FOCUSED TEST ON WORKING SERVER (10.10.110.25):');
  
  for (const users of [1, 3, 5, 8, 10, 15, 20, 25]) {
    const successful = await testConcurrent('http://10.10.110.25:11434', users);
    const successRate = (successful / users) * 100;
    
    console.log(`   ${users} users: ${successRate.toFixed(1)}% success`);
    
    if (successRate < 80) {
      console.log(`   🏁 Capacity limit found: ${users} users`);
      break;
    }
    
    await new Promise(r => setTimeout(r, 3000));
  }
}

main();