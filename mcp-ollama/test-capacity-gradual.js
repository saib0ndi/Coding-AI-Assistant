#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

const OLLAMA_URL = 'http://10.10.110.25:11434';
const MODEL = 'deepseek-coder-v2:236b';

const TEST_LEVELS = [5, 10, 15, 20, 25];
const PROMPT = 'Write a simple hello world function in JavaScript';

async function testConcurrentUsers(userCount) {
  console.log(`\n🧪 Testing ${userCount} concurrent users...`);
  
  const results = {
    successful: 0,
    failed: 0,
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
        timeout: 45000
      });

      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;

      if (response.ok) {
        results.successful++;
        results.responseTimes.push(responseTime);
        return { success: true, responseTime, userId: i + 1 };
      } else {
        results.failed++;
        return { success: false, responseTime, userId: i + 1, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;
      results.failed++;
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

  console.log(`   ✅ Success: ${results.successful}/${userCount} (${successRate.toFixed(1)}%)`);
  console.log(`   ⏱️  Avg Response: ${(avgResponseTime/1000).toFixed(1)}s`);
  console.log(`   🕐 Total Time: ${totalTime.toFixed(1)}s`);

  return {
    userCount,
    successRate,
    avgResponseTime: avgResponseTime / 1000,
    totalTime,
    successful: results.successful,
    failed: results.failed
  };
}

async function main() {
  console.log('🔍 Finding Ollama capacity limits...');
  console.log(`🤖 Model: ${MODEL}`);
  console.log('═'.repeat(50));

  const allResults = [];

  for (const userCount of TEST_LEVELS) {
    const result = await testConcurrentUsers(userCount);
    allResults.push(result);

    // Stop if success rate drops below 80%
    if (result.successRate < 80) {
      console.log(`\n⚠️  Success rate dropped to ${result.successRate.toFixed(1)}% - stopping test`);
      break;
    }

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Generate final report
  console.log('\n' + '═'.repeat(60));
  console.log('📊 CAPACITY ANALYSIS RESULTS');
  console.log('═'.repeat(60));

  allResults.forEach(result => {
    const status = result.successRate >= 90 ? '✅' : result.successRate >= 70 ? '⚠️' : '❌';
    console.log(`${status} ${result.userCount} users: ${result.successRate.toFixed(1)}% success, ${result.avgResponseTime.toFixed(1)}s avg`);
  });

  // Find optimal capacity
  const goodResults = allResults.filter(r => r.successRate >= 90);
  const maxCapacity = goodResults.length > 0 ? Math.max(...goodResults.map(r => r.userCount)) : 0;

  console.log('\n🎯 RECOMMENDATIONS:');
  if (maxCapacity >= 20) {
    console.log(`   ✅ Excellent: Can handle ${maxCapacity}+ concurrent users`);
  } else if (maxCapacity >= 10) {
    console.log(`   ⚠️  Moderate: Can handle ${maxCapacity} concurrent users`);
  } else if (maxCapacity >= 5) {
    console.log(`   ❌ Limited: Can only handle ${maxCapacity} concurrent users`);
  } else {
    console.log('   💥 Critical: Cannot handle concurrent users reliably');
  }

  console.log(`\n💡 Optimal concurrent user limit: ${maxCapacity} users`);
}

main().catch(console.error);