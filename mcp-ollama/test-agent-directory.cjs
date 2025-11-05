#!/usr/bin/env node

const http = require('http');

async function askAgentCreateDirectory() {
    console.log('🤖 Asking agent to create a directory...');
    
    const testData = {
        description: "create a new directory called 'my-project' with basic folder structure",
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
        port: 3082,
        path: '/tools/agent_execute',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
    };

    return new Promise((resolve, reject) => {
        console.log('📡 Sending request to agent...');
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                console.log('📥 Receiving response...');
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
        console.log('🚀 Testing agent directory creation...');
        const result = await askAgentCreateDirectory();
        
        console.log('\n📊 Agent Response:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n🎉 Agent execution successful!');
            if (result.code) {
                console.log('📝 Generated Code:');
                console.log('```');
                console.log(result.code);
                console.log('```');
            }
            if (result.summary) {
                console.log('📋 Summary:', result.summary);
            }
        } else {
            console.log('\n⚠️  Agent execution had issues');
            if (result.error) {
                console.log('❌ Error:', result.error);
            }
        }
        
    } catch (error) {
        console.error('\n💥 Test failed:', error.message);
    }
}

main().catch(console.error);