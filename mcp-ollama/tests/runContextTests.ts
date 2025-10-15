#!/usr/bin/env node

import { ContextualChatTest } from './contextualChatTest';

// Run the tests
const tester = new ContextualChatTest();
tester.runAllTests();

// Show example scenarios
console.log('\n📋 Example Usage Scenarios:');
console.log('\n1. Multi-turn coding assistance');
console.log('2. Debugging with context');
console.log('3. Learning progression tracking');
console.log('4. Technical depth adaptation');

console.log('\n🎯 Key Features Demonstrated:');
console.log('✓ Keyword relevance scoring');
console.log('✓ Recency vs relevance balance');
console.log('✓ Conversation continuity');
console.log('✓ Context pruning and management');
console.log('✓ Technical depth adaptation');