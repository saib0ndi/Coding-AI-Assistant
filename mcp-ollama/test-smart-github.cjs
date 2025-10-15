const { spawn } = require('child_process');

async function testSmartGitHubQuery() {
  console.log('🧠 Testing Smart GitHub Query Functionality');
  console.log('==========================================\n');
  
  const testQueries = [
    {
      query: 'get src/index.ts file',
      description: 'Direct file path request'
    },
    {
      query: 'show me the main component',
      description: 'Smart search for main component'
    },
    {
      query: 'find package.json',
      description: 'File name search'
    },
    {
      query: 'search for authentication code',
      description: 'Code content search'
    },
    {
      query: 'list files in src directory',
      description: 'Directory listing'
    }
  ];
  
  console.log('Available test queries:');
  testQueries.forEach((test, index) => {
    console.log(`${index + 1}. "${test.query}" - ${test.description}`);
  });
  
  console.log('\n📝 Example usage in VS Code extension:');
  console.log('User: "Get the index.ts file from https://github.com/continuedev/continue"');
  console.log('System: Uses github_smart_query tool to fetch specific file content');
  
  console.log('\n🔧 Tool capabilities:');
  console.log('✅ Direct file path: "get src/components/App.tsx"');
  console.log('✅ File name search: "find package.json"');
  console.log('✅ Smart search: "show me the main entry point"');
  console.log('✅ Code search: "search for API endpoints"');
  console.log('✅ Directory listing: "list files in src folder"');
  
  console.log('\n🎯 The smart query tool will:');
  console.log('1. Analyze user query using NLP patterns');
  console.log('2. Determine the appropriate GitHub API call');
  console.log('3. Fetch specific file content, not just README');
  console.log('4. Use AI to suggest relevant files for complex queries');
  console.log('5. Provide helpful error messages and suggestions');
}

testSmartGitHubQuery();