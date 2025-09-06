// Test file for MCP Ollama extension
function getUser() {
    return { name: 'Test User' };
}

try {
    const user = getUser();
    if (user && user.name) {
        console.log(user.name);
    }
} catch (error) {
    console.error('Error getting user:', error);
}

function improvedFunction() {
    const x = 1;
    if (x === null) {
        return null;
    }
    return x;
}