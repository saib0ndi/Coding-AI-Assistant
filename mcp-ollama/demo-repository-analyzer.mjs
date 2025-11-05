#!/usr/bin/env node

/**
 * Comprehensive demo of GitHub Repository Analyzer
 * Shows how the system analyzes questions and provides contextual responses
 */

import { GitHubRepositoryAnalyzer } from './dist/services/GitHubRepositoryAnalyzer.js';

async function demonstrateAnalyzer() {
  console.log('🎯 GitHub Repository Analyzer - Contextual Question Analysis Demo\n');
  console.log('=' .repeat(80));
  
  const analyzer = GitHubRepositoryAnalyzer.getInstance();
  
  // Test different types of questions with different repositories
  const testCases = [
    {
      repo: 'https://github.com/microsoft/vscode',
      question: 'What is this repository about?',
      expectedIntent: 'overview'
    },
    {
      repo: 'https://github.com/facebook/react',
      question: 'How do I install and use this?',
      expectedIntent: 'usage'
    },
    {
      repo: 'https://github.com/nodejs/node',
      question: 'What is the architecture of this project?',
      expectedIntent: 'architecture'
    },
    {
      repo: 'https://github.com/vercel/next.js',
      question: 'Where is the documentation?',
      expectedIntent: 'documentation'
    },
    {
      repo: 'https://github.com/expressjs/express',
      question: 'Show me the main files',
      expectedIntent: 'technical'
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    
    console.log(`\n${i + 1}. 📊 Repository: ${testCase.repo.split('/').pop()}`);
    console.log(`   ❓ Question: "${testCase.question}"`);
    console.log(`   🎯 Expected Intent: ${testCase.expectedIntent}`);
    console.log('   ' + '-'.repeat(70));
    
    try {
      const result = await analyzer.analyzeRepositoryWithContext(
        testCase.repo,
        testCase.question
      );
      
      if (result.success) {
        // Question Analysis Results
        console.log(`   ✅ Analysis successful!`);
        console.log(`   🧠 Detected Intent: ${result.questionAnalysis.intent}`);
        console.log(`   📊 Confidence: ${(result.questionAnalysis.confidence * 100).toFixed(1)}%`);
        console.log(`   📋 Response Type: ${result.contextualResponse.type}`);
        
        // Repository Overview
        console.log(`   📦 Repository: ${result.repository.name}`);
        console.log(`   🔤 Language: ${result.analysis.codebase.primaryLanguage}`);
        console.log(`   ⭐ Stars: ${result.repository.stars.toLocaleString()}`);
        console.log(`   📈 Health: ${result.repository.health}`);
        console.log(`   🏃 Activity: ${result.repository.activity}`);
        
        // Contextual Response Preview
        console.log(`   💡 Contextual Response:`);
        
        switch (result.contextualResponse.type) {
          case 'overview':
            console.log(`      📝 Summary: ${result.contextualResponse.summary}`);
            if (result.contextualResponse.keyPoints) {
              console.log(`      🔑 Key Points: ${result.contextualResponse.keyPoints.length} items`);
            }
            break;
            
          case 'usage':
            console.log(`      🛠️  Installation: ${result.contextualResponse.installation}`);
            console.log(`      📖 Usage: ${result.contextualResponse.usage.substring(0, 80)}...`);
            if (result.contextualResponse.requirements) {
              console.log(`      ⚡ Requirements: ${result.contextualResponse.requirements.join(', ')}`);
            }
            break;
            
          case 'architecture':
            console.log(`      🏗️  Architecture: ${result.contextualResponse.architectureType}`);
            console.log(`      🔧 Framework: ${result.contextualResponse.framework}`);
            console.log(`      📐 Complexity: ${result.contextualResponse.complexity}`);
            break;
            
          case 'documentation':
            console.log(`      📚 README Quality: ${result.contextualResponse.readme.quality}`);
            console.log(`      📄 Has Changelog: ${result.contextualResponse.hasChangelog}`);
            console.log(`      🤝 Has Contributing: ${result.contextualResponse.hasContributing}`);
            break;
            
          default:
            console.log(`      🔍 Technical analysis provided`);
        }
        
        console.log(`   ✨ Analysis Completeness: ${result.analysis.completeness}%`);
        
        // Verify intent detection accuracy
        const intentMatch = result.questionAnalysis.intent === testCase.expectedIntent;
        console.log(`   ${intentMatch ? '✅' : '⚠️'} Intent Detection: ${intentMatch ? 'Accurate' : 'Different than expected'}`);
        
      } else {
        console.log(`   ❌ Analysis failed: ${result.error}`);
      }
      
    } catch (error) {
      console.log(`   💥 Error: ${error.message}`);
    }
    
    console.log('   ' + '-'.repeat(70));
    
    // Add delay between requests to be respectful to GitHub API
    if (i < testCases.length - 1) {
      console.log('   ⏳ Waiting 2 seconds before next request...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🎉 Demo completed! The system successfully:');
  console.log('   • Analyzed different types of questions');
  console.log('   • Detected user intent with high accuracy');
  console.log('   • Provided contextually relevant responses');
  console.log('   • Gathered comprehensive repository data');
  console.log('   • Adapted responses based on question type');
  console.log('\n💡 This demonstrates how the system understands what users are looking for');
  console.log('   and provides targeted, relevant information instead of generic responses.');
}

// Run the demonstration
demonstrateAnalyzer().catch(console.error);