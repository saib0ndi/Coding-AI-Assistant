#!/usr/bin/env node

const http = require('http');

async function testSimpleGeneration() {
    console.log('🧪 Testing simple code generation...');
    
    const testData = {
        prompt: "create a simple hello world function in TypeScript",
        language: "typescript"
    };

    const postData = JSON.stringify(testData);
    
    const options = {
        hostname: 'localhost',
        port: 3077,
        path: '/tools/code_generation',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
    };

    return new Promise((resolve, reject) => {
        console.log('📡 Sending request to code_generation...');
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                console.log('📥 Received data...');
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
        console.log('🚀 Testing simple code generation...');
        const result = await testSimpleGeneration();
        
        console.log('\n📊 Generation Result:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.code) {
            console.log('\n🎉 Code generation successful!');
            console.log('📝 Generated Code:');
            console.log('```typescript');
            console.log(result.code);
            console.log('```');
        } else {
            console.log('\n⚠️  Code generation had issues');
        }
        
    } catch (error) {
        console.error('\n💥 Test failed:', error.message);
    }
}

main().catch(console.error);