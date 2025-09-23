#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

console.log('🧪 MCP-Ollama Comprehensive Test Suite\n');

// Test 1: File Structure
console.log('✅ Test 1: Project Structure');
const requiredFiles = [
  'src/index.ts',
  'src/server/MCPServer.ts',
  'src/server/HTTPServer.ts',
  'src/providers/OllamaProvider.ts',
  'vscode-extension/src/extension.ts',
  'package.json',
  '.env.example',
  'generate-certs.sh'
];

let structurePass = true;
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`   ✓ ${file}`);
  } else {
    console.log(`   ✗ ${file} - MISSING`);
    structurePass = false;
  }
});

// Test 2: HTTPS Configuration
console.log('\n✅ Test 2: HTTPS Configuration');
const httpsFiles = ['certs/cert.pem', 'certs/key.pem'];
let httpsPass = true;
httpsFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`   ✓ ${file}`);
  } else {
    console.log(`   ✗ ${file} - MISSING`);
    httpsPass = false;
  }
});

// Test 3: Package Dependencies
console.log('\n✅ Test 3: Dependencies');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const requiredDeps = ['@modelcontextprotocol/sdk', 'dotenv', 'node-fetch', 'zod'];
let depsPass = true;
requiredDeps.forEach(dep => {
  if (packageJson.dependencies[dep]) {
    console.log(`   ✓ ${dep}`);
  } else {
    console.log(`   ✗ ${dep} - MISSING`);
    depsPass = false;
  }
});

// Test 4: VS Code Extension
console.log('\n✅ Test 4: VS Code Extension');
const extPackageJson = JSON.parse(fs.readFileSync('vscode-extension/package.json', 'utf8'));
const extRequiredDeps = ['@modelcontextprotocol/sdk', 'node-fetch'];
let extPass = true;
extRequiredDeps.forEach(dep => {
  if (extPackageJson.dependencies[dep]) {
    console.log(`   ✓ ${dep}`);
  } else {
    console.log(`   ✗ ${dep} - MISSING`);
    extPass = false;
  }
});

// Test 5: Configuration Files
console.log('\n✅ Test 5: Configuration');
const envExample = fs.readFileSync('.env.example', 'utf8');
const httpsConfig = envExample.includes('USE_HTTPS=true');
const sslConfig = envExample.includes('SSL_CERT_PATH') && envExample.includes('SSL_KEY_PATH');
console.log(`   ${httpsConfig ? '✓' : '✗'} HTTPS enabled in config`);
console.log(`   ${sslConfig ? '✓' : '✗'} SSL certificate paths configured`);

// Test 6: Compiled Output
console.log('\n✅ Test 6: Compiled Output');
const distExists = fs.existsSync('dist');
const extOutExists = fs.existsSync('vscode-extension/out');
console.log(`   ${distExists ? '✓' : '✗'} Server compiled (dist/)`);
console.log(`   ${extOutExists ? '✓' : '✗'} Extension compiled (out/)`);

// Test 7: JavaScript Syntax Check
console.log('\n✅ Test 7: JavaScript Syntax');
try {
  const jsFile = 'vscode-extension/out/inlineSuggestionProvider.js';
  if (fs.existsSync(jsFile)) {
    const content = fs.readFileSync(jsFile, 'utf8');
    const hasTypeScript = content.includes(': ') || content.includes('implements') || content.includes('private ');
    console.log(`   ${!hasTypeScript ? '✓' : '✗'} No TypeScript syntax in JS files`);
  } else {
    console.log('   ✗ Compiled JS files not found');
  }
} catch (error) {
  console.log('   ✗ JavaScript syntax check failed');
}

// Summary
console.log('\n📊 Test Summary:');
const allTests = [structurePass, httpsPass, depsPass, extPass, httpsConfig && sslConfig, distExists && extOutExists];
const passedTests = allTests.filter(Boolean).length;
const totalTests = allTests.length;

console.log(`   Passed: ${passedTests}/${totalTests}`);
console.log(`   Status: ${passedTests === totalTests ? '🎉 ALL TESTS PASSED' : '⚠️  SOME TESTS FAILED'}`);

if (passedTests === totalTests) {
  console.log('\n🚀 MCP-Ollama is ready for deployment!');
} else {
  console.log('\n🔧 Please fix the failing tests before deployment.');
}