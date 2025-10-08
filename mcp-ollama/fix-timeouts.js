#!/usr/bin/env node

/**
 * Quick fix for timeout issues
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Applying timeout fixes...\n');

// Fix 1: Update environment variables for better timeouts
const envPath = path.join(__dirname, '.env');
let envContent = '';

if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
} else {
    console.log('Creating .env file...');
}

// Add/update timeout settings
const timeoutSettings = `
# Timeout settings for better performance
OLLAMA_TIMEOUT_MS=120000
COMPLETION_TIMEOUT=120000
DEFAULT_TIMEOUT=120000
ENABLE_MEMORY_MONITORING=false

# Model settings for faster responses
OLLAMA_MODEL=llama3.1:8b-instruct-q4_K_M
OLLAMA_HOST=http://10.10.110.25:11434
`;

// Remove existing timeout settings
envContent = envContent.replace(/OLLAMA_TIMEOUT_MS=.*/g, '');
envContent = envContent.replace(/COMPLETION_TIMEOUT=.*/g, '');
envContent = envContent.replace(/DEFAULT_TIMEOUT=.*/g, '');
envContent = envContent.replace(/ENABLE_MEMORY_MONITORING=.*/g, '');

// Add new settings
envContent += timeoutSettings;

fs.writeFileSync(envPath, envContent);
console.log('✅ Updated .env with better timeout settings');

// Fix 2: Create a simple test endpoint
const testEndpointPath = path.join(__dirname, 'test-simple-request.js');
const testEndpointContent = `#!/usr/bin/env node

/**
 * Test simple request to identify timeout issues
 */

const { OllamaProvider } = require('./dist/src/providers/OllamaProvider.js');

async function testSimpleRequest() {
    console.log('Testing simple Ollama request...');
    
    const config = {
        host: process.env.OLLAMA_HOST || 'http://10.10.110.25:11434',
        model: process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_K_M',
        timeout: 120000
    };
    
    const provider = new OllamaProvider(config);
    
    try {
        console.log('Making simple request...');
        const start = Date.now();
        
        const response = await provider.generateText({
            prompt: 'Say "Hello" in one word:',
            model: config.model
        });
        
        const time = Date.now() - start;
        console.log(\`✅ Success (\${time}ms): "\${response}"\`);
        
    } catch (error) {
        console.log(\`❌ Failed: \${error.message}\`);
        
        if (error.message.includes('timeout')) {
            console.log('\\n🔧 Timeout troubleshooting:');
            console.log('1. Check if Ollama model is loaded: ollama ps');
            console.log('2. Try a smaller model: ollama pull llama3.2:1b');
            console.log('3. Increase timeout in .env file');
        }
    }
}

testSimpleRequest();
`;

fs.writeFileSync(testEndpointPath, testEndpointContent);
fs.chmodSync(testEndpointPath, '755');
console.log('✅ Created simple test script');

console.log('\n📋 Applied fixes:');
console.log('1. ✅ Increased all timeouts to 2 minutes (120000ms)');
console.log('2. ✅ Disabled memory monitoring to reduce background activity');
console.log('3. ✅ Set faster model as default');
console.log('4. ✅ Created test scripts for debugging');

console.log('\n🚀 Next steps:');
console.log('1. Run: node test-ollama-connection.js');
console.log('2. If that works, run: npm run build && node test-simple-request.js');
console.log('3. If still timing out, check Ollama server status: ollama ps');
console.log('4. Try restarting Ollama: ollama serve');

console.log('\n💡 Common timeout causes:');
console.log('- Model not loaded in Ollama (run: ollama pull llama3.1:8b-instruct-q4_K_M)');
console.log('- Ollama server overloaded (restart with: ollama serve)');
console.log('- Network issues (check host: http://10.10.110.25:11434)');
console.log('- Large prompts (keep prompts under 1000 characters)');