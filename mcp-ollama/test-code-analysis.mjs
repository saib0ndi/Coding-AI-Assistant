#!/usr/bin/env node

import { GitHubRepositoryAnalyzer } from './dist/services/GitHubRepositoryAnalyzer.js';

async function testCodeAnalysis() {
  console.log('🔍 Testing Enhanced Repository Analyzer with Code Analysis...\n');
  
  const analyzer = GitHubRepositoryAnalyzer.getInstance();
  
  const result = await analyzer.analyzeRepositoryWithContext(
    'https://github.com/expressjs/express',
    'Analyze the code structure of this repository'
  );
  
  if (result.success) {
    console.log('✅ Analysis successful!');
    console.log('📊 Repository:', result.repository.name);
    console.log('🔤 Primary Language:', result.analysis.codebase.primaryLanguage);
    console.log('📐 Code Complexity:', result.analysis.codebase.complexity);
    console.log('⭐ Code Quality:', result.analysis.codebase.codeQuality + '%');
    console.log('🏗️ Architecture:', result.analysis.architecture.type);
    console.log('🔧 Technologies:', result.analysis.architecture.technologies.join(', '));
    console.log('📋 Code Structure:');
    console.log('  • Functions:', result.analysis.codebase.codeStructure.functions.length);
    console.log('  • Classes:', result.analysis.codebase.codeStructure.classes.length);
    console.log('  • Imports:', result.analysis.codebase.codeStructure.imports.length);
    console.log('💡 Code Insights:');
    result.analysis.codebase.insights.forEach(insight => {
      console.log('  •', insight);
    });
    
    console.log('\n🎯 Question Analysis:');
    console.log('  • Intent:', result.questionAnalysis.intent);
    console.log('  • Confidence:', (result.questionAnalysis.confidence * 100).toFixed(1) + '%');
    
  } else {
    console.log('❌ Analysis failed:', result.error);
  }
}

testCodeAnalysis();