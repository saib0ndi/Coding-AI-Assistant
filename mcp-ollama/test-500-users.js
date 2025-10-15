#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

const LOAD_BALANCER_URL = 'http://localhost:8080';
const CONCURRENT_USERS = 500;
const BATCH_SIZE = 50; // Process in batches

const TEST_PROMPTS = [
  'Hello world in JavaScript',
  'What is a function?',
  'Explain variables',
  'How to create arrays?',
  'What is REST API?'
];

class MassiveLoadTester {
  constructor() {
    this.results = {
      totalRequests: 0,
      successful: 0,
      failed: 0,
      timeouts: 0,
      responseTimes: [],
      errors: [],
      startTime: 0,
      endTime: 0
    };
  }

  async simulateUser(userId) {
    const prompt = TEST_PROMPTS[userId % TEST_PROMPTS.length];
    const startTime = performance.now();
    
    try {
      const response = await fetch(LOAD_BALANCER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: userId,
          method: 'tools/call',
          params: {
            name: 'chat',
            arguments: { message: prompt }
          }
        }),
        timeout: 90000
      });

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      if (response.ok) {
        this.results.successful++;
        this.results.responseTimes.push(responseTime);
        return { success: true, responseTime, userId };
      } else {
        this.results.failed++;
        return { success: false, responseTime, userId, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        this.results.timeouts++;
      } else {
        this.results.failed++;
        this.results.errors.push(`User ${userId}: ${error.message}`);
      }
      
      return { success: false, responseTime, userId, error: error.message };
    } finally {
      this.results.totalRequests++;
    }
  }

  async runBatchTest(batchStart, batchSize) {
    console.log(`🚀 Processing batch ${Math.floor(batchStart/batchSize) + 1}: Users ${batchStart + 1}-${batchStart + batchSize}`);
    
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      promises.push(this.simulateUser(batchStart + i + 1));
    }
    
    const results = await Promise.allSettled(promises);
    
    const batchSuccessful = results.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;
    
    console.log(`   ✅ Batch completed: ${batchSuccessful}/${batchSize} successful`);
    return results;
  }

  async runMassiveTest() {
    console.log(`🎯 MASSIVE LOAD TEST: ${CONCURRENT_USERS} users`);
    console.log(`📦 Processing in batches of ${BATCH_SIZE}`);
    console.log('═'.repeat(60));

    this.results.startTime = performance.now();

    const allResults = [];
    
    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < CONCURRENT_USERS; i += BATCH_SIZE) {
      const currentBatchSize = Math.min(BATCH_SIZE, CONCURRENT_USERS - i);
      const batchResults = await this.runBatchTest(i, currentBatchSize);
      allResults.push(...batchResults);
      
      // Small delay between batches
      if (i + BATCH_SIZE < CONCURRENT_USERS) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.results.endTime = performance.now();
    return allResults;
  }

  generateMassiveReport() {
    const duration = (this.results.endTime - this.results.startTime) / 1000;
    const successRate = (this.results.successful / this.results.totalRequests) * 100;
    
    const times = this.results.responseTimes.sort((a, b) => a - b);
    const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length || 0;
    const medianTime = times[Math.floor(times.length / 2)] || 0;
    const p95Time = times[Math.floor(times.length * 0.95)] || 0;
    const p99Time = times[Math.floor(times.length * 0.99)] || 0;

    console.log('\n' + '═'.repeat(60));
    console.log('🎯 500-USER LOAD TEST RESULTS');
    console.log('═'.repeat(60));
    
    console.log(`⏱️  Total Duration: ${duration.toFixed(2)}s`);
    console.log(`👥 Target Users: ${CONCURRENT_USERS}`);
    console.log(`📨 Total Requests: ${this.results.totalRequests}`);
    console.log(`✅ Successful: ${this.results.successful}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏰ Timeouts: ${this.results.timeouts}`);
    console.log(`📈 Success Rate: ${successRate.toFixed(1)}%`);
    
    if (times.length > 0) {
      console.log('\n⚡ RESPONSE TIME ANALYSIS:');
      console.log(`   Average: ${(avgTime/1000).toFixed(1)}s`);
      console.log(`   Median: ${(medianTime/1000).toFixed(1)}s`);
      console.log(`   95th Percentile: ${(p95Time/1000).toFixed(1)}s`);
      console.log(`   99th Percentile: ${(p99Time/1000).toFixed(1)}s`);
    }
    
    console.log(`\n🚀 Throughput: ${(this.results.successful / duration).toFixed(2)} req/s`);
    
    // Performance verdict
    console.log('\n🏆 SCALING SUCCESS ASSESSMENT:');
    if (successRate >= 95 && avgTime < 30000) {
      console.log('   ✅ EXCELLENT - Successfully handles 500 users!');
      console.log('   🎯 Ready for production at this scale');
    } else if (successRate >= 80 && avgTime < 60000) {
      console.log('   ⚠️  GOOD - Handles 500 users with acceptable performance');
      console.log('   💡 Consider further optimization');
    } else if (successRate >= 60) {
      console.log('   🔶 MODERATE - Partial success, needs tuning');
      console.log('   🔧 Requires infrastructure improvements');
    } else {
      console.log('   ❌ FAILED - Cannot handle 500 concurrent users');
      console.log('   🚨 Major scaling issues detected');
    }

    if (this.results.errors.length > 0) {
      console.log('\n❌ Error Sample:');
      this.results.errors.slice(0, 5).forEach(error => {
        console.log(`   ${error}`);
      });
    }
  }
}

async function main() {
  console.log('🔍 Checking load balancer health...');
  
  try {
    const healthCheck = await fetch(`${LOAD_BALANCER_URL}/health`, { timeout: 5000 });
    if (!healthCheck.ok) {
      throw new Error('Load balancer not responding');
    }
    console.log('✅ Load balancer is healthy');
  } catch (error) {
    console.error('❌ Load balancer health check failed:', error.message);
    console.log('💡 Make sure to run: docker-compose -f docker-compose.scale.yml up -d');
    process.exit(1);
  }

  const tester = new MassiveLoadTester();
  
  try {
    await tester.runMassiveTest();
    tester.generateMassiveReport();
  } catch (error) {
    console.error('💥 Massive load test failed:', error);
    process.exit(1);
  }
}

main();