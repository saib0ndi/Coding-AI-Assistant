import * as vscode from 'vscode';

export interface ASTNode {
    type: string;
    name?: string;
    range: vscode.Range;
    children: ASTNode[];
    parameters?: string[];
    returnType?: string;
}

export class ASTParser {
    
    parseDocument(document: vscode.TextDocument): ASTNode | null {
        const text = document.getText();
        const language = document.languageId;
        
        // Skip unsupported file types to prevent tracking errors
        const unsupportedTypes = ['json', 'jsonc', 'xml', 'yaml', 'markdown', 'plaintext'];
        if (unsupportedTypes.includes(language)) {
            return null;
        }
        
        try {
            switch (language) {
                case 'javascript':
                case 'typescript':
                    return this.parseJavaScript(text, document);
                case 'python':
                    return this.parsePython(text, document);
                default:
                    return this.parseGeneric(text, document);
            }
        } catch (error) {
            console.error(`AST parsing failed for ${document.fileName}:`, error);
            return null;
        }
    }

    private parseJavaScript(text: string, document: vscode.TextDocument): ASTNode {
        const root: ASTNode = {
            type: 'program',
            range: new vscode.Range(0, 0, document.lineCount - 1, 0),
            children: []
        };

        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Function declarations
            const funcMatch = line.match(/(?:function\s+(\w+)|(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>))/);
            if (funcMatch) {
                const funcName = funcMatch[1] || funcMatch[2];
                const params = this.extractParameters(line);
                
                root.children.push({
                    type: 'function',
                    name: funcName,
                    range: new vscode.Range(i, 0, this.findBlockEnd(lines, i), 0),
                    parameters: params,
                    children: []
                });
            }
            
            // Class declarations
            const classMatch = line.match(/class\s+(\w+)/);
            if (classMatch) {
                const className = classMatch[1];
                const classEnd = this.findBlockEnd(lines, i);
                
                const classNode: ASTNode = {
                    type: 'class',
                    name: className,
                    range: new vscode.Range(i, 0, classEnd, 0),
                    children: []
                };
                
                // Parse class methods
                for (let j = i + 1; j < classEnd; j++) {
                    const methodLine = lines[j].trim();
                    const methodMatch = methodLine.match(/(\w+)\s*\([^)]*\)\s*{/);
                    if (methodMatch) {
                        classNode.children.push({
                            type: 'method',
                            name: methodMatch[1],
                            range: new vscode.Range(j, 0, this.findBlockEnd(lines, j), 0),
                            parameters: this.extractParameters(methodLine),
                            children: []
                        });
                    }
                }
                
                root.children.push(classNode);
            }
            
            // Variable declarations
            const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
            if (varMatch) {
                root.children.push({
                    type: 'variable',
                    name: varMatch[1],
                    range: new vscode.Range(i, 0, i, line.length),
                    children: []
                });
            }
        }
        
        return root;
    }

    private parsePython(text: string, document: vscode.TextDocument): ASTNode {
        const root: ASTNode = {
            type: 'module',
            range: new vscode.Range(0, 0, document.lineCount - 1, 0),
            children: []
        };

        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Function definitions
            const funcMatch = trimmed.match(/def\s+(\w+)\s*\([^)]*\):/);
            if (funcMatch) {
                const funcName = funcMatch[1];
                const params = this.extractPythonParameters(trimmed);
                
                root.children.push({
                    type: 'function',
                    name: funcName,
                    range: new vscode.Range(i, 0, this.findPythonBlockEnd(lines, i), 0),
                    parameters: params,
                    children: []
                });
            }
            
            // Class definitions
            const classMatch = trimmed.match(/class\s+(\w+)(?:\([^)]*\))?:/);
            if (classMatch) {
                const className = classMatch[1];
                const classEnd = this.findPythonBlockEnd(lines, i);
                
                const classNode: ASTNode = {
                    type: 'class',
                    name: className,
                    range: new vscode.Range(i, 0, classEnd, 0),
                    children: []
                };
                
                // Parse class methods
                for (let j = i + 1; j < classEnd; j++) {
                    const methodLine = lines[j].trim();
                    const methodMatch = methodLine.match(/def\s+(\w+)\s*\([^)]*\):/);
                    if (methodMatch && this.getIndentLevel(lines[j]) > this.getIndentLevel(lines[i])) {
                        classNode.children.push({
                            type: 'method',
                            name: methodMatch[1],
                            range: new vscode.Range(j, 0, this.findPythonBlockEnd(lines, j), 0),
                            parameters: this.extractPythonParameters(methodLine),
                            children: []
                        });
                    }
                }
                
                root.children.push(classNode);
            }
        }
        
        return root;
    }

    private parseGeneric(text: string, document: vscode.TextDocument): ASTNode {
        return {
            type: 'unknown',
            range: new vscode.Range(0, 0, document.lineCount - 1, 0),
            children: []
        };
    }

    private extractParameters(line: string): string[] {
        const match = line.match(/\(([^)]*)\)/);
        if (!match || !match[1]) return [];
        
        return match[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
    }

    private extractPythonParameters(line: string): string[] {
        const match = line.match(/\(([^)]*)\)/);
        if (!match || !match[1]) return [];
        
        return match[1].split(',')
            .map(p => p.trim().split(':')[0].split('=')[0].trim())
            .filter(p => p.length > 0);
    }

    private findBlockEnd(lines: string[], startLine: number): number {
        let braceCount = 0;
        let foundOpenBrace = false;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    foundOpenBrace = true;
                } else if (char === '}') {
                    braceCount--;
                    if (foundOpenBrace && braceCount === 0) {
                        return i;
                    }
                }
            }
        }
        
        return lines.length - 1;
    }

    private findPythonBlockEnd(lines: string[], startLine: number): number {
        const baseIndent = this.getIndentLevel(lines[startLine]);
        
        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') continue;
            
            const indent = this.getIndentLevel(line);
            if (indent <= baseIndent) {
                return i - 1;
            }
        }
        
        return lines.length - 1;
    }

    private getIndentLevel(line: string): number {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    findNodeAtPosition(ast: ASTNode | null, position: vscode.Position): ASTNode | null {
        if (!ast || !ast.range.contains(position)) {
            return null;
        }
        
        // Check children first (more specific)
        for (const child of ast.children) {
            const result = this.findNodeAtPosition(child, position);
            if (result) {
                return result;
            }
        }
        
        return ast;
    }

    getAvailableSymbols(ast: ASTNode | null, position: vscode.Position): string[] {
        const symbols: string[] = [];
        
        if (!ast) return symbols;
        
        function collectSymbols(node: ASTNode) {
            if (node.name && node.range.end.isBefore(position)) {
                symbols.push(node.name);
            }
            
            for (const child of node.children) {
                collectSymbols(child);
            }
        }
        
        collectSymbols(ast);
        return symbols;
    }
}