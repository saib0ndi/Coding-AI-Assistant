#!/usr/bin/env node

import fetch from 'node-fetch';

const SERVER_RANGE = Array.from({length: 20}, (_, i) => `10.10.110.${i + 20}`);

async function checkServer(ip) {
  const result = {
    ip,
    ping: false,
    ollama: false,
    http: false,
    models: 0,
    specs: null
  };

  try {
    // Check Ollama
    const ollamaResponse = await fetch(`http://${ip}:11434/api/tags`, { timeout: 3000 });
    if (ollamaResponse.ok) {
      result.ollama = true;
      const data = await ollamaResponse.json();
      result.models = data.models?.length || 0;
    }
  } catch {}

  try {
    // Check HTTP
    const httpResponse = await fetch(`http://${ip}:80`, { timeout: 2000 });
    result.http = httpResponse.ok;
  } catch {}

  result.ping = true; // If we got here, ping worked
  return result;
}

async function main() {
  console.log('🔍 Scanning infrastructure...\n');

  const results = await Promise.allSettled(
    SERVER_RANGE.map(ip => checkServer(ip))
  );

  const servers = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(s => s.ping);

  console.log('📊 AVAILABLE INFRASTRUCTURE:');
  console.log('═'.repeat(50));

  const ollamaServers = servers.filter(s => s.ollama);
  const httpServers = servers.filter(s => s.http && !s.ollama);
  const totalServers = servers.length;

  console.log(`🖥️  Total Available Servers: ${totalServers}`);
  console.log(`🤖 Ollama Servers: ${ollamaServers.length}`);
  console.log(`🌐 HTTP Servers: ${httpServers.length}`);

  if (ollamaServers.length > 0) {
    console.log('\n🤖 OLLAMA SERVERS:');
    ollamaServers.forEach(s => {
      console.log(`   ✅ ${s.ip} - ${s.models} models`);
    });
  }

  if (httpServers.length > 0) {
    console.log('\n🌐 AVAILABLE HTTP SERVERS:');
    httpServers.forEach(s => {
      console.log(`   📡 ${s.ip} - Ready for deployment`);
    });
  }

  // Calculate scaling capacity
  console.log('\n🎯 SCALING CAPACITY ANALYSIS:');
  console.log('═'.repeat(50));

  const maxOllamaInstances = Math.min(ollamaServers.length + httpServers.length, 10);
  const maxMcpInstances = Math.min(httpServers.length, 5);
  const estimatedCapacity = maxOllamaInstances * 25; // 25 users per Ollama instance

  console.log(`📈 Max Ollama Instances: ${maxOllamaInstances}`);
  console.log(`🔧 Max MCP Instances: ${maxMcpInstances}`);
  console.log(`👥 Estimated User Capacity: ${estimatedCapacity}`);

  if (estimatedCapacity >= 500) {
    console.log('\n✅ VERDICT: Can scale to 500+ users');
  } else if (estimatedCapacity >= 250) {
    console.log('\n⚠️  VERDICT: Can scale to 250+ users (need more servers for 500)');
  } else if (estimatedCapacity >= 100) {
    console.log('\n🔶 VERDICT: Can scale to 100+ users (limited infrastructure)');
  } else {
    console.log('\n❌ VERDICT: Limited scaling capacity');
  }

  console.log('\n💡 RECOMMENDATIONS:');
  if (httpServers.length >= 3) {
    console.log('   ✅ Sufficient servers for horizontal scaling');
    console.log('   🚀 Deploy Ollama on HTTP servers');
    console.log('   📦 Use Docker Compose scaling');
  } else {
    console.log('   ⚠️  Limited server availability');
    console.log('   💰 Consider cloud scaling or more hardware');
  }
}

main().catch(console.error);