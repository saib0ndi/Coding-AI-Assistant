#!/usr/bin/env node

import { LSPClient } from './dist/lsp/LSPClient.js';
import { VectorStore } from './dist/semantic/VectorStore.js';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Demo LSP functionality
async function demoLSP() {
  log('\n🔍 LSP (Language Server Protocol) DEMONSTRATION', 'bold');
  log('================================================', 'blue');
  
  const lspClient = new LSPClient();
  
  // Test code samples
  const jsCode = `
function calculateTax(income, rate) {
  var result = income * rate;
  console.log("Tax calculated")
  if (result == null) {
    return 0;
  }
  return result;
}

class TaxCalculator {
  constructor(defaultRate) {
    this.rate = defaultRate;
  }
  
  calculate(income) {
    return income * this.rate;
  }
}`;

  const pythonCode = `
def calculate_tax(income, rate):
    result = income * rate
    print "Tax calculated"
    if result == None:
        return 0
    return result

class TaxCalculator:
    def __init__(self, default_rate):
        self.rate = default_rate
        pass
    
    def calculate(self, income):
        return income * self.rate`;

  // 1. Diagnostics (Error Detection)
  log('\n📋 1. DIAGNOSTICS (Error Detection)', 'cyan');
  log('-----------------------------------', 'blue');
  
  const jsDiagnostics = await lspClient.getDiagnostics('test.js', jsCode, 'javascript');
  log(`JavaScript Diagnostics Found: ${jsDiagnostics.length}`, 'yellow');
  
  jsDiagnostics.forEach((diag, i) => {
    log(`  ${i + 1}. Line ${diag.range.start.line + 1}: ${diag.message} (${diag.severity})`, 
        diag.severity === 'error' ? 'red' : 'yellow');
  });
  
  const pyDiagnostics = await lspClient.getDiagnostics('test.py', pythonCode, 'python');
  log(`\nPython Diagnostics Found: ${pyDiagnostics.length}`, 'yellow');
  
  pyDiagnostics.forEach((diag, i) => {
    log(`  ${i + 1}. Line ${diag.range.start.line + 1}: ${diag.message} (${diag.severity})`, 
        diag.severity === 'error' ? 'red' : 'yellow');
  });

  // 2. Symbol Extraction
  log('\n🏷️  2. SYMBOL EXTRACTION', 'cyan');
  log('------------------------', 'blue');
  
  const jsSymbols = await lspClient.getSymbols('test.js', jsCode);
  log(`JavaScript Symbols Found: ${jsSymbols.length}`, 'green');
  
  jsSymbols.forEach((symbol, i) => {
    log(`  ${i + 1}. ${symbol.kind}: ${symbol.name}${symbol.containerName ? ` (in ${symbol.containerName})` : ''}`, 'green');
  });
  
  const pySymbols = await lspClient.getSymbols('test.py', pythonCode);
  log(`\nPython Symbols Found: ${pySymbols.length}`, 'green');
  
  pySymbols.forEach((symbol, i) => {
    log(`  ${i + 1}. ${symbol.kind}: ${symbol.name}${symbol.containerName ? ` (in ${symbol.containerName})` : ''}`, 'green');
  });

  // 3. Code Completions
  log('\n💡 3. CODE COMPLETIONS', 'cyan');
  log('----------------------', 'blue');
  
  const completions = await lspClient.getCompletions('test.js', jsCode, { line: 5, character: 10 }, 'javascript');
  log(`Completions Available: ${completions.length}`, 'green');
  
  completions.slice(0, 5).forEach((comp, i) => {
    log(`  ${i + 1}. ${comp.label} (${comp.kind}) - ${comp.detail}`, 'green');
  });

  // 4. Hover Information
  log('\n🔍 4. HOVER INFORMATION', 'cyan');
  log('----------------------', 'blue');
  
  const hover = await lspClient.getHover('test.js', jsCode, { line: 8, character: 15 });
  if (hover) {
    log(`Hover Info: ${hover.contents.value}`, 'green');
  } else {
    log('No hover information available at this position', 'yellow');
  }
}

// Demo Semantic Search functionality
async function demoSemantic() {
  log('\n🧠 SEMANTIC SEARCH DEMONSTRATION', 'bold');
  log('=================================', 'blue');
  
  const vectorStore = new VectorStore();
  
  // Sample codebase
  const codebase = [
    {
      path: 'utils/math.js',
      content: `
function calculateTax(income, rate) {
  return income * rate;
}

function calculateDiscount(price, percentage) {
  return price * (percentage / 100);
}

class Calculator {
  add(a, b) { return a + b; }
  multiply(a, b) { return a * b; }
}`,
      language: 'javascript'
    },
    {
      path: 'services/user.js', 
      content: `
class UserService {
  constructor(database) {
    this.db = database;
  }
  
  async createUser(userData) {
    return await this.db.insert('users', userData);
  }
  
  async findUser(id) {
    return await this.db.findById('users', id);
  }
}`,
      language: 'javascript'
    },
    {
      path: 'auth/login.py',
      content: `
def authenticate_user(username, password):
    user = find_user_by_username(username)
    if user and verify_password(password, user.password_hash):
        return create_session(user)
    return None

def create_session(user):
    session_token = generate_token()
    store_session(session_token, user.id)
    return session_token`,
      language: 'python'
    }
  ];

  // 1. Index the codebase
  log('\n📚 1. INDEXING CODEBASE', 'cyan');
  log('----------------------', 'blue');
  
  await vectorStore.indexCodebase(codebase);
  log('✅ Codebase indexed successfully', 'green');
  
  // 2. Semantic Search Queries
  log('\n🔍 2. SEMANTIC SEARCH QUERIES', 'cyan');
  log('-----------------------------', 'blue');
  
  const queries = [
    'calculate tax on income',
    'user authentication login',
    'database operations',
    'mathematical calculations',
    'session management'
  ];
  
  for (const query of queries) {
    log(`\nQuery: "${query}"`, 'yellow');
    const results = await vectorStore.search(query, 3);
    
    results.forEach((result, i) => {
      log(`  ${i + 1}. Similarity: ${(result.similarity * 100).toFixed(1)}% - ${result.metadata.filePath}`, 'green');
      log(`     Function: ${result.metadata.functionName || 'N/A'} (${result.metadata.language})`, 'blue');
      log(`     Code: ${result.code.split('\\n')[0].trim()}...`, 'cyan');
    });
  }

  // 3. Find Similar Code
  log('\n🔄 3. FIND SIMILAR CODE', 'cyan');
  log('-----------------------', 'blue');
  
  const testCode = 'function processPayment(amount, method) { return amount * 0.03; }';
  log(`Test Code: ${testCode}`, 'yellow');
  
  const similar = await vectorStore.findSimilar(testCode, 'javascript', 3);
  log(`Similar Code Found: ${similar.length}`, 'green');
  
  similar.forEach((result, i) => {
    log(`  ${i + 1}. Similarity: ${(result.similarity * 100).toFixed(1)}% - ${result.metadata.functionName}`, 'green');
    log(`     ${result.code.split('\\n')[0].trim()}`, 'cyan');
  });

  // 4. Embedding Demonstration
  log('\n🧮 4. EMBEDDING DEMONSTRATION', 'cyan');
  log('-----------------------------', 'blue');
  
  const code1 = 'function add(a, b) { return a + b; }';
  const code2 = 'function sum(x, y) { return x + y; }';
  const code3 = 'function authenticate(user, pass) { return verify(user, pass); }';
  
  const emb1 = await vectorStore.embed(code1, 'javascript');
  const emb2 = await vectorStore.embed(code2, 'javascript');
  const emb3 = await vectorStore.embed(code3, 'javascript');
  
  log(`Code 1: ${code1}`, 'yellow');
  log(`Code 2: ${code2}`, 'yellow');
  log(`Code 3: ${code3}`, 'yellow');
  
  log(`\nEmbedding Dimensions: ${emb1.length}`, 'green');
  log(`Similarity (Code 1 vs Code 2): ${(cosineSimilarity(emb1, emb2) * 100).toFixed(1)}%`, 'green');
  log(`Similarity (Code 1 vs Code 3): ${(cosineSimilarity(emb1, emb3) * 100).toFixed(1)}%`, 'green');
}

// Helper function for cosine similarity
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Integration demonstration
async function demoIntegration() {
  log('\n🔗 LSP + SEMANTIC INTEGRATION', 'bold');
  log('==============================', 'blue');
  
  const lspClient = new LSPClient();
  const vectorStore = new VectorStore();
  
  const code = `
function calculateInterest(principal, rate, time) {
  var interest = principal * rate * time;
  console.log("Interest calculated")
  return interest;
}`;

  // 1. LSP Analysis
  log('\n1. LSP Analysis:', 'cyan');
  const diagnostics = await lspClient.getDiagnostics('demo.js', code, 'javascript');
  const symbols = await lspClient.getSymbols('demo.js', code);
  
  log(`   Diagnostics: ${diagnostics.length} issues found`, 'yellow');
  log(`   Symbols: ${symbols.length} symbols extracted`, 'green');
  
  // 2. Semantic Indexing
  log('\n2. Semantic Indexing:', 'cyan');
  await vectorStore.addCode('demo:calculateInterest', code, {
    language: 'javascript',
    filePath: 'demo.js',
    functionName: 'calculateInterest'
  });
  log('   Code indexed for semantic search', 'green');
  
  // 3. Combined Search
  log('\n3. Combined Search:', 'cyan');
  const searchResults = await vectorStore.search('calculate financial interest', 1);
  log(`   Found ${searchResults.length} semantic matches`, 'green');
  
  if (searchResults.length > 0) {
    log(`   Best match: ${(searchResults[0].similarity * 100).toFixed(1)}% similarity`, 'green');
  }
  
  log('\n✅ LSP and Semantic components working together!', 'green');
}

// Main demo runner
async function runDemo() {
  log('🚀 MCP-OLLAMA LSP & SEMANTIC COMPONENTS DEMO', 'bold');
  log('=============================================', 'blue');
  
  try {
    await demoLSP();
    await demoSemantic();
    await demoIntegration();
    
    log('\n🎉 DEMO COMPLETED SUCCESSFULLY!', 'bold');
    log('================================', 'green');
    log('\n📋 SUMMARY:', 'bold');
    log('• LSP provides real-time diagnostics, symbols, and completions', 'green');
    log('• Semantic search enables intelligent code discovery', 'green');
    log('• Both components integrate seamlessly with the MCP server', 'green');
    log('• VS Code extension uses these for enhanced development experience', 'green');
    
  } catch (error) {
    log(`\n❌ Demo failed: ${error.message}`, 'red');
    console.error(error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo();
}

export { runDemo };