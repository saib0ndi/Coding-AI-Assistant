#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

const SERVER_URL = 'http://localhost:3077';
const OLLAMA_URL = 'http://10.10.110.25:11434';
const CONCURRENT_USERS = 50;
const REQUESTS_PER_USER = 3;

// Test scenarios
const TEST_SCENARIOS = [
  {
    name: 'Code Completion',
    payload: {
      method: 'tools/call',
      params: {
        name: 'generate_completion',
        arguments: {
          code: 'function calculateSum(a, b) {\n  return ',
          language: 'javascript',
          position: { line: 1, character: 9 }
        }
      }
    }
  },
  {
    name: 'Code Explanation',
    payload: {
      method: 'tools/call',
      params: {
        name: 'explain_code',
        arguments: {
          code: 'const users = await User.findAll({ where: { active: true } });',
          language: 'javascript'
        }
      }
    }
  },
  {
    name: 'Simple Chat',
    payload: {
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'What is a REST API?'
        }
      }
    }
  }
];

class LoadTester {
  constructor() {
    this.results = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      errors: [],
      responseTimes: [],
      startTime: 0,
      endTime: 0
    };
  }

  async checkServerHealth() {
    try {
      console.log('🔍 Checking server health...');
      
      // Check MCP server
      const mcpResponse = await fetch(`${SERVER_URL}/health`, { 
        method: 'GET',
        timeout: 5000 
      });
      console.log(`MCP Server: ${mcpResponse.ok ? '✅ Online' : '❌ Offline'}`);
      
      // Check Ollama server
      const ollamaResponse = await fetch(`${OLLAMA_URL}/api/tags`, { 
        method: 'GET',
        timeout: 5000 
      });
      console.log(`Ollama Server: ${ollamaResponse.ok ? '✅ Online' : '❌ Offline'}`);
      
      if (!mcpResponse.ok || !ollamaResponse.ok) {
        throw new Error('Servers not ready for load testing');
      }
    } catch (error) {
      console.error('❌ Server health check failed:', error.message);
      process.exit(1);
    }
  }

  async simulateUser(userId, scenario) {
    const userResults = {
      userId,
      requests: [],
      totalTime: 0,
      errors: 0
    };

    console.log(`👤 User ${userId} starting with scenario: ${scenario.name}`);

    for (let i = 0; i < REQUESTS_PER_USER; i++) {
      const requestStart = performance.now();
      
      try {
        const response = await fetch(SERVER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `user-${userId}-req-${i}`,
            ...scenario.payload
          }),
          timeout: 60000 // 60 second timeout
        });

        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;

        if (response.ok) {
          const data = await response.json();
          userResults.requests.push({
            requestId: i,
            responseTime,
            success: true,
            status: response.status
          });
          this.results.successfulRequests++;
          this.results.responseTimes.push(responseTime);
        } else {
          userResults.requests.push({
            requestId: i,
            responseTime,
            success: false,
            status: response.status,
            error: `HTTP ${response.status}`
          });
          this.results.failedRequests++;
          userResults.errors++;
        }

        this.results.totalRequests++;

      } catch (error) {
        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;

        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          this.results.timeouts++;
          console.log(`⏰ User ${userId} request ${i} timed out`);
        } else {
          this.results.errors.push(`User ${userId}: ${error.message}`);
          console.log(`❌ User ${userId} request ${i} failed: ${error.message}`);
        }

        userResults.requests.push({
          requestId: i,
          responseTime,
          success: false,
          error: error.message
        });
        userResults.errors++;
        this.results.failedRequests++;
        this.results.totalRequests++;
      }

      // Small delay between requests from same user
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    userResults.totalTime = userResults.requests.reduce((sum, req) => sum + req.responseTime, 0);
    console.log(`✅ User ${userId} completed. Total time: ${Math.round(userResults.totalTime)}ms, Errors: ${userResults.errors}`);
    
    return userResults;
  }

  async runLoadTest() {
    console.log(`🚀 Starting load test with ${CONCURRENT_USERS} concurrent users`);
    console.log(`📊 Each user will make ${REQUESTS_PER_USER} requests`);
    console.log(`📈 Total expected requests: ${CONCURRENT_USERS * REQUESTS_PER_USER}`);
    console.log('─'.repeat(60));

    this.results.startTime = performance.now();

    // Create user simulation promises
    const userPromises = [];
    for (let i = 0; i < CONCURRENT_USERS; i++) {
      const scenario = TEST_SCENARIOS[i % TEST_SCENARIOS.length];
      userPromises.push(this.simulateUser(i + 1, scenario));
      
      // Stagger user start times slightly to simulate real-world conditions
      if (i < CONCURRENT_USERS - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Wait for all users to complete
    const userResults = await Promise.allSettled(userPromises);
    
    this.results.endTime = performance.now();
    
    return userResults;
  }

  generateReport(userResults) {
    const totalDuration = (this.results.endTime - this.results.startTime) / 1000;
    const successRate = (this.results.successfulRequests / this.results.totalRequests) * 100;
    
    const responseTimes = this.results.responseTimes.sort((a, b) => a - b);
    const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const medianResponseTime = responseTimes[Math.floor(responseTimes.length / 2)];
    const p95ResponseTime = responseTimes[Math.floor(responseTimes.length * 0.95)];
    const maxResponseTime = Math.max(...responseTimes);
    const minResponseTime = Math.min(...responseTimes);

    console.log('\n' + '='.repeat(60));
    console.log('📊 LOAD TEST RESULTS');
    console.log('='.repeat(60));
    
    console.log(`⏱️  Total Duration: ${totalDuration.toFixed(2)} seconds`);
    console.log(`👥 Concurrent Users: ${CONCURRENT_USERS}`);
    console.log(`📨 Total Requests: ${this.results.totalRequests}`);
    console.log(`✅ Successful: ${this.results.successfulRequests}`);
    console.log(`❌ Failed: ${this.results.failedRequests}`);
    console.log(`⏰ Timeouts: ${this.results.timeouts}`);
    console.log(`📈 Success Rate: ${successRate.toFixed(2)}%`);
    
    console.log('\n📊 RESPONSE TIME STATISTICS:');
    console.log(`   Average: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`   Median: ${medianResponseTime.toFixed(2)}ms`);
    console.log(`   95th Percentile: ${p95ResponseTime.toFixed(2)}ms`);
    console.log(`   Min: ${minResponseTime.toFixed(2)}ms`);
    console.log(`   Max: ${maxResponseTime.toFixed(2)}ms`);
    
    console.log(`\n🚀 Throughput: ${(this.results.totalRequests / totalDuration).toFixed(2)} requests/second`);
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.results.errors.slice(0, 10).forEach(error => {
        console.log(`   ${error}`);
      });
      if (this.results.errors.length > 10) {
        console.log(`   ... and ${this.results.errors.length - 10} more errors`);
      }
    }

    // Performance assessment
    console.log('\n🎯 PERFORMANCE ASSESSMENT:');
    if (successRate >= 95 && avgResponseTime < 10000) {
      console.log('   ✅ EXCELLENT - System handles 50 users well');
    } else if (successRate >= 80 && avgResponseTime < 30000) {
      console.log('   ⚠️  ACCEPTABLE - System struggles but functional');
    } else {
      console.log('   ❌ POOR - System cannot handle 50 concurrent users');
    }

    console.log('\n💡 RECOMMENDATIONS:');
    if (avgResponseTime > 20000) {
      console.log('   • Response times too high - consider request queuing');
    }
    if (this.results.timeouts > this.results.totalRequests * 0.1) {
      console.log('   • Too many timeouts - increase server timeout limits');
    }
    if (successRate < 90) {
      console.log('   • Low success rate - add error handling and retries');
    }
    if (this.results.failedRequests > 0) {
      console.log('   • Add connection pooling and load balancing');
    }
  }
}

// Run the load test
async function main() {
  const tester = new LoadTester();
  
  try {
    await tester.checkServerHealth();
    const userResults = await tester.runLoadTest();
    tester.generateReport(userResults);
  } catch (error) {
    console.error('💥 Load test failed:', error);
    process.exit(1);
  }
}

main();