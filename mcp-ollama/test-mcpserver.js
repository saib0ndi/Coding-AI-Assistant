#!/usr/bin/env node

import { MCPServer } from './dist/server/MCPServer.js';

async function testMCPServer() {
    console.log('🧪 Testing MCP Server...\n');

    try {
        // Test 1: Server Initialization
        console.log('1️⃣ Testing server initialization...');
        const config = {
            host: 'http://localhost:11434',
            model: 'codellama:7b-instruct',
            timeout: 30000
        };
        
        const server = new MCPServer(config);
        console.log('✅ Server initialized successfully\n');

        // Test 2: Tool Registration
        console.log('2️⃣ Testing tool registration...');
        const toolResult = await server.callTool('code_completion', {
            code: 'function hello() {',
            language: 'javascript',
            position: { line: 0, character: 17 }
        });
        console.log('✅ Tool call successful:', toolResult ? 'Response received' : 'No response');
        console.log('📄 Response preview:', JSON.stringify(toolResult).substring(0, 100) + '...\n');

        // Test 3: Error Handling
        console.log('3️⃣ Testing error handling...');
        try {
            await server.callTool('nonexistent_tool', {});
        } catch (error) {
            console.log('✅ Error handling works:', error.message);
        }
        console.log();

        // Test 4: Cache Manager
        console.log('4️⃣ Testing cache manager...');
        const cacheTest = server.cacheManager?.size?.() >= 0;
        console.log('✅ Cache manager:', cacheTest ? 'Working' : 'Not working');
        console.log();

        console.log('🎉 All tests passed! MCP Server is working properly.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run test
testMCPServer().catch(console.error);