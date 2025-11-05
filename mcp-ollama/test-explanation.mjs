#!/usr/bin/env node

import { GitHubRepositoryAnalyzer } from './dist/services/GitHubRepositoryAnalyzer.js';

async function testExplanation() {
  console.log('🤖 Testing AI-Powered Repository Explanation...\n');
  
  const analyzer = GitHubRepositoryAnalyzer.getInstance();
  
  const result = await analyzer.analyzeRepositoryWithContext(
    'https://github.com/expressjs/express',
    'Explain what this repository is and how it works'
  );
  
  if (result.success) {
    console.log('✅ Analysis and Explanation successful!\n');
    
    console.log('📊 Repository Overview:');
    console.log('  • Name:', result.repository.name);
    console.log('  • Language:', result.analysis.codebase.primaryLanguage);
    console.log('  • Stars:', result.repository.stars?.toLocaleString());
    console.log('  • Architecture:', result.analysis.architecture.type);
    console.log('  • Complexity:', result.analysis.codebase.complexity);
    console.log('  • Code Quality:', result.analysis.codebase.codeQuality + '%');
    
    console.log('\n🧠 AI-Powered Explanation:');
    console.log('─'.repeat(80));
    console.log(result.aiExplanation);
    console.log('─'.repeat(80));
    
    console.log('\n📋 Contextual Response:');
    console.log('  • Type:', result.contextualResponse.type);
    if (result.contextualResponse.explanation) {
      console.log('  • Rule-based explanation:', result.contextualResponse.explanation);
    }
    
    console.log('\n💡 Code Insights:');
    if (result.analysis.codebase.insights) {
      result.analysis.codebase.insights.forEach(insight => {
        console.log('  •', insight);
      });
    }
    
    console.log('\n🎯 Question Analysis:');
    console.log('  • Intent:', result.questionAnalysis.intent);
    console.log('  • Confidence:', (result.questionAnalysis.confidence * 100).toFixed(1) + '%');
    
  } else {
    console.log('❌ Analysis failed:', result.error);
  }
}

testExplanation();