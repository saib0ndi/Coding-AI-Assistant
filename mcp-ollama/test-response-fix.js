#!/usr/bin/env node

// Test script to verify the JSON response wrapping issue is fixed

const { MCPServer } = require('./dist/server/MCPServer.js');

async function testResponseFormat() {
    console.log('Testing MCP Server response format...');
    
    try {
        const config = {
            host: 'http://localhost:11434',
            model: 'llama3.1:8b-instruct-q4_K_M',
            timeout: 30000
        };
        
        const server = new MCPServer(config);
        
        // Test a simple chat request
        const result = await server.callTool('chat_assistant', {
            query: 'who are you'
        });
        
        console.log('Result type:', typeof result);
        console.log('Result:', result);
        
        // Check if result is a clean string or wrapped in JSON
        if (typeof result === 'string') {
            console.log('✅ SUCCESS: Response is a clean string');
            if (result.includes('coding assistant')) {
                console.log('✅ IDENTITY: Correctly identifies as coding assistant');
            } else {
                console.log('⚠️  IDENTITY: May not be identifying as coding assistant');
            }
        } else if (typeof result === 'object' && result.response) {
            console.log('❌ ISSUE: Response is still wrapped in JSON metadata');
            console.log('Response content:', result.response);
        } else {
            console.log('⚠️  UNKNOWN: Unexpected response format');
        }
        
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testResponseFormat();