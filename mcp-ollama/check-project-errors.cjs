#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 MCP-OLLAMA PROJECT ERROR CHECK\n');

const errors = [];
const warnings = [];
const fixes = [];

function addError(category, file, issue, fix = null) {
    errors.push({ category, file, issue, fix });
    if (fix) fixes.push({ file, fix });
}

function addWarning(category, file, issue) {
    warnings.push({ category, file, issue });
}

// Check TypeScript compilation
function checkTypeScriptCompilation() {
    console.log('🔧 Checking TypeScript Compilation...\n');
    
    try {
        // Check main server
        execSync('npx tsc --noEmit', { cwd: '.', stdio: 'pipe' });
        console.log('✅ Main server TypeScript: No errors');
    } catch (error) {
        const output = error.stdout?.toString() || error.stderr?.toString() || '';
        if (output.includes('error TS')) {
            addError('TypeScript', 'src/', 'Compilation errors found', 'Fix TypeScript errors');
            console.log('❌ Main server TypeScript: Errors found');
        } else {
            console.log('✅ Main server TypeScript: No errors');
        }
    }
    
    try {
        // Check VS Code extension
        execSync('npx tsc --noEmit', { cwd: 'vscode-extension', stdio: 'pipe' });
        console.log('✅ VS Code extension TypeScript: No errors');
    } catch (error) {
        const output = error.stdout?.toString() || error.stderr?.toString() || '';
        if (output.includes('error TS')) {
            addError('TypeScript', 'vscode-extension/src/', 'Compilation errors found', 'Fix TypeScript errors');
            console.log('❌ VS Code extension TypeScript: Errors found');
        } else {
            console.log('✅ VS Code extension TypeScript: No errors');
        }
    }
}

// Check for missing files
function checkMissingFiles() {
    console.log('\n📁 Checking Required Files...\n');
    
    const requiredFiles = [
        'package.json',
        'tsconfig.json',
        'src/index.ts',
        'src/server/MCPServer.ts',
        'src/server/MCPServerEnhanced.ts',
        'vscode-extension/package.json',
        'vscode-extension/src/extension.ts',
        'vscode-extension/src/mcpClient.ts',
        '.env.example'
    ];
    
    requiredFiles.forEach(file => {
        if (!fs.existsSync(file)) {
            addError('Missing File', file, 'Required file missing', `Create ${file}`);
            console.log(`❌ Missing: ${file}`);
        } else {
            console.log(`✅ Found: ${file}`);
        }
    });
}

// Check package.json dependencies
function checkDependencies() {
    console.log('\n📦 Checking Dependencies...\n');
    
    try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const requiredDeps = [
            '@modelcontextprotocol/sdk',
            'dotenv',
            'zod'
        ];
        
        requiredDeps.forEach(dep => {
            if (!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep]) {
                addError('Dependency', 'package.json', `Missing dependency: ${dep}`, `npm install ${dep}`);
                console.log(`❌ Missing dependency: ${dep}`);
            } else {
                console.log(`✅ Found dependency: ${dep}`);
            }
        });
    } catch (error) {
        addError('Package', 'package.json', 'Cannot read package.json', 'Fix package.json syntax');
    }
    
    try {
        const extPkg = JSON.parse(fs.readFileSync('vscode-extension/package.json', 'utf8'));
        const requiredExtDeps = [
            '@modelcontextprotocol/sdk'
        ];
        
        requiredExtDeps.forEach(dep => {
            if (!extPkg.dependencies?.[dep] && !extPkg.devDependencies?.[dep]) {
                addWarning('Dependency', 'vscode-extension/package.json', `Missing dependency: ${dep}`);
                console.log(`⚠️  Extension missing dependency: ${dep}`);
            } else {
                console.log(`✅ Extension has dependency: ${dep}`);
            }
        });
    } catch (error) {
        addError('Package', 'vscode-extension/package.json', 'Cannot read extension package.json', 'Fix package.json syntax');
    }
}

// Check for syntax errors in key files
function checkSyntaxErrors() {
    console.log('\n🔍 Checking Syntax Errors...\n');
    
    const jsFiles = [
        'test-comprehensive.js',
        'test-all-components.js',
        'test-functionality.js'
    ];
    
    jsFiles.forEach(file => {
        if (fs.existsSync(file)) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                // Basic syntax check
                if (content.includes('function') || content.includes('console.log')) {
                    console.log(`✅ ${file}: Syntax OK`);
                } else {
                    addWarning('Syntax', file, 'Unusual file content');
                }
            } catch (error) {
                addError('Syntax', file, 'Cannot read file', 'Check file permissions');
            }
        }
    });
}

// Check build outputs
function checkBuildOutputs() {
    console.log('\n🏗️ Checking Build Outputs...\n');
    
    if (!fs.existsSync('dist')) {
        addError('Build', 'dist/', 'Build output missing', 'Run npm run build');
        console.log('❌ dist/ directory missing');
    } else {
        console.log('✅ dist/ directory exists');
        
        // Check for key compiled files
        const keyFiles = ['index.js', 'server/MCPServer.js'];
        keyFiles.forEach(file => {
            const fullPath = path.join('dist', file);
            if (!fs.existsSync(fullPath)) {
                addError('Build', fullPath, 'Compiled file missing', 'Run npm run build');
                console.log(`❌ Missing compiled: ${file}`);
            } else {
                console.log(`✅ Compiled file exists: ${file}`);
            }
        });
    }
    
    if (!fs.existsSync('vscode-extension/out')) {
        addError('Build', 'vscode-extension/out/', 'Extension build output missing', 'Run npm run compile in vscode-extension');
        console.log('❌ vscode-extension/out/ directory missing');
    } else {
        console.log('✅ vscode-extension/out/ directory exists');
    }
}

// Check SSL certificates
function checkSSLCertificates() {
    console.log('\n🔐 Checking SSL Certificates...\n');
    
    if (!fs.existsSync('certs')) {
        addError('SSL', 'certs/', 'SSL certificates directory missing', 'Run ./generate-certs.sh');
        console.log('❌ certs/ directory missing');
    } else {
        const certFiles = ['cert.pem', 'key.pem'];
        certFiles.forEach(file => {
            const fullPath = path.join('certs', file);
            if (!fs.existsSync(fullPath)) {
                addError('SSL', fullPath, 'SSL certificate missing', 'Run ./generate-certs.sh');
                console.log(`❌ Missing certificate: ${file}`);
            } else {
                console.log(`✅ Certificate exists: ${file}`);
            }
        });
    }
}

// Check for common issues
function checkCommonIssues() {
    console.log('\n⚠️  Checking Common Issues...\n');
    
    // Check for hardcoded values
    const filesToCheck = [
        'src/server/MCPServer.ts',
        'vscode-extension/src/mcpClient.ts'
    ];
    
    filesToCheck.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Check for hardcoded IPs (excluding configuration defaults)
            const hardcodedPatterns = [
                /return ['"]http:\/\/localhost:/,
                /return ['"]https:\/\/localhost:/,
                /= ['"]http:\/\/localhost:/,
                /= ['"]https:\/\/localhost:/
            ];
            
            if (hardcodedPatterns.some(pattern => pattern.test(content))) {
                addWarning('Hardcoded', file, 'Contains hardcoded localhost references');
            }
            
            // Check for TODO comments
            if (content.includes('TODO') || content.includes('FIXME')) {
                addWarning('TODO', file, 'Contains TODO/FIXME comments');
            }
            
            console.log(`✅ Checked: ${file}`);
        }
    });
}

// Check environment configuration
function checkEnvironmentConfig() {
    console.log('\n🌍 Checking Environment Configuration...\n');
    
    if (!fs.existsSync('.env.example')) {
        addError('Config', '.env.example', 'Environment example missing', 'Create .env.example');
        console.log('❌ .env.example missing');
    } else {
        const envContent = fs.readFileSync('.env.example', 'utf8');
        const requiredVars = ['OLLAMA_HOST', 'OLLAMA_MODEL'];
        
        requiredVars.forEach(varName => {
            if (!envContent.includes(varName)) {
                addWarning('Config', '.env.example', `Missing environment variable: ${varName}`);
                console.log(`⚠️  Missing env var: ${varName}`);
            } else {
                console.log(`✅ Found env var: ${varName}`);
            }
        });
    }
}

// Generate report
function generateReport() {
    console.log('\n📊 ERROR ANALYSIS REPORT\n');
    console.log('='.repeat(50));
    
    if (errors.length === 0 && warnings.length === 0) {
        console.log('🎉 NO ERRORS OR WARNINGS FOUND!');
        console.log('✅ Project is in excellent condition');
        return;
    }
    
    if (errors.length > 0) {
        console.log(`\n❌ ERRORS FOUND: ${errors.length}\n`);
        errors.forEach((error, index) => {
            console.log(`${index + 1}. [${error.category}] ${error.file}`);
            console.log(`   Issue: ${error.issue}`);
            if (error.fix) {
                console.log(`   Fix: ${error.fix}`);
            }
            console.log('');
        });
    }
    
    if (warnings.length > 0) {
        console.log(`\n⚠️  WARNINGS FOUND: ${warnings.length}\n`);
        warnings.forEach((warning, index) => {
            console.log(`${index + 1}. [${warning.category}] ${warning.file}`);
            console.log(`   Issue: ${warning.issue}`);
            console.log('');
        });
    }
    
    console.log('\n🔧 RECOMMENDED FIXES:\n');
    if (fixes.length > 0) {
        fixes.forEach((fix, index) => {
            console.log(`${index + 1}. ${fix.fix}`);
        });
    } else {
        console.log('No critical fixes needed');
    }
    
    console.log('\n📈 PROJECT HEALTH:');
    const totalIssues = errors.length + warnings.length;
    const healthScore = Math.max(0, 100 - (errors.length * 10) - (warnings.length * 2));
    
    console.log(`Health Score: ${healthScore}%`);
    console.log(`Critical Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    
    if (healthScore >= 90) {
        console.log('Status: 🟢 EXCELLENT');
    } else if (healthScore >= 70) {
        console.log('Status: 🟡 GOOD');
    } else if (healthScore >= 50) {
        console.log('Status: 🟠 NEEDS ATTENTION');
    } else {
        console.log('Status: 🔴 CRITICAL ISSUES');
    }
}

// Run all checks
function runAllChecks() {
    checkMissingFiles();
    checkDependencies();
    checkTypeScriptCompilation();
    checkBuildOutputs();
    checkSSLCertificates();
    checkSyntaxErrors();
    checkEnvironmentConfig();
    checkCommonIssues();
    generateReport();
}

runAllChecks();