"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceAnalyzer = void 0;
const vscode = require("vscode");
const path = require("path");
class WorkspaceAnalyzer {
    constructor(mcpClient) {
        this.mcpClient = mcpClient;
        this.analysisCache = new Map();
        this.setupFileWatcher();
    }
    setupFileWatcher() {
        try {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{js,ts,py,java,cpp,c,go,rs}');
            this.fileWatcher.onDidChange((uri) => {
                try {
                    this.analysisCache.delete(uri.fsPath);
                }
                catch (error) {
                    console.error('Error handling file change:', error);
                }
            });
            this.fileWatcher.onDidDelete((uri) => {
                try {
                    this.analysisCache.delete(uri.fsPath);
                }
                catch (error) {
                    console.error('Error handling file deletion:', error);
                }
            });
        }
        catch (error) {
            console.error('Failed to setup file watcher:', error);
        }
    }
    async analyzeWorkspace() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return { error: 'No workspace folder found' };
        }
        const analysis = {
            folders: workspaceFolders.map(f => f.uri.fsPath),
            files: await this.getWorkspaceFiles(),
            languages: await this.getLanguageStats(),
            dependencies: await this.analyzeDependencies(),
            structure: await this.analyzeProjectStructure()
        };
        return analysis;
    }
    async analyzeFile(filePath) {
        if (this.analysisCache.has(filePath)) {
            return this.analysisCache.get(filePath);
        }
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const content = document.getText();
            const language = document.languageId;
            const analysis = {
                path: filePath,
                language,
                lines: document.lineCount,
                size: content.length,
                functions: this.extractFunctions(content, language),
                imports: this.extractImports(content, language),
                complexity: this.calculateComplexity(content, language)
            };
            this.analysisCache.set(filePath, analysis);
            return analysis;
        }
        catch (error) {
            return { error: `Failed to analyze file: ${error}` };
        }
    }
    async getContextForPosition(document, position) {
        const line = document.lineAt(position);
        const range = new vscode.Range(Math.max(0, position.line - 10), 0, Math.min(document.lineCount - 1, position.line + 10), 0);
        const context = {
            currentLine: line.text,
            surroundingCode: document.getText(range),
            fileName: path.basename(document.fileName),
            language: document.languageId,
            position: { line: position.line, character: position.character },
            workspaceFiles: await this.getRelatedFiles(document.fileName)
        };
        return context;
    }
    async getWorkspaceFiles() {
        const files = await vscode.workspace.findFiles('**/*.{js,ts,py,java,cpp,c,go,rs,json,md}', '**/node_modules/**');
        return files.map(f => f.fsPath);
    }
    async getLanguageStats() {
        const files = await this.getWorkspaceFiles();
        const stats = {};
        for (const file of files) {
            const ext = path.extname(file);
            stats[ext] = (stats[ext] || 0) + 1;
        }
        return stats;
    }
    async analyzeDependencies() {
        const packageJsonFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
        const dependencies = {};
        for (const file of packageJsonFiles) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const pkg = JSON.parse(content.toString());
                dependencies[file.fsPath] = {
                    dependencies: pkg.dependencies || {},
                    devDependencies: pkg.devDependencies || {}
                };
            }
            catch (error) {
                // Ignore malformed package.json files
            }
        }
        return dependencies;
    }
    async analyzeProjectStructure() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return {};
        const structure = {};
        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{js,ts,py,java,cpp,c,go,rs,json,md}'), new vscode.RelativePattern(folder, '**/node_modules/**'));
            structure[folder.name] = {
                path: folder.uri.fsPath,
                fileCount: files.length,
                directories: await this.getDirectoryStructure(folder.uri)
            };
        }
        return structure;
    }
    async getDirectoryStructure(uri) {
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries
                .filter(([_, type]) => type === vscode.FileType.Directory)
                .map(([name]) => name);
        }
        catch (error) {
            return [];
        }
    }
    async getRelatedFiles(currentFile) {
        const dir = path.dirname(currentFile);
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '*.{js,ts,py,java,cpp,c,go,rs}'));
        return files.map(f => f.fsPath).filter(f => f !== currentFile).slice(0, 5);
    }
    extractFunctions(content, language) {
        const functions = [];
        const lines = content.split('\n');
        const patterns = {
            javascript: /function\s+(\w+)|(\w+)\s*=\s*function|(\w+)\s*=>\s*{|class\s+(\w+)/g,
            typescript: /function\s+(\w+)|(\w+)\s*=\s*function|(\w+)\s*=>\s*{|class\s+(\w+)/g,
            python: /def\s+(\w+)|class\s+(\w+)/g,
            java: /public\s+\w+\s+(\w+)\s*\(|class\s+(\w+)/g,
            cpp: /\w+\s+(\w+)\s*\([^)]*\)\s*{|class\s+(\w+)/g,
            go: /func\s+(\w+)|type\s+(\w+)\s+struct/g,
            rust: /fn\s+(\w+)|struct\s+(\w+)|impl\s+(\w+)/g
        };
        const pattern = patterns[language];
        if (pattern) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const funcName = match?.find(m => m && m !== match?.[0]);
                if (funcName && typeof funcName === 'string') {
                    functions.push(funcName.replace(/[^a-zA-Z0-9_]/g, ''));
                }
            }
        }
        return functions;
    }
    extractImports(content, language) {
        const imports = [];
        const lines = content.split('\n');
        const patterns = {
            javascript: /import\s+.*from\s+['"]([^'"]+)['"]/g,
            typescript: /import\s+.*from\s+['"]([^'"]+)['"]/g,
            python: /from\s+(\w+)|import\s+(\w+)/g,
            java: /import\s+([\w.]+)/g,
            cpp: /#include\s*[<"]([^>"]+)[>"]/g,
            go: /import\s+['"]([^'"]+)['"]/g,
            rust: /use\s+([\w:]+)/g
        };
        const pattern = patterns[language];
        if (pattern) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const importName = match[1] || match[2];
                if (importName)
                    imports.push(importName);
            }
        }
        return imports;
    }
    calculateComplexity(content, language) {
        // Simple cyclomatic complexity calculation
        const complexityKeywords = [
            'if', 'else', 'elif', 'while', 'for', 'switch', 'case', 'catch', 'try', '&&', '||', '?'
        ];
        let complexity = 1; // Base complexity
        for (const keyword of complexityKeywords) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'g');
            const matches = content.match(regex);
            if (matches)
                complexity += matches.length;
        }
        return complexity;
    }
    dispose() {
        this.fileWatcher?.dispose();
        this.analysisCache.clear();
    }
}
exports.WorkspaceAnalyzer = WorkspaceAnalyzer;
//# sourceMappingURL=workspaceAnalyzer.js.map