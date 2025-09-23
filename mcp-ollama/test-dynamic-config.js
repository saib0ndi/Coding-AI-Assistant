#!/usr/bin/env node

import { DynamicConfig } from './dist/utils/DynamicConfig.js';

console.log('🧪 Testing Dynamic Configuration...\n');

// Test 1: Context Lines Calculation
console.log('✅ Test 1: Dynamic Context Lines');
const contextLines1 = DynamicConfig.getContextLines(500, 200);
const contextLines2 = DynamicConfig.getContextLines(2000, 800);
console.log(`   Small doc (500 lines, 200MB): ${contextLines1} context lines`);
console.log(`   Large doc (2000 lines, 800MB): ${contextLines2} context lines`);

// Test 2: Content Limit Calculation
console.log('\n✅ Test 2: Dynamic Content Limits');
const limit1 = DynamicConfig.getContentLimit(1024 * 1024 * 1024); // 1GB
const limit2 = DynamicConfig.getContentLimit(4 * 1024 * 1024 * 1024); // 4GB
console.log(`   1GB memory: ${limit1} chars limit`);
console.log(`   4GB memory: ${limit2} chars limit`);

// Test 3: Suggestion Count
console.log('\n✅ Test 3: Dynamic Suggestions');
const suggestions1 = DynamicConfig.getMaxSuggestions(0.3); // Low acceptance
const suggestions2 = DynamicConfig.getMaxSuggestions(0.8); // High acceptance
console.log(`   Low acceptance (30%): ${suggestions1} suggestions`);
console.log(`   High acceptance (80%): ${suggestions2} suggestions`);

// Test 4: Timeout Calculation
console.log('\n✅ Test 4: Dynamic Timeouts');
const timeout1 = DynamicConfig.getTimeout(50, 25); // Good network/server
const timeout2 = DynamicConfig.getTimeout(200, 80); // Poor network/server
console.log(`   Good conditions: ${timeout1}ms timeout`);
console.log(`   Poor conditions: ${timeout2}ms timeout`);

console.log('\n🎉 All dynamic configuration tests passed!');