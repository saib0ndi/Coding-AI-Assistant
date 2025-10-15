#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

const OLLAMA_URL = 'http://10.10.110.25:11434';
const CONCURRENT_USERS = 50;
const MODEL = 'deepseek-coder-v2:236b';

// Simple test prompts
const TEST_PROMPTS = [
  'Explain what a function is in programming',
  'Write a simple hello world in JavaScript',
  'What is the difference between let and const?',
  'How do you create an array in Python?',
  'Explain what REST API means'
];

class OllamaLoadTester {
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

  async checkOllamaHealth() {
    try {
      console.log('🔍 Checking Ollama server...');
      const response = await fetch(`${OLLAMA_URL}/api/tags`, { 
        method: 'GET',
        timeout: 5000 
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Ollama online with ${data.models?.length || 0} models`);
        
        // Check if our model exists
        const hasModel = data.models?.some(m => m.name.includes(MODEL.split(':')[0]));
        console.log(`📦 Model ${MODEL}: ${hasModel ? '✅ Available' : '❌ Not found'}`);
        
        return hasModel;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Ollama health check failed:', error.message);
      return false;
    }
  }

  async simulateUser(userId) {
    const prompt = TEST_PROMPTS[userId % TEST_PROMPTS.length];
    const startTime = performance.now();
    
    try {
      console.log(`👤 User ${userId} starting request...`);
      
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt: prompt,
          stream: false,
          options: {
            num_predict: 100, // Limit response length for faster testing
            temperature: 0.3
          }
        }),
        timeout: 60000 // 60 second timeout
      });

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ User ${userId} completed in ${Math.round(responseTime)}ms`);
        
        this.results.successful++;
        this.results.responseTimes.push(responseTime);
        
        return {
          userId,
          success: true,
          responseTime,
          responseLength: data.response?.length || 0
        };
      } else {
        console.log(`❌ User ${userId} failed: HTTP ${response.status}`);
        this.results.failed++;
        
        return {
          userId,
          success: false,
          responseTime,
          error: `HTTP ${response.status}`
        };
      }
    } catch (error) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        console.log(`⏰ User ${userId} timed out after ${Math.round(responseTime)}ms`);
        this.results.timeouts++;
      } else {
        console.log(`💥 User ${userId} error: ${error.message}`);
        this.results.errors.push(`User ${userId}: ${error.message}`);
        this.results.failed++;
      }
      
      return {
        userId,
        success: false,
        responseTime,
        error: error.message
      };
    } finally {
      this.results.totalRequests++;
    }
  }

  async runTest() {
    console.log(`🚀 Testing Ollama with ${CONCURRENT_USERS} concurrent users`);
    console.log(`🤖 Model: ${MODEL}`);
    console.log('─'.repeat(60));

    this.results.startTime = performance.now();

    // Create all user promises
    const userPromises = [];
    for (let i = 1; i <= CONCURRENT_USERS; i++) {
      userPromises.push(this.simulateUser(i));
      
      // Stagger requests slightly
      if (i < CONCURRENT_USERS) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Wait for all to complete
    const results = await Promise.allSettled(userPromises);
    this.results.endTime = performance.now();

    return results;
  }

  generateReport() {
    const duration = (this.results.endTime - this.results.startTime) / 1000;
    const successRate = (this.results.successful / this.results.totalRequests) * 100;
    
    const times = this.results.responseTimes.sort((a, b) => a - b);
    const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length || 0;
    const medianTime = times[Math.floor(times.length / 2)] || 0;
    const p95Time = times[Math.floor(times.length * 0.95)] || 0;
    const maxTime = Math.max(...times) || 0;
    const minTime = Math.min(...times) || 0;

    console.log('\n' + '='.repeat(60));
    console.log('📊 OLLAMA CAPACITY TEST RESULTS');
    console.log('='.repeat(60));
    
    console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
    console.log(`👥 Users: ${CONCURRENT_USERS}`);
    console.log(`📨 Requests: ${this.results.totalRequests}`);
    console.log(`✅ Successful: ${this.results.successful}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏰ Timeouts: ${this.results.timeouts}`);
    console.log(`📈 Success Rate: ${successRate.toFixed(1)}%`);
    
    if (times.length > 0) {
      console.log('\n⚡ RESPONSE TIMES:');
      console.log(`   Average: ${(avgTime/1000).toFixed(1)}s`);
      console.log(`   Median: ${(medianTime/1000).toFixed(1)}s`);
      console.log(`   95th %: ${(p95Time/1000).toFixed(1)}s`);
      console.log(`   Range: ${(minTime/1000).toFixed(1)}s - ${(maxTime/1000).toFixed(1)}s`);
    }
    
    console.log(`\n🚀 Throughput: ${(this.results.successful / duration).toFixed(2)} req/s`);
    
    // Capacity assessment
    console.log('\n🎯 CAPACITY ASSESSMENT:');
    if (successRate >= 90 && avgTime < 30000) {
      console.log('   ✅ GOOD - Can handle 50 concurrent users');
      console.log('   💡 Estimated capacity: 50-100 users');
    } else if (successRate >= 70 && avgTime < 60000) {
      console.log('   ⚠️  MODERATE - Struggles with 50 users');
      console.log('   💡 Estimated capacity: 20-40 users');
    } else {
      console.log('   ❌ POOR - Cannot handle 50 concurrent users');
      console.log('   💡 Estimated capacity: 5-15 users');
    }

    if (this.results.errors.length > 0) {
      console.log('\n❌ Sample Errors:');
      this.results.errors.slice(0, 5).forEach(error => {
        console.log(`   ${error}`);
      });
    }
  }
}

// Run the test
async function main() {
  const tester = new OllamaLoadTester();
  
  const isHealthy = await tester.checkOllamaHealth();
  if (!isHealthy) {
    console.log('❌ Cannot run test - Ollama server not ready');
    process.exit(1);
  }

  try {
    await tester.runTest();
    tester.generateReport();
  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

main();