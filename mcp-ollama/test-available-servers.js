#!/usr/bin/env node

import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

// Available Ollama servers from infrastructure scan
const OLLAMA_SERVERS = [
  'http://10.10.110.24:11434',
  'http://10.10.110.25:11434'
];

const MODEL = 'deepseek-coder-v2:236b';
const TEST_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80];

class MultiServerTester {
  constructor() {
    this.serverStats = new Map();
    this.results = [];
  }

  async testServerCapacity(serverUrl, userCount) {
    console.log(`🧪 Testing ${serverUrl} with ${userCount} users...`);
    
    const results = {
      successful: 0,
      failed: 0,
      responseTimes: []
    };

    const promises = Array.from({ length: userCount }, async (_, i) => {
      const startTime = performance.now();
      
      try {
        const response = await fetch(`${serverUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            prompt: `Simple test ${i}: What is a variable?`,
            stream: false,
            options: { num_predict: 30, temperature: 0.3 }
          }),
          timeout: 45000
        });

        const endTime = performance.now();
        const responseTime = endTime - startTime;

        if (response.ok) {
          results.successful++;
          results.responseTimes.push(responseTime);
          return { success: true, responseTime };
        } else {
          results.failed++;
          return { success: false, error: `HTTP ${response.status}` };
        }
      } catch (error) {
        results.failed++;
        return { success: false, error: error.message };
      }
    });

    await Promise.allSettled(promises);
    
    const successRate = (results.successful / userCount) * 100;
    const avgTime = results.responseTimes.length > 0 
      ? results.responseTimes.reduce((sum, t) => sum + t, 0) / results.responseTimes.length / 1000
      : 0;

    console.log(`   📊 ${results.successful}/${userCount} success (${successRate.toFixed(1)}%) - Avg: ${avgTime.toFixed(1)}s`);
    
    return { successRate, avgTime, successful: results.successful, failed: results.failed };
  }

  async testDistributedLoad(totalUsers) {
    console.log(`\n🌐 Testing DISTRIBUTED load: ${totalUsers} users across ${OLLAMA_SERVERS.length} servers`);
    
    const usersPerServer = Math.floor(totalUsers / OLLAMA_SERVERS.length);
    const remainder = totalUsers % OLLAMA_SERVERS.length;
    
    const serverPromises = OLLAMA_SERVERS.map(async (server, index) => {
      const serverUsers = usersPerServer + (index < remainder ? 1 : 0);
      return {
        server,
        result: await this.testServerCapacity(server, serverUsers)
      };
    });

    const serverResults = await Promise.all(serverPromises);
    
    // Aggregate results
    const totalSuccessful = serverResults.reduce((sum, r) => sum + r.result.successful, 0);
    const totalFailed = serverResults.reduce((sum, r) => sum + r.result.failed, 0);
    const overallSuccessRate = (totalSuccessful / totalUsers) * 100;
    const avgResponseTime = serverResults.reduce((sum, r) => sum + r.result.avgTime, 0) / serverResults.length;

    console.log(`\n📈 DISTRIBUTED RESULTS:`);
    console.log(`   ✅ Total Successful: ${totalSuccessful}/${totalUsers} (${overallSuccessRate.toFixed(1)}%)`);
    console.log(`   ⏱️  Average Response: ${avgResponseTime.toFixed(1)}s`);
    
    return {
      totalUsers,
      successRate: overallSuccessRate,
      avgTime: avgResponseTime,
      serverResults
    };
  }

  async runComprehensiveTest() {
    console.log('🚀 TESTING AVAILABLE INFRASTRUCTURE');
    console.log(`🖥️  Servers: ${OLLAMA_SERVERS.length}`);
    console.log(`🤖 Model: ${MODEL}`);
    console.log('═'.repeat(60));

    // Test individual server limits first
    console.log('\n📊 INDIVIDUAL SERVER TESTING:');
    for (const server of OLLAMA_SERVERS) {
      console.log(`\n🔍 Testing ${server}:`);
      
      for (const users of [10, 20, 25, 30]) {
        const result = await this.testServerCapacity(server, users);
        
        if (result.successRate < 80) {
          console.log(`   ⚠️  Server limit reached at ${users} users`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Test distributed load
    console.log('\n\n🌐 DISTRIBUTED LOAD TESTING:');
    const distributedResults = [];
    
    for (const totalUsers of TEST_LEVELS) {
      const result = await this.testDistributedLoad(totalUsers);
      distributedResults.push(result);
      
      if (result.successRate < 70) {
        console.log(`\n🛑 Stopping at ${totalUsers} users (success rate: ${result.successRate.toFixed(1)}%)`);
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return distributedResults;
  }

  generateFinalReport(distributedResults) {
    console.log('\n' + '═'.repeat(60));
    console.log('🎯 INFRASTRUCTURE CAPACITY REPORT');
    console.log('═'.repeat(60));

    console.log('\n📊 DISTRIBUTED LOAD RESULTS:');
    distributedResults.forEach(result => {
      const status = result.successRate >= 90 ? '✅' : 
                     result.successRate >= 70 ? '⚠️' : '❌';
      console.log(`${status} ${result.totalUsers} users: ${result.successRate.toFixed(1)}% success, ${result.avgTime.toFixed(1)}s avg`);
    });

    // Find capacity limits
    const excellentResults = distributedResults.filter(r => r.successRate >= 90);
    const goodResults = distributedResults.filter(r => r.successRate >= 70);
    
    const maxExcellent = excellentResults.length > 0 ? Math.max(...excellentResults.map(r => r.totalUsers)) : 0;
    const maxGood = goodResults.length > 0 ? Math.max(...goodResults.map(r => r.totalUsers)) : 0;

    console.log('\n🏆 CAPACITY ASSESSMENT:');
    console.log(`   🥇 Excellent Performance (90%+): ${maxExcellent} users`);
    console.log(`   🥈 Good Performance (70%+): ${maxGood} users`);
    console.log(`   🖥️  Infrastructure: ${OLLAMA_SERVERS.length} Ollama servers`);

    console.log('\n💡 RECOMMENDATIONS:');
    if (maxExcellent >= 50) {
      console.log('   ✅ Current infrastructure handles 50+ users well');
      console.log('   🚀 Ready for production deployment');
    } else if (maxExcellent >= 30) {
      console.log('   ⚠️  Can handle 30+ users reliably');
      console.log('   💡 Consider adding more Ollama instances');
    } else {
      console.log('   ❌ Limited capacity with current setup');
      console.log('   🔧 Need infrastructure optimization');
    }

    console.log('\n🎯 SCALING RECOMMENDATIONS:');
    console.log(`   📈 Current Max: ${maxExcellent} concurrent users`);
    console.log(`   🔧 To reach 100 users: Add ${Math.ceil((100 - maxExcellent) / 25)} more Ollama servers`);
    console.log(`   🚀 To reach 500 users: Add ${Math.ceil((500 - maxExcellent) / 25)} more Ollama servers`);
  }
}

async function main() {
  // Check server health first
  console.log('🔍 Checking server health...');
  
  for (const server of OLLAMA_SERVERS) {
    try {
      const response = await fetch(`${server}/api/tags`, { timeout: 5000 });
      console.log(`${response.ok ? '✅' : '❌'} ${server}`);
    } catch (error) {
      console.log(`❌ ${server} - ${error.message}`);
    }
  }

  const tester = new MultiServerTester();
  
  try {
    const results = await tester.runComprehensiveTest();
    tester.generateFinalReport(results);
  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

main();