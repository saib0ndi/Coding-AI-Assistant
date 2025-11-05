# GitHub Repository Analyzer Guide

## Overview

The GitHub Repository Analyzer provides comprehensive repository analysis with contextual question understanding. When you provide a GitHub repository URL, the system:

1. **Analyzes your question** to understand what you're looking for
2. **Fetches complete repository data** (structure, documentation, code, etc.)
3. **Provides contextually relevant responses** based on your specific needs

## Features

### Question Analysis
The system understands different types of questions:
- **Overview**: "What is this repository about?"
- **Architecture**: "What's the technical architecture?"
- **Usage**: "How do I install and use this?"
- **Documentation**: "Where are the docs?"
- **Specific Files**: "Show me the main component"

### Complete Repository Analysis
- Repository metadata (stars, forks, language, etc.)
- Code structure and architecture
- Documentation quality assessment
- Dependency analysis
- Quality scoring
- Activity and health metrics

## Usage Examples

### 1. Basic Repository Analysis
```javascript
import { GitHubRepositoryAnalyzer } from './src/services/GitHubRepositoryAnalyzer.js';

const analyzer = GitHubRepositoryAnalyzer.getInstance();

// Simple analysis without specific question
const result = await analyzer.analyzeRepositoryWithContext(
  'https://github.com/facebook/react'
);

console.log(result.repository.name); // "react"
console.log(result.analysis.codebase.primaryLanguage); // "JavaScript"
```

### 2. Question-Driven Analysis
```javascript
// Ask specific questions to get targeted responses
const questions = [
  "What is this repository about?",
  "How do I install and use this?",
  "What's the architecture of this project?",
  "Where is the documentation?",
  "Show me the main files"
];

for (const question of questions) {
  const result = await analyzer.analyzeRepositoryWithContext(
    'https://github.com/microsoft/vscode',
    question
  );
  
  console.log(`Question: ${question}`);
  console.log(`Intent: ${result.questionAnalysis.intent}`);
  console.log(`Response: ${result.contextualResponse.type}`);
}
```

### 3. Using with MCP Server
```javascript
// Via MCP tool call
const mcpResult = await mcpServer.callTool('github_analyze_repository', {
  repoUrl: 'https://github.com/nodejs/node',
  question: 'What is the architecture of this project?'
});

console.log(mcpResult);
```

## Response Structure

### Question Analysis
```javascript
{
  intent: 'overview' | 'technical' | 'usage' | 'architecture' | 'specific_file' | 'documentation',
  confidence: 0.9,
  requiredData: ['repository', 'readme', 'languages'],
  suggestedResponse: 'Provide comprehensive repository overview'
}
```

### Repository Analysis
```javascript
{
  repository: {
    name: 'react',
    description: 'A declarative, efficient, and flexible JavaScript library...',
    stars: 200000,
    forks: 40000,
    health: 'Excellent',
    activity: 'Very Active',
    popularity: 'Very Popular'
  },
  structure: {
    rootFiles: [{ name: 'package.json', type: 'file' }],
    hasTests: true,
    hasCI: true,
    hasDocs: true
  },
  codebase: {
    primaryLanguage: 'JavaScript',
    languages: [{ name: 'JavaScript', percentage: 85 }],
    complexity: 'High'
  },
  architecture: {
    type: 'Component-based',
    framework: 'React',
    patterns: ['Factory', 'Observer']
  },
  quality: {
    score: 95,
    maintainability: 'High',
    testCoverage: 'Present'
  }
}
```

### Contextual Response Examples

#### Overview Response
```javascript
{
  type: 'overview',
  summary: 'React is a JavaScript project with 200000 stars. A declarative, efficient, and flexible JavaScript library for building user interfaces.',
  keyPoints: [
    'Primary language: JavaScript',
    '40000 forks, 200000 stars',
    'Last updated: 2024-01-15',
    'License: MIT'
  ],
  documentation: 'Well documented'
}
```

#### Architecture Response
```javascript
{
  type: 'architecture',
  architectureType: 'Component-based',
  framework: 'React',
  patterns: ['Factory', 'Observer'],
  complexity: 'High',
  languages: [{ name: 'JavaScript', percentage: 85 }]
}
```

#### Usage Response
```javascript
{
  type: 'usage',
  installation: 'npm install or yarn install',
  usage: 'This is a JavaScript project using React. Check the README for specific usage instructions.',
  examples: ['examples/', 'demo/'],
  requirements: ['Node.js']
}
```

## Integration with VS Code Extension

The analyzer integrates seamlessly with your VS Code extension:

```typescript
// In your VS Code extension
import { MCPServer } from './src/server/MCPServer.js';

const server = new MCPServer(ollamaConfig);

// User asks about a repository
const userQuery = "What is https://github.com/facebook/react about?";

// The system will:
// 1. Extract the GitHub URL
// 2. Analyze the question intent
// 3. Fetch repository data
// 4. Provide contextual response

const result = await server.callTool('github_analyze_repository', {
  repoUrl: 'https://github.com/facebook/react',
  question: 'What is this repository about?'
});
```

## Advanced Features

### Caching
The analyzer caches repository analysis results to improve performance:
- Analysis results are cached per repository
- Cache invalidation based on repository updates
- Efficient memory management

### Error Handling
Robust error handling for:
- Invalid repository URLs
- API rate limits
- Network failures
- Missing repository data

### Performance Optimization
- Parallel data fetching
- Selective data loading based on question intent
- Efficient data structures
- Memory-conscious caching

## Testing

Run the test script to verify functionality:

```bash
node test-repository-analyzer.js
```

This will test the analyzer with various repositories and question types.

## Configuration

### GitHub Token (Optional)
Set `GITHUB_TOKEN` environment variable for higher API rate limits:

```bash
export GITHUB_TOKEN=your_github_token_here
```

### Cache Configuration
The analyzer uses intelligent caching. No additional configuration needed.

## Best Practices

1. **Ask Specific Questions**: More specific questions yield better targeted responses
2. **Use Popular Repositories**: Well-maintained repositories provide richer analysis
3. **Handle Errors Gracefully**: Always check the `success` field in responses
4. **Cache Results**: The system caches automatically, but consider your own caching for UI

## Troubleshooting

### Common Issues

1. **Rate Limiting**: Use GitHub token for higher limits
2. **Repository Not Found**: Verify the URL is correct and repository is public
3. **Incomplete Analysis**: Some repositories may have limited public data

### Debug Mode
Enable debug logging:
```javascript
console.log('[DEBUG] Analysis result:', JSON.stringify(result, null, 2));
```

## Future Enhancements

- Support for private repositories
- Integration with GitHub GraphQL API
- Advanced code analysis using AST parsing
- Machine learning-based question understanding
- Real-time repository monitoring