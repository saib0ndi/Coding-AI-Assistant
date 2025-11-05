#!/usr/bin/env node

const http = require('http');

async function testAgentDirect() {
    console.log('🧪 Testing agent_execute endpoint directly...');
    
    const testData = {
        description: "create a simple hello world function",
        type: "implement",
        context: {
            workspacePath: process.cwd(),
            language: "typescript"
        },
        priority: "high"
    };

    const postData = JSON.stringify(testData);
    
    const options = {
        hostname: 'localhost',
        port: 3077,
        path: '/tools/agent_execute',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 60000
    };

    return new Promise((resolve, reject) => {
        console.log('📡 Sending request to agent_execute...');
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                console.log('📥 Received chunk:', chunk.toString().substring(0, 100) + '...');
            });
            res.on('end', () => {
                console.log('✅ Request completed');
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    resolve({ raw: data, parseError: e.message });
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request error:', error.message);
            reject(error);
        });
        
        req.on('timeout', () => {
            console.error('⏰ Request timeout');
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

async function main() {
    try {
        console.log('🚀 Starting direct agent test...');
        const result = await testAgentDirect();
        
        console.log('\n📊 Agent Result:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n🎉 Agent execution successful!');
            if (result.summary) {
                console.log('📝 Summary:', result.summary);
            }
            if (result.filesModified && result.filesModified.length > 0) {
                console.log('📁 Files modified:', result.filesModified.join(', '));
            }
        } else {
            console.log('\n⚠️  Agent execution completed with issues');
            if (result.error) {
                console.log('❌ Error:', result.error);
            }
        }
        
    } catch (error) {
        console.error('\n💥 Test failed:', error.message);
    }
}

main().catch(console.error);