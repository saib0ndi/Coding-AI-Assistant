import { GitHubService } from './src/services/GitHubService.js';

async function testSmartQuery() {
  const service = GitHubService.getInstance();
  const repoUrl = 'https://github.com/continuedev/continue';
  
  console.log('🧠 Testing Smart GitHub Query');
  console.log('============================\n');
  
  // Test 1: Get specific file
  console.log('Test 1: Get package.json file');
  const result1 = await service.handleSmartQuery(repoUrl, 'get package.json file');
  console.log('Result:', result1.success ? 'SUCCESS' : 'FAILED');
  if (result1.success && result1.file) {
    console.log('File:', result1.file.name, `(${result1.file.size} bytes)`);
  }
  console.log('');
  
  // Test 2: Find file by name
  console.log('Test 2: Find index.ts');
  const result2 = await service.handleSmartQuery(repoUrl, 'find index.ts');
  console.log('Result:', result2.success ? 'SUCCESS' : 'FAILED');
  console.log('');
  
  // Test 3: List directory
  console.log('Test 3: List files in src directory');
  const result3 = await service.handleSmartQuery(repoUrl, 'list files in src directory');
  console.log('Result:', result3.success ? 'SUCCESS' : 'FAILED');
  if (result3.success && result3.contents) {
    console.log('Found', result3.contents.length, 'items');
  }
  console.log('');
  
  // Test 4: Search code
  console.log('Test 4: Search for authentication');
  const result4 = await service.handleSmartQuery(repoUrl, 'search for authentication');
  console.log('Result:', result4.success ? 'SUCCESS' : 'FAILED');
  console.log('');
}

testSmartQuery().catch(console.error);