#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

const OLLAMA_URL = 'http://10.10.110.25:11434';
const MODEL = 'deepseek-coder-v2:236b';

const HIGH_TEST_LEVELS = [30, 35, 40, 45, 50];
const PROMPT = 'Explain what a variable is in programming';

async function testConcurrentUsers(userCount) {
  console.log(`\n🧪 Testing ${userCount} concurrent users...`);
  
  const results = {
    successful: 0,
    failed: 0,
    timeouts: 0,
    responseTimes: []
  };

  const startTime = performance.now();
  
  const promises = Array.from({ length: userCount }, async (_, i) => {
    const requestStart = performance.now();
    
    try {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt: PROMPT,
          stream: false,
          options: { num_predict: 50, temperature: 0.3 }
        }),
        timeout: 60000 // Increased timeout
      });

      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;

      if (response.ok) {
        results.successful++;
        results.responseTimes.push(responseTime);
        console.log(`   ✅ User ${i + 1} completed in ${(responseTime/1000).toFixed(1)}s`);
        return { success: true, responseTime, userId: i + 1 };
      } else {
        results.failed++;
        console.log(`   ❌ User ${i + 1} failed: HTTP ${response.status}`);
        return { success: false, responseTime, userId: i + 1, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;
      
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        results.timeouts++;
        console.log(`   ⏰ User ${i + 1} timed out`);
      } else {
        results.failed++;
        console.log(`   💥 User ${i + 1} error: ${error.message}`);
      }
      
      return { success: false, responseTime, userId: i + 1, error: error.message };
    }
  });

  const userResults = await Promise.allSettled(promises);
  const endTime = performance.now();
  const totalTime = (endTime - startTime) / 1000;

  const successRate = (results.successful / userCount) * 100;
  const avgResponseTime = results.responseTimes.length > 0 
    ? results.responseTimes.reduce((sum, t) => sum + t, 0) / results.responseTimes.length 
    : 0;

  console.log(`\n📊 Results for ${userCount} users:`);
  console.log(`   ✅ Successful: ${results.successful}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   ⏰ Timeouts: ${results.timeouts}`);
  console.log(`   📈 Success Rate: ${successRate.toFixed(1)}%`);
  console.log(`   ⏱️  Avg Response: ${(avgResponseTime/1000).toFixed(1)}s`);
  console.log(`   🕐 Total Time: ${totalTime.toFixed(1)}s`);

  return {
    userCount,
    successRate,
    avgResponseTime: avgResponseTime / 1000,
    totalTime,
    successful: results.successful,
    failed: results.failed,
    timeouts: results.timeouts
  };
}

async function main() {
  console.log('🚀 Testing HIGH capacity limits...');
  console.log(`🤖 Model: ${MODEL}`);
  console.log('═'.repeat(50));

  const allResults = [];

  for (const userCount of HIGH_TEST_LEVELS) {
    const result = await testConcurrentUsers(userCount);
    allResults.push(result);

    // Stop if success rate drops below 50%
    if (result.successRate < 50) {
      console.log(`\n🛑 Success rate dropped to ${result.successRate.toFixed(1)}% - stopping test`);
      break;
    }

    // Wait between tests to let server recover
    console.log('\n⏳ Waiting 5 seconds for server recovery...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Generate final report
  console.log('\n' + '═'.repeat(60));
  console.log('📊 HIGH CAPACITY TEST RESULTS');
  console.log('═'.repeat(60));

  allResults.forEach(result => {
    const status = result.successRate >= 90 ? '✅' : 
                   result.successRate >= 70 ? '⚠️' : 
                   result.successRate >= 50 ? '🔶' : '❌';
    console.log(`${status} ${result.userCount} users: ${result.successRate.toFixed(1)}% success, ${result.avgResponseTime.toFixed(1)}s avg, ${result.timeouts} timeouts`);
  });

  // Find breaking point
  const excellentResults = allResults.filter(r => r.successRate >= 90);
  const goodResults = allResults.filter(r => r.successRate >= 70);
  
  const maxExcellent = excellentResults.length > 0 ? Math.max(...excellentResults.map(r => r.userCount)) : 0;
  const maxGood = goodResults.length > 0 ? Math.max(...goodResults.map(r => r.userCount)) : 0;

  console.log('\n🎯 FINAL CAPACITY ASSESSMENT:');
  console.log(`   🏆 Excellent performance (90%+): Up to ${maxExcellent} users`);
  console.log(`   ⚠️  Acceptable performance (70%+): Up to ${maxGood} users`);
  
  if (maxExcellent >= 40) {
    console.log('\n✅ VERDICT: Server can handle 40+ concurrent users excellently!');
  } else if (maxExcellent >= 30) {
    console.log('\n⚠️  VERDICT: Server can handle 30+ users with good performance');
  } else {
    console.log('\n❌ VERDICT: Server struggles with high concurrent load');
  }
}

main().catch(console.error);