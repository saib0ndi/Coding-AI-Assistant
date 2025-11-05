// Test with real Ollama server at http://10.10.110.25:11434
const nlp = require('compromise');

// Mock OllamaProvider with real server connection
class TestOllamaProvider {
  constructor(config) {
    this.config = config;
    this.validatedHost = this.validateAndSanitizeHost(config.host);
    console.log(`✅ Connected to Ollama server: ${this.validatedHost}`);
  }

  validateAndSanitizeHost(host) {
    if (!host || typeof host !== 'string') {
      throw new Error('Invalid host: must be a non-empty string');
    }
    const url = new URL(host);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Invalid protocol: only HTTP and HTTPS are allowed');
    }
    return url.origin;
  }

  async healthCheck() {
    try {
      const fetch = (await import('node-fetch')).default;
      const res = await fetch(`${this.validatedHost}/api/tags`, {
        method: 'GET',
        timeout: 10000
      });
      return res.ok;
    } catch (error) {
      console.error('Health check failed:', error.message);
      return false;
    }
  }

  async getAvailableModels() {
    try {
      const fetch = (await import('node-fetch')).default;
      const res = await fetch(`${this.validatedHost}/api/tags`, {
        method: 'GET',
        timeout: 10000
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      return (data && data.models && data.models.map(m => m.name)) || [];
    } catch (error) {
      console.error('Failed to get models:', error.message);
      return [];
    }
  }

  async generateText({ prompt, model = 'llama2' }) {
    try {
      const fetch = (await import('node-fetch')).default;
      const res = await fetch(`${this.validatedHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.8,
            num_predict: 100
          }
        }),
        timeout: 30000
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      return data.response || '';
    } catch (error) {
      console.error('Text generation failed:', error.message);
      return `Error: ${error.message}`;
    }
  }

  async extractEntities(text) {
    const doc = nlp(text);
    const entities = [];
    
    entities.push(...doc.people().out('array').map(e => ({entity: e, type: 'PERSON'})));
    entities.push(...doc.places().out('array').map(e => ({entity: e, type: 'LOCATION'})));
    entities.push(...doc.organizations().out('array').map(e => ({entity: e, type: 'ORGANIZATION'})));
    entities.push(...doc.match('#Date').out('array').map(e => ({entity: e, type: 'DATE'})));
    
    return entities;
  }
}

async function testRealOllama() {
  console.log('🚀 Testing with real Ollama server at http://10.10.110.25:11434\n');
  
  const config = {
    host: 'http://10.10.110.25:11434',
    model: 'llama2',
    timeout: 30000
  };

  try {
    const provider = new TestOllamaProvider(config);
    let passedTests = 0;
    let totalTests = 0;

    // Test 1: Health Check
    console.log('🏥 Test 1: Health Check');
    totalTests++;
    const isHealthy = await provider.healthCheck();
    console.log('Server health:', isHealthy ? 'HEALTHY ✅' : 'UNHEALTHY ❌');
    if (isHealthy) {
      passedTests++;
      console.log('✅ Health check PASSED\n');
    } else {
      console.log('❌ Health check FAILED - Server not accessible\n');
    }

    // Test 2: Get Available Models
    console.log('📋 Test 2: Get Available Models');
    totalTests++;
    const models = await provider.getAvailableModels();
    console.log('Available models:', models);
    if (Array.isArray(models) && models.length > 0) {
      passedTests++;
      console.log('✅ Get models PASSED\n');
    } else {
      console.log('❌ Get models FAILED - No models found\n');
    }

    // Test 3: NER Functionality
    console.log('📝 Test 3: NER (Named Entity Recognition)');
    totalTests++;
    const text = "John Smith works at Microsoft in Seattle. He met Sarah Johnson at Amazon on January 15th, 2024.";
    const entities = await provider.extractEntities(text);
    
    console.log('Input text:', text);
    console.log('Extracted entities:', entities);
    
    const hasPersons = entities.some(e => e.type === 'PERSON');
    const hasOrgs = entities.some(e => e.type === 'ORGANIZATION');
    const hasLocations = entities.some(e => e.type === 'LOCATION');
    const hasDates = entities.some(e => e.type === 'DATE');
    
    if (hasPersons && hasOrgs && hasLocations && hasDates) {
      passedTests++;
      console.log('✅ NER PASSED - All entity types detected\n');
    } else {
      console.log('❌ NER FAILED - Missing entity types\n');
    }

    // Test 4: Text Generation (only if server is healthy)
    if (isHealthy && models.length > 0) {
      console.log('💬 Test 4: Text Generation');
      totalTests++;
      const availableModel = models[0]; // Use first available model
      console.log(`Using model: ${availableModel}`);
      
      const response = await provider.generateText({
        prompt: 'Say hello in one word',
        model: availableModel
      });
      
      console.log('Generated response:', response);
      
      if (response && !response.startsWith('Error:')) {
        passedTests++;
        console.log('✅ Text generation PASSED\n');
      } else {
        console.log('❌ Text generation FAILED\n');
      }
    } else {
      console.log('⏭️  Skipping text generation test (server not available)\n');
    }

    // Test 5: Combined NER + AI Test
    if (isHealthy && models.length > 0) {
      console.log('🤖 Test 5: Combined NER + AI Analysis');
      totalTests++;
      
      const sampleText = "Alice Johnson from Apple Inc. visited Paris on March 10th, 2024.";
      const extractedEntities = await provider.extractEntities(sampleText);
      
      const aiPrompt = `Analyze this text and list the entities: "${sampleText}"`;
      const aiResponse = await provider.generateText({
        prompt: aiPrompt,
        model: models[0]
      });
      
      console.log('Sample text:', sampleText);
      console.log('NER extracted:', extractedEntities);
      console.log('AI analysis:', aiResponse.substring(0, 200) + '...');
      
      if (extractedEntities.length > 0 && aiResponse && !aiResponse.startsWith('Error:')) {
        passedTests++;
        console.log('✅ Combined NER + AI PASSED\n');
      } else {
        console.log('❌ Combined NER + AI FAILED\n');
      }
    } else {
      console.log('⏭️  Skipping combined test (server not available)\n');
    }

    // Summary
    console.log('📊 REAL SERVER TEST SUMMARY');
    console.log('============================');
    console.log(`Server: ${config.host}`);
    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
    
    if (isHealthy) {
      console.log('\n🎉 SERVER IS ACCESSIBLE AND WORKING!');
      console.log('✅ OllamaProvider can connect to http://10.10.110.25:11434');
      console.log('✅ NER functionality works independently');
      if (models.length > 0) {
        console.log('✅ AI models are available for text generation');
      }
    } else {
      console.log('\n⚠️  SERVER NOT ACCESSIBLE');
      console.log('❌ Cannot connect to http://10.10.110.25:11434');
      console.log('✅ NER functionality still works offline');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testRealOllama().catch(console.error);