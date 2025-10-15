#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

// Only the working server
const WORKING_SERVER = 'http://10.10.110.25:11434';
const MODEL = 'deepseek-coder-v2:236b';

async function testCapacity(users) {
  console.log(`🧪 Testing ${users} concurrent users...`);
  const startTime = performance.now();
  
  const promises = Array.from({length: users}, async (_, i) => {
    const requestStart = performance.now();
    
    try {
      const response = await fetch(`${WORKING_SERVER}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt: `Test ${i}: What is a variable in programming?`,
          stream: false,
          options: { num_predict: 50, temperature: 0.3 }
        }),
        timeout: 60000
      });

      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;

      if (response.ok) {
        return { success: true, responseTime, userId: i };
      } else {
        return { success: false, responseTime, userId: i, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;
      return { success: false, responseTime, userId: i, error: error.message };
    }
  });

  const results = await Promise.allSettled(promises);
  const endTime = performance.now();
  const totalTime = (endTime - startTime) / 1000;

  const successful = results.filter(r => 
    r.status === 'fulfilled' && r.value.success
  ).length;
  
  const responseTimes = results
    .filter(r => r.status === 'fulfilled' && r.value.success)
    .map(r => r.value.responseTime);
  
  const avgResponseTime = responseTimes.length > 0 
    ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length / 1000
    : 0;

  const successRate = (successful / users) * 100;

  console.log(`   ✅ Success: ${successful}/${users} (${successRate.toFixed(1)}%)`);
  console.log(`   ⏱️  Avg Response: ${avgResponseTime.toFixed(1)}s`);
  console.log(`   🕐 Total Time: ${totalTime.toFixed(1)}s`);

  return {
    users,
    successful,
    successRate,
    avgResponseTime,
    totalTime
  };
}

async function main() {
  console.log('🎯 FINAL CAPACITY TEST - AVAILABLE INFRASTRUCTURE');
  console.log(`🖥️  Working Server: ${WORKING_SERVER}`);
  console.log(`🤖 Model: ${MODEL}`);
  console.log('═'.repeat(60));

  const results = [];
  
  // Test increasing user counts
  for (const userCount of [10, 15, 20, 25, 30, 35, 40, 45, 50]) {
    const result = await testCapacity(userCount);
    results.push(result);
    
    // Stop if success rate drops significantly
    if (result.successRate < 80) {
      console.log(`\n🛑 Stopping test - success rate dropped to ${result.successRate.toFixed(1)}%`);
      break;
    }
    
    // Wait between tests
    console.log('   ⏳ Waiting 3 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Generate final report
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FINAL INFRASTRUCTURE CAPACITY REPORT');
  console.log('═'.repeat(60));

  console.log('\n📈 CAPACITY TEST RESULTS:');
  results.forEach(result => {
    const status = result.successRate >= 95 ? '🟢' : 
                   result.successRate >= 80 ? '🟡' : '🔴';
    console.log(`${status} ${result.users} users: ${result.successRate.toFixed(1)}% success, ${result.avgResponseTime.toFixed(1)}s avg`);
  });

  // Find capacity limits
  const excellentResults = results.filter(r => r.successRate >= 95);
  const goodResults = results.filter(r => r.successRate >= 80);
  
  const maxExcellent = excellentResults.length > 0 ? Math.max(...excellentResults.map(r => r.users)) : 0;
  const maxGood = goodResults.length > 0 ? Math.max(...goodResults.map(r => r.users)) : 0;

  console.log('\n🏆 INFRASTRUCTURE CAPACITY:');
  console.log(`   🥇 Excellent (95%+): ${maxExcellent} concurrent users`);
  console.log(`   🥈 Good (80%+): ${maxGood} concurrent users`);
  console.log(`   🖥️  Available Servers: 1 working Ollama server`);
  console.log(`   ⚠️  Server Issues: 10.10.110.24 missing model`);

  console.log('\n💡 CURRENT INFRASTRUCTURE ASSESSMENT:');
  if (maxExcellent >= 40) {
    console.log('   ✅ GOOD: Single server handles 40+ users excellently');
  } else if (maxExcellent >= 25) {
    console.log('   ⚠️  MODERATE: Single server handles 25+ users well');
  } else {
    console.log('   ❌ LIMITED: Infrastructure needs optimization');
  }

  console.log('\n🚀 SCALING RECOMMENDATIONS:');
  console.log(`   📊 Current Capacity: ${maxExcellent} users (1 server)`);
  console.log(`   🔧 Fix 10.10.110.24: Install deepseek-coder-v2:236b model`);
  console.log(`   📈 With 2 servers: ~${maxExcellent * 2} users`);
  console.log(`   🌐 Deploy on HTTP servers: +3 more instances`);
  console.log(`   🎯 Potential Total: ~${maxExcellent * 5} users with all servers`);

  console.log('\n⚡ IMMEDIATE ACTIONS:');
  console.log('   1. Fix model on 10.10.110.24');
  console.log('   2. Deploy Ollama on 10.10.110.21, 10.10.110.22, 10.10.110.26');
  console.log('   3. Setup load balancer');
  console.log(`   4. Expected result: ${maxExcellent * 5} concurrent users`);
}

main();