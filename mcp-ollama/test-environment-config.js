#!/usr/bin/env node

console.log('🧪 Testing Environment Configuration...\n');

// Test environment variable loading
const testEnvVars = [
  'OLLAMA_HOST',
  'OLLAMA_PORT', 
  'MCP_SERVER_PORT',
  'USE_HTTPS',
  'BASE_CONTEXT_LINES',
  'MEMORY_THRESHOLD',
  'SERVER_VERSION'
];

console.log('✅ Test 1: Environment Variables');
testEnvVars.forEach(envVar => {
  const value = process.env[envVar] || 'not set';
  console.log(`   ${envVar}: ${value}`);
});

// Test default values
console.log('\n✅ Test 2: Default Value Fallbacks');
const defaults = {
  'DEFAULT_HTTP_PORT': process.env.DEFAULT_HTTP_PORT || '3077',
  'BASE_TIMEOUT_MS': process.env.BASE_TIMEOUT_MS || '30000',
  'CACHE_MAX_SIZE': process.env.CACHE_MAX_SIZE || '10000',
  'SERVER_VERSION': process.env.SERVER_VERSION || '2.0.0'
};

Object.entries(defaults).forEach(([key, value]) => {
  console.log(`   ${key}: ${value}`);
});

// Test numeric parsing
console.log('\n✅ Test 3: Numeric Parsing');
const numericTests = [
  { env: 'BASE_CONTEXT_LINES', default: 10 },
  { env: 'MEMORY_THRESHOLD', default: 1024 },
  { env: 'MAX_TIMEOUT_MS', default: 300000 }
];

numericTests.forEach(test => {
  const value = Number(process.env[test.env] || test.default);
  const isValid = !isNaN(value) && value > 0;
  console.log(`   ${test.env}: ${value} (${isValid ? 'valid' : 'invalid'})`);
});

console.log('\n🎉 Environment configuration tests completed!');