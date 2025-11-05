#!/usr/bin/env node

const http = require('http');

async function testServerFallback() {
    const testData = {
        description: "create hello function",
        type: "implement", 
        context: { language: "typescript" }
    };

    const options = {
        hostname: 'localhost',
        port: 3077,
        path: '/tools/agent_execute',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000  // Wait longer to see server-side fallback
    };

    return new Promise((resolve, reject) => {
        console.log('🧪 Testing server-side fallback (30s timeout)...');
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                console.log('📥 Receiving data...');
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    resolve({ raw: data, parseError: e.message });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Client timeout'));
        });
        
        req.write(JSON.stringify(testData));
        req.end();
    });
}

testServerFallback()
    .then(result => {
        console.log('\n📊 Server Response:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.fallback) {
            console.log('\n🔄 Server-side fallback worked!');
            console.log('📝 Generated code:', result.code?.substring(0, 100) + '...');
        } else if (result.success) {
            console.log('\n✅ Agent execution succeeded!');
        } else {
            console.log('\n❌ Both agent and fallback failed');
        }
    })
    .catch(error => {
        console.log('\n💥 Request failed:', error.message);
    });