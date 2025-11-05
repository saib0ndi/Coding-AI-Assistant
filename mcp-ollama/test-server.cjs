#!/usr/bin/env node

const express = require('express');
const app = express();
const port = 4850;

app.use(express.json());

// Mock autonomous agent responses
const mockResponses = {
  autonomous_execute: (args) => ({
    taskId: `auto_${Date.now()}`,
    success: true,
    steps: [
      {
        id: 'step_1',
        action: 'Analyzing request',
        success: true,
        result: 'Intent analyzed: file operation'
      },
      {
        id: 'step_2', 
        action: `Executing: ${args.description}`,
        success: true,
        result: 'Task completed successfully'
      }
    ],
    summary: `Autonomous execution completed: ${args.description}`,
    filesModified: args.description.includes('directory') ? 
      [`${args.context?.workspacePath || '.'}/title/`] : 
      [`${args.context?.workspacePath || '.'}/hello.js`],
    executionTime: 2500,
    autonomous: true,
    planningDetails: {
      intent: args.description.includes('directory') ? 'file_operation' : 'implement',
      riskLevel: 'low',
      toolsUsed: ['file'],
      stepsExecuted: 2,
      corrections: 0
    }
  }),

  smart_implement: (args) => ({
    taskId: `auto_${Date.now()}`,
    success: true,
    steps: [
      {
        id: 'step_1',
        action: 'Planning implementation',
        success: true,
        result: `Feature analysis: ${args.feature}`
      },
      {
        id: 'step_2',
        action: 'Creating code structure',
        success: true,
        result: 'Code structure created'
      },
      {
        id: 'step_3',
        action: 'Implementing functionality',
        success: true,
        result: 'Implementation completed'
      }
    ],
    summary: `Smart implementation completed: ${args.feature}`,
    filesModified: [`${args.workspacePath}/calculator.js`],
    executionTime: 4200,
    autonomous: true,
    planningDetails: {
      intent: 'implement',
      riskLevel: 'medium',
      toolsUsed: ['code', 'file'],
      stepsExecuted: 3,
      corrections: 0
    }
  }),

  smart_debug: (args) => ({
    taskId: `auto_${Date.now()}`,
    success: true,
    steps: [
      {
        id: 'step_1',
        action: 'Analyzing issue',
        success: true,
        result: `Issue identified: ${args.issue}`
      },
      {
        id: 'step_2',
        action: 'Generating fix',
        success: true,
        result: 'Fix generated and applied'
      }
    ],
    summary: `Debug completed: ${args.issue}`,
    filesModified: args.filePath ? [args.filePath] : [],
    executionTime: 3100,
    autonomous: true,
    planningDetails: {
      intent: 'fix',
      riskLevel: 'medium',
      toolsUsed: ['code'],
      stepsExecuted: 2,
      corrections: 1
    }
  }),

  autonomous_status: (args) => ({
    activeTasks: [
      {
        id: 'auto_1703123456789',
        description: 'Create calculator function',
        status: 'executing',
        progress: 75,
        currentStep: 'Implementing functionality',
        startTime: Date.now() - 30000
      }
    ],
    stats: {
      totalAutonomousTasks: 5,
      completed: 3,
      failed: 1,
      active: 1,
      successRate: 75
    }
  })
};

// MCP endpoint
app.post('/mcp', (req, res) => {
  console.log('\n🔄 Received request:', JSON.stringify(req.body, null, 2));
  
  const { method, params } = req.body;
  
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    
    console.log(`\n🤖 Executing autonomous tool: ${name}`);
    console.log('📝 Arguments:', JSON.stringify(args, null, 2));
    
    if (mockResponses[name]) {
      const result = mockResponses[name](args);
      
      console.log('✅ Response:', JSON.stringify(result, null, 2));
      
      res.json({
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      });
    } else {
      console.log('❌ Unknown tool:', name);
      res.status(400).json({
        error: `Unknown tool: ${name}`
      });
    }
  } else {
    console.log('❌ Unknown method:', method);
    res.status(400).json({
      error: `Unknown method: ${method}`
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 Mock MCP Server running on http://localhost:${port}`);
  console.log('🤖 Autonomous agents ready for testing!');
  console.log('\n💡 Run tests with port 4850\n');
});