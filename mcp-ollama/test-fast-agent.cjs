#!/usr/bin/env node

const http = require('http');

async function testFastAgent() {
    const testData = {
        description: "hello function",
        type: "implement",
        context: { language: "typescript" },
        priority: "high"
    };

    const options = {
        hostname: 'localhost',
        port: 3077,
        path: '/tools/agent_execute',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.write(JSON.stringify(testData));
        req.end();
    });
}

testFastAgent()
    .then(result => {
        console.log('✅ Agent Success:', JSON.stringify(result, null, 2));
    })
    .catch(error => {
        console.log('❌ Agent Failed:', error.message);
        
        // Test fallback
        const fallbackOptions = {
            hostname: 'localhost',
            port: 3077,
            path: '/tools/code_generation',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        };
        
        const fallbackData = JSON.stringify({
            prompt: "create hello function",
            language: "typescript"
        });
        
        const req = http.request(fallbackOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('✅ Fallback Success:', JSON.parse(data).code);
            });
        });
        req.write(fallbackData);
        req.end();
    });