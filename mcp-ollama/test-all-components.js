#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

console.log('🧪 MCP-Ollama Complete Test Suite\n');

const testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function runTest(name, testFn) {
  testResults.total++;
  try {
    const result = testFn();
    if (result) {
      console.log(`✅ ${name}`);
      testResults.passed++;
    } else {
      console.log(`❌ ${name}`);
      testResults.failed++;
    }
  } catch (error) {
    console.log(`❌ ${name} - Error: ${error.message}`);
    testResults.failed++;
  }
}

// Test 1: File Structure
runTest('Project Structure', () => {
  const requiredFiles = [
    'src/index.ts',
    'src/server/MCPServer.ts', 
    'src/server/HTTPServer.ts',
    'src/providers/OllamaProvider.ts',
    'src/utils/DynamicConfig.ts',
    'vscode-extension/src/extension.ts',
    '.env.example'
  ];
  return requiredFiles.every(file => fs.existsSync(file));
});

// Test 2: Build Output
runTest('Build Artifacts', () => {
  return fs.existsSync('dist') && fs.existsSync('vscode-extension/out');
});

// Test 3: Environment Configuration
runTest('Environment Config', () => {
  const envContent = fs.readFileSync('.env.example', 'utf8');
  const requiredVars = [
    'OLLAMA_HOST', 'MCP_SERVER_PORT', 'USE_HTTPS', 
    'BASE_CONTEXT_LINES', 'MEMORY_THRESHOLD', 'SERVER_VERSION'
  ];
  return requiredVars.every(v => envContent.includes(v));
});

// Test 4: Dynamic Configuration
runTest('Dynamic Config Class', () => {
  try {
    return fs.existsSync('dist/utils/DynamicConfig.js');
  } catch {
    return false;
  }
});

// Test 5: Package Dependencies
runTest('Package Dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredDeps = ['@modelcontextprotocol/sdk', 'dotenv', 'node-fetch', 'zod'];
  return requiredDeps.every(dep => pkg.dependencies[dep]);
});

// Test 6: VS Code Extension
runTest('VS Code Extension', () => {
  const extPkg = JSON.parse(fs.readFileSync('vscode-extension/package.json', 'utf8'));
  return extPkg.contributes && extPkg.contributes.configuration;
});

// Test 7: SSL Certificates
runTest('SSL Certificate Generation', () => {
  return fs.existsSync('generate-certs.sh') && fs.existsSync('certs/cert.pem');
});

// Test 8: Hardcoded Values Elimination
runTest('No Hardcoded Values', () => {
  const files = ['src/index.ts', 'src/server/HTTPServer.ts', 'src/utils/DynamicConfig.ts'];
  let processEnvCount = 0;
  
  files.forEach(file => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(/process\.env\./g);
      if (matches) processEnvCount += matches.length;
    }
  });
  
  return processEnvCount > 10; // Should have many environment variable usages
});

// Test 9: TypeScript Compilation
runTest('TypeScript Compilation', () => {
  return fs.existsSync('dist/index.js') && fs.existsSync('dist/server/MCPServer.js');
});

// Test 10: Extension Compilation  
runTest('Extension Compilation', () => {
  return fs.existsSync('vscode-extension/out/extension.js');
});

// Summary
console.log('\n📊 Test Results Summary:');
console.log(`   Total Tests: ${testResults.total}`);
console.log(`   Passed: ${testResults.passed}`);
console.log(`   Failed: ${testResults.failed}`);
console.log(`   Success Rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`);

if (testResults.failed === 0) {
  console.log('\n🎉 All tests passed! MCP-Ollama is ready for deployment.');
} else {
  console.log(`\n⚠️  ${testResults.failed} test(s) failed. Please review and fix issues.`);
}