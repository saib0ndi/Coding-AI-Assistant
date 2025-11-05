#!/usr/bin/env node

const http = require('http');

async function testAgentExecution() {
    console.log('🧪 Testing optimized agent execution...');
    
    const testData = {
        description: "create a simple hello world function",
        context: {
            workspacePath: process.cwd(),
            language: "typescript"
        }
    };

    const postData = JSON.stringify(testData);
    
    const options = {
        hostname: 'localhost',
        port: 3077,
        path: '/tools/smart_implement',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    resolve({ raw: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

async function main() {
    try {
        console.log('⏱️  Starting agent test (30s timeout)...');
        const result = await testAgentExecution();
        
        console.log('✅ Agent execution completed!');
        console.log('📊 Result:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('🎉 Agent successfully executed the task!');
        } else {
            console.log('⚠️  Agent execution had issues but completed');
        }
        
    } catch (error) {
        console.error('❌ Agent test failed:', error.message);
        
        // Test fallback to simple code generation
        console.log('🔄 Testing fallback to code generation...');
        try {
            const fallbackOptions = {
                hostname: 'localhost',
                port: 3077,
                path: '/tools/code_generation',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            };
            
            const fallbackData = JSON.stringify({
                prompt: "create a simple hello world function",
                language: "typescript"
            });
            
            const fallbackResult = await new Promise((resolve, reject) => {
                const req = http.request(fallbackOptions, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(JSON.parse(data)));
                });
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Fallback timeout'));
                });
                req.write(fallbackData);
                req.end();
            });
            
            console.log('✅ Fallback code generation works!');
            console.log('📝 Generated:', fallbackResult.code?.substring(0, 200) + '...');
            
        } catch (fallbackError) {
            console.error('❌ Fallback also failed:', fallbackError.message);
        }
    }
}

main().catch(console.error);