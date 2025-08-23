// Test MCP auto_error_fix tool
const { spawn } = require('child_process');

const mcpRequest = {
    method: 'tools/call',
    params: {
        name: 'auto_error_fix',
        arguments: {
            errorMessage: "TypeError: Cannot read property 'name' of undefined",
            code: `function getUserInfo(userId) {
    const user = getUser(userId);
    console.log(user.name); // Error: user might be undefined
    return user.email;
}`,
            language: "javascript",
            filePath: "test_error.js",
            lineNumber: 3
        }
    }
};

console.log('Testing MCP auto_error_fix tool...');
console.log('Request:', JSON.stringify(mcpRequest, null, 2));

// Simulate MCP call (your IDE would do this automatically)
const mcp = spawn('node', ['/home/saibondi/Documents/Coding-AI-Assistant/mcp-ollama/dist/index.js']);

mcp.stdin.write(JSON.stringify(mcpRequest) + '\n');

mcp.stdout.on('data', (data) => {
    console.log('MCP Response:', data.toString());
});

mcp.stderr.on('data', (data) => {
    console.log('Error:', data.toString());
});

setTimeout(() => {
    mcp.kill();
}, 10000);