#!/usr/bin/env node

import http from 'http';

const SERVER_URL = 'http://localhost:3078';

async function makeRequest(toolName, params) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(params);
        
        const options = {
            hostname: 'localhost',
            port: 3078,
            path: `/tools/${toolName}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve(result);
                } catch (e) {
                    resolve(body);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(data);
        req.end();
    });
}

async function testTools() {
    console.log('🧪 Testing MCP-Ollama Extension Tools...\n');

    const testCode = `function calculateSum(a, b) {
    return a + b;
}`;

    const tests = [
        {
            name: 'Code Explanation',
            tool: 'code_explanation',
            params: { code: testCode, language: 'javascript', level: 'detailed' }
        },
        {
            name: 'Generate Tests',
            tool: 'generate_tests',
            params: { code: testCode, language: 'javascript' }
        },
        {
            name: 'Generate Docs',
            tool: 'generate_docs',
            params: { code: testCode, language: 'javascript', style: 'markdown' }
        },
        {
            name: 'Refactor Code',
            tool: 'refactor_code',
            params: { code: testCode, language: 'javascript', focus: 'all' }
        },
        {
            name: 'Chat Assistant',
            tool: 'chat_assistant',
            params: { query: 'who are you' }
        }
    ];

    for (const test of tests) {
        try {
            console.log(`🔧 Testing ${test.name}...`);
            const result = await makeRequest(test.tool, test.params);
            
            if (result && typeof result === 'string' && result.length > 10) {
                console.log(`✅ ${test.name}: SUCCESS`);
                console.log(`   Response: ${result.substring(0, 100)}...`);
            } else if (result && result.error) {
                console.log(`❌ ${test.name}: ERROR - ${result.message || 'Unknown error'}`);
            } else {
                console.log(`⚠️  ${test.name}: UNEXPECTED RESPONSE`);
                console.log(`   Response: ${JSON.stringify(result).substring(0, 100)}...`);
            }
        } catch (error) {
            console.log(`❌ ${test.name}: FAILED - ${error.message}`);
        }
        console.log('');
    }
}

// Check if server is running first
http.get(`${SERVER_URL}/health`, (res) => {
    if (res.statusCode === 200) {
        console.log('✅ MCP Server is running\n');
        testTools().catch(console.error);
    } else {
        console.log('❌ MCP Server is not responding');
    }
}).on('error', () => {
    console.log('❌ MCP Server is not running. Please start it first.');
    console.log('Run: npm start');
});