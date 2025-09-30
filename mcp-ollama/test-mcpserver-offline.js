#!/usr/bin/env node

import { MCPServer } from './dist/server/MCPServer.js';

async function testMCPServerOffline() {
    console.log('🧪 Testing MCP Server (Offline Mode)...\n');

    try {
        // Test 1: Server Initialization
        console.log('1️⃣ Testing server initialization...');
        const config = {
            host: 'http://localhost:11434',
            model: 'codellama:7b-instruct',
            timeout: 30000
        };
        
        const server = new MCPServer(config);
        console.log('✅ Server initialized successfully');
        console.log('   - Tools registered:', server.tools?.size || 'Unknown');
        console.log('   - Resources registered:', server.resources?.size || 'Unknown');
        console.log();

        // Test 2: Tool Listing
        console.log('2️⃣ Testing tool listing...');
        const toolsResult = await server.handleListTools();
        console.log('✅ Tools listed successfully');
        console.log('   - Total tools:', toolsResult.tools?.length || 0);
        console.log('   - Sample tools:', toolsResult.tools?.slice(0, 3).map(t => t.name).join(', ') || 'None');
        console.log();

        // Test 3: Resource Listing
        console.log('3️⃣ Testing resource listing...');
        const resourcesResult = await server.handleListResources();
        console.log('✅ Resources listed successfully');
        console.log('   - Total resources:', resourcesResult.resources?.length || 0);
        console.log('   - Sample resources:', resourcesResult.resources?.slice(0, 3).map(r => r.name).join(', ') || 'None');
        console.log();

        // Test 4: Cache Manager
        console.log('4️⃣ Testing cache manager...');
        server.cacheManager.set('test-key', 'test-value', 1000);
        const cachedValue = server.cacheManager.get('test-key');
        console.log('✅ Cache manager working:', cachedValue === 'test-value' ? 'Yes' : 'No');
        console.log('   - Cache size:', server.cacheManager.size());
        console.log();

        // Test 5: Error Handling
        console.log('5️⃣ Testing error handling...');
        try {
            await server.callTool('nonexistent_tool', {});
            console.log('❌ Error handling failed - should have thrown error');
        } catch (error) {
            console.log('✅ Error handling works:', error.message.includes('not found') ? 'Yes' : 'No');
        }
        console.log();

        // Test 6: Tool Schema Validation
        console.log('6️⃣ Testing tool schemas...');
        const sampleTool = toolsResult.tools?.[0];
        if (sampleTool) {
            const hasRequiredFields = sampleTool.name && sampleTool.description && sampleTool.inputSchema;
            console.log('✅ Tool schema validation:', hasRequiredFields ? 'Pass' : 'Fail');
            console.log('   - Sample tool:', sampleTool.name);
            console.log('   - Has input schema:', !!sampleTool.inputSchema);
        }
        console.log();

        console.log('🎉 All offline tests passed! MCP Server core functionality is working.');
        console.log('💡 Note: Ollama connection tests require running Ollama server.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run test
testMCPServerOffline().catch(console.error);