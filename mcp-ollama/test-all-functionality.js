import { OllamaProvider } from './dist/providers/OllamaProvider.js';

// Mock configuration
const config = {
  host: 'http://localhost:11434',
  model: 'llama2',
  timeout: 30000
};

async function runAllTests() {
  console.log('🧪 Starting comprehensive OllamaProvider tests...\n');
  
  try {
    const provider = new OllamaProvider(config);
    let passedTests = 0;
    let totalTests = 0;

    // Test 1: NER Functionality
    console.log('📝 Test 1: NER (Named Entity Recognition)');
    totalTests++;
    try {
      const text = "John Smith works at Microsoft in Seattle. He met Sarah Johnson at Amazon on January 15th, 2024.";
      const entities = await provider.extractEntities(text);
      
      console.log('Input text:', text);
      console.log('Extracted entities:', entities);
      
      const hasPersons = entities.some(e => e.type === 'PERSON');
      const hasOrgs = entities.some(e => e.type === 'ORGANIZATION');
      const hasLocations = entities.some(e => e.type === 'LOCATION');
      const hasDates = entities.some(e => e.type === 'DATE');
      
      if (hasPersons && hasOrgs && hasLocations && hasDates) {
        console.log('✅ NER test PASSED - All entity types detected\n');
        passedTests++;
      } else {
        console.log('❌ NER test FAILED - Missing entity types\n');
      }
    } catch (error) {
      console.log('❌ NER test FAILED:', error.message, '\n');
    }

    // Test 2: Health Check
    console.log('🏥 Test 2: Health Check');
    totalTests++;
    try {
      const isHealthy = await provider.healthCheck();
      console.log('Health check result:', isHealthy);
      if (typeof isHealthy === 'boolean') {
        console.log('✅ Health check test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Health check test FAILED - Invalid return type\n');
      }
    } catch (error) {
      console.log('❌ Health check test FAILED:', error.message, '\n');
    }

    // Test 3: Get Available Models
    console.log('📋 Test 3: Get Available Models');
    totalTests++;
    try {
      const models = await provider.getAvailableModels();
      console.log('Available models:', models);
      if (Array.isArray(models)) {
        console.log('✅ Get models test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Get models test FAILED - Not an array\n');
      }
    } catch (error) {
      console.log('❌ Get models test FAILED:', error.message, '\n');
    }

    // Test 4: Generate Text
    console.log('💬 Test 4: Generate Text');
    totalTests++;
    try {
      const response = await provider.generateText({
        prompt: 'Say hello in one word',
        model: config.model
      });
      console.log('Generated text:', response);
      if (typeof response === 'string') {
        console.log('✅ Generate text test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Generate text test FAILED - Invalid return type\n');
      }
    } catch (error) {
      console.log('❌ Generate text test FAILED:', error.message, '\n');
    }

    // Test 5: Code Completion
    console.log('🔧 Test 5: Code Completion');
    totalTests++;
    try {
      const request = {
        code: 'function hello() {\n  console.log("',
        language: 'javascript',
        position: { line: 1, character: 15 }
      };
      const completion = await provider.generateCompletion(request);
      console.log('Code completion result:', completion);
      if (completion && completion.suggestions && Array.isArray(completion.suggestions)) {
        console.log('✅ Code completion test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Code completion test FAILED - Invalid structure\n');
      }
    } catch (error) {
      console.log('❌ Code completion test FAILED:', error.message, '\n');
    }

    // Test 6: Code Analysis
    console.log('🔍 Test 6: Code Analysis');
    totalTests++;
    try {
      const request = {
        code: 'const x = 5; const y = 10; const sum = x + y;',
        language: 'javascript',
        analysisType: 'explanation'
      };
      const analysis = await provider.analyzeCode(request);
      console.log('Code analysis result:', analysis);
      if (analysis && analysis.analysis && typeof analysis.confidence === 'number') {
        console.log('✅ Code analysis test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Code analysis test FAILED - Invalid structure\n');
      }
    } catch (error) {
      console.log('❌ Code analysis test FAILED:', error.message, '\n');
    }

    // Test 7: Generate Code
    console.log('⚡ Test 7: Generate Code');
    totalTests++;
    try {
      const code = await provider.generateCode('Create a function that adds two numbers', 'javascript');
      console.log('Generated code:', code);
      if (typeof code === 'string' && code.length > 0) {
        console.log('✅ Generate code test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Generate code test FAILED - Invalid response\n');
      }
    } catch (error) {
      console.log('❌ Generate code test FAILED:', error.message, '\n');
    }

    // Test 8: Explain Code
    console.log('📖 Test 8: Explain Code');
    totalTests++;
    try {
      const explanation = await provider.explainCode('const sum = (a, b) => a + b;', 'javascript');
      console.log('Code explanation:', explanation);
      if (typeof explanation === 'string' && explanation.length > 0) {
        console.log('✅ Explain code test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Explain code test FAILED - Invalid response\n');
      }
    } catch (error) {
      console.log('❌ Explain code test FAILED:', error.message, '\n');
    }

    // Test 9: Error Fixes
    console.log('🔨 Test 9: Generate Error Fixes');
    totalTests++;
    try {
      const request = {
        code: 'const x = 5\nconst y = 10',
        language: 'javascript',
        errorMessage: 'Missing semicolon'
      };
      const errorAnalysis = { type: 'syntax_error' };
      const fixes = await provider.generateErrorFixes(request, errorAnalysis);
      console.log('Error fixes:', fixes);
      if (Array.isArray(fixes)) {
        console.log('✅ Generate error fixes test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Generate error fixes test FAILED - Not an array\n');
      }
    } catch (error) {
      console.log('❌ Generate error fixes test FAILED:', error.message, '\n');
    }

    // Test 10: Quick Fixes
    console.log('⚡ Test 10: Generate Quick Fixes');
    totalTests++;
    try {
      const request = {
        code: 'var x = 5;',
        language: 'javascript',
        issueType: 'style',
        issueDescription: 'Use const instead of var'
      };
      const quickFixes = await provider.generateQuickFixes(request);
      console.log('Quick fixes:', quickFixes);
      if (Array.isArray(quickFixes)) {
        console.log('✅ Generate quick fixes test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Generate quick fixes test FAILED - Not an array\n');
      }
    } catch (error) {
      console.log('❌ Generate quick fixes test FAILED:', error.message, '\n');
    }

    // Test 11: Validate Code Fix
    console.log('✅ Test 11: Validate Code Fix');
    totalTests++;
    try {
      const request = {
        originalCode: 'const x = 5\nconst y = 10',
        fixedCode: 'const x = 5;\nconst y = 10;',
        language: 'javascript',
        originalError: 'Missing semicolon'
      };
      const validation = await provider.validateCodeFix(request);
      console.log('Validation result:', validation);
      if (validation && typeof validation.isValid === 'boolean') {
        console.log('✅ Validate code fix test PASSED\n');
        passedTests++;
      } else {
        console.log('❌ Validate code fix test FAILED - Invalid structure\n');
      }
    } catch (error) {
      console.log('❌ Validate code fix test FAILED:', error.message, '\n');
    }

    // Test 12: Memory Management
    console.log('🧠 Test 12: Memory Management');
    totalTests++;
    try {
      provider.stopResourceMonitoring();
      console.log('Memory management methods executed');
      console.log('✅ Memory management test PASSED\n');
      passedTests++;
    } catch (error) {
      console.log('❌ Memory management test FAILED:', error.message, '\n');
    }

    // Summary
    console.log('📊 TEST SUMMARY');
    console.log('================');
    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
    
    if (passedTests === totalTests) {
      console.log('🎉 ALL TESTS PASSED! OllamaProvider is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Check the logs above for details.');
    }

  } catch (error) {
    console.error('❌ Test suite failed to run:', error);
  }
}

// Run the tests
runAllTests().catch(console.error);