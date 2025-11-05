#!/usr/bin/env node

/**
 * Quick test of GitHub Repository Analyzer
 */

import { GitHubRepositoryAnalyzer } from './dist/services/GitHubRepositoryAnalyzer.js';

async function quickTest() {
  console.log('🚀 Testing GitHub Repository Analyzer...\n');
  
  try {
    const analyzer = GitHubRepositoryAnalyzer.getInstance();
    
    console.log('📊 Analyzing React repository...');
    const result = await analyzer.analyzeRepositoryWithContext(
      'https://github.com/facebook/react',
      'What is this repository about?'
    );
    
    if (result.success) {
      console.log('✅ Analysis successful!\n');
      console.log('📊 Repository:', result.repository.name);
      console.log('📝 Description:', result.repository.description?.substring(0, 80) + '...');
      console.log('❓ Question Intent:', result.questionAnalysis?.intent);
      console.log('🎯 Confidence:', result.questionAnalysis?.confidence);
      console.log('🔤 Primary Language:', result.analysis.codebase.primaryLanguage);
      console.log('⭐ Stars:', result.repository.stars);
      console.log('🍴 Forks:', result.repository.forks);
      console.log('📈 Health:', result.repository.health);
      console.log('🏃 Activity:', result.repository.activity);
      console.log('📋 Response Type:', result.contextualResponse.type);
      console.log('✨ Completeness:', result.analysis.completeness + '%');
      
      if (result.contextualResponse.summary) {
        console.log('\n💡 Contextual Summary:');
        console.log(result.contextualResponse.summary);
      }
      
      if (result.contextualResponse.keyPoints) {
        console.log('\n🔑 Key Points:');
        result.contextualResponse.keyPoints.forEach(point => {
          console.log('  •', point);
        });
      }
      
      console.log('\n🎉 Test completed successfully!');
    } else {
      console.log('❌ Analysis failed:', result.error);
    }
  } catch (error) {
    console.log('💥 Error:', error.message);
    console.log('Stack:', error.stack);
  }
}

quickTest();