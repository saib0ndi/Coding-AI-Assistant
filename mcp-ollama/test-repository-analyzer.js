#!/usr/bin/env node

/**
 * Test the GitHub Repository Analyzer
 */

import { GitHubRepositoryAnalyzer } from './src/services/GitHubRepositoryAnalyzer.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testRepositoryAnalyzer() {
  console.log('🔍 Testing GitHub Repository Analyzer...\n');
  
  const analyzer = GitHubRepositoryAnalyzer.getInstance();
  
  // Test repositories
  const testCases = [
    {
      repo: 'https://github.com/facebook/react',
      question: 'What is this repository about?'
    },
    {
      repo: 'https://github.com/microsoft/vscode',
      question: 'How do I install and use this?'
    },
    {
      repo: 'https://github.com/nodejs/node',
      question: 'What is the architecture of this project?'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📊 Analyzing: ${testCase.repo}`);
    console.log(`❓ Question: ${testCase.question}`);
    console.log('─'.repeat(60));
    
    try {
      const result = await analyzer.analyzeRepositoryWithContext(
        testCase.repo, 
        testCase.question
      );
      
      if (result.success) {
        console.log('✅ Analysis successful!');
        console.log(`📝 Question Intent: ${result.questionAnalysis?.intent}`);
        console.log(`🎯 Confidence: ${result.questionAnalysis?.confidence}`);
        console.log(`📊 Repository: ${result.repository.name}`);
        console.log(`🔤 Primary Language: ${result.analysis.codebase.primaryLanguage}`);
        console.log(`⭐ Stars: ${result.repository.stars}`);
        console.log(`📈 Health: ${result.repository.health}`);
        console.log(`📋 Response Type: ${result.contextualResponse.type}`);
        
        // Show contextual response summary
        if (result.contextualResponse.summary) {
          console.log(`💡 Summary: ${result.contextualResponse.summary}`);
        }
        
        console.log(`✨ Completeness: ${result.analysis.completeness}%`);
      } else {
        console.log('❌ Analysis failed:', result.error);
      }
    } catch (error) {
      console.log('💥 Error:', error.message);
    }
    
    console.log('─'.repeat(60));
  }
  
  console.log('\n🎉 Repository Analyzer test completed!');
}

// Run the test
testRepositoryAnalyzer().catch(console.error);