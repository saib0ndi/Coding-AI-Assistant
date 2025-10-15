#!/usr/bin/env node

/**
 * Test script to verify dynamic GitHub repository fetching
 * Tests multiple repositories to ensure the system works for ANY public repo
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = 'http://localhost:3077';

async function testGitHubIntegration() {
    console.log('🧪 Testing Dynamic GitHub Repository Integration\n');

    // Test repositories - different types to ensure dynamic fetching
    const testRepos = [
        'https://github.com/modelcontextprotocol/typescript-sdk',
        'https://github.com/microsoft/vscode', 
        'https://github.com/facebook/react',
        'https://github.com/nodejs/node',
        'https://github.com/vercel/next.js'
    ];

    for (const repoUrl of testRepos) {
        console.log(`\n📦 Testing: ${repoUrl}`);
        
        try {
            // Test the MCP server's GitHub integration
            const response = await fetch(`${MCP_SERVER_URL}/tools/github_repo_info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl })
            });

            if (!response.ok) {
                console.log(`❌ HTTP Error: ${response.status} ${response.statusText}`);
                continue;
            }

            const result = await response.json();
            
            if (result.success && result.repository) {
                const repo = result.repository;
                console.log(`✅ SUCCESS: ${repo.name}`);
                console.log(`   ⭐ Stars: ${repo.stars}`);
                console.log(`   🍴 Forks: ${repo.forks}`);
                console.log(`   🐛 Issues: ${repo.openIssues}`);
                console.log(`   📝 Description: ${repo.description || 'No description'}`);
                console.log(`   🏷️  Language: ${repo.language || 'Not specified'}`);
                console.log(`   👤 Owner: ${repo.owner.login} (${repo.owner.type})`);
            } else {
                console.log(`❌ FAILED: ${result.error || 'Unknown error'}`);
                console.log(`   Raw response:`, JSON.stringify(result, null, 2));
            }
        } catch (error) {
            console.log(`❌ ERROR: ${error.message}`);
        }
    }

    // Test directory listing for specific path
    console.log(`\n📁 Testing Directory Listing:`);
    console.log(`   Path: /src/client in typescript-sdk`);
    
    try {
        const response = await fetch(`${MCP_SERVER_URL}/tools/github_directory_listing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                repoUrl: 'https://github.com/modelcontextprotocol/typescript-sdk',
                dirPath: 'src/client'
            })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.contents) {
                console.log(`✅ Directory Contents (${result.contents.length} items):`);
                result.contents.forEach(item => {
                    const icon = item.type === 'dir' ? '📁' : '📄';
                    console.log(`   ${icon} ${item.name} (${item.type})`);
                });
            } else {
                console.log(`❌ Directory listing failed: ${result.error}`);
            }
        } else {
            console.log(`❌ HTTP Error: ${response.status}`);
        }
    } catch (error) {
        console.log(`❌ Directory test error: ${error.message}`);
    }

    console.log(`\n🏁 GitHub Integration Test Complete`);
}

// Check if MCP server is running
async function checkServerHealth() {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/health`);
        if (response.ok) {
            console.log('✅ MCP Server is running');
            return true;
        } else {
            console.log('❌ MCP Server health check failed');
            return false;
        }
    } catch (error) {
        console.log('❌ Cannot connect to MCP Server. Please start it with: npm start');
        return false;
    }
}

// Main execution
async function main() {
    console.log('🚀 Dynamic GitHub Repository Integration Test\n');
    
    const serverRunning = await checkServerHealth();
    if (!serverRunning) {
        process.exit(1);
    }

    await testGitHubIntegration();
}

main().catch(console.error);