import * as vscode from 'vscode';

export interface CodeContext {
    imports: string[];
    functions: string[];
    variables: string[];
    classes: string[];
    currentScope: string;
    indentLevel: number;
}

export class ContextAnalyzer {
    
    analyzeDocument(document: vscode.TextDocument, position: vscode.Position): CodeContext {
        const text = document.getText();
        const lines = text.split('\n');
        const currentLine = lines[position.line];
        
        return {
            imports: this.extractImports(lines),
            functions: this.extractFunctions(lines),
            variables: this.extractVariables(lines, position.line),
            classes: this.extractClasses(lines),
            currentScope: this.getCurrentScope(lines, position.line),
            indentLevel: this.getIndentLevel(currentLine)
        };
    }

    private extractImports(lines: string[]): string[] {
        const imports: string[] = [];
        const importPatterns = [
            /^import\s+(.+)\s+from\s+['"](.+)['"]/, // ES6 imports
            /^import\s+['"](.+)['"]/, // Simple imports
            /^const\s+(.+)\s*=\s*require\(['"](.+)['"]\)/, // CommonJS
            /^from\s+(.+)\s+import\s+(.+)/, // Python
            /^#include\s*<(.+)>/, // C/C++
            /^using\s+(.+);/ // C#
        ];

        lines.forEach(line => {
            const trimmed = line.trim();
            importPatterns.forEach(pattern => {
                const match = trimmed.match(pattern);
                if (match) {
                    imports.push(match[1] || match[0]);
                }
            });
        });

        return imports;
    }

    private extractFunctions(lines: string[]): string[] {
        const functions: string[] = [];
        const functionPatterns = [
            /function\s+(\w+)\s*\(/, // JavaScript function
            /(\w+)\s*\([^)]*\)\s*{/, // General function
            /def\s+(\w+)\s*\(/, // Python
            /(\w+)\s*\([^)]*\)\s*=>/, // Arrow function
            /public\s+\w+\s+(\w+)\s*\(/, // Java/C#
            /private\s+\w+\s+(\w+)\s*\(/ // Java/C#
        ];

        lines.forEach(line => {
            const trimmed = line.trim();
            functionPatterns.forEach(pattern => {
                const match = trimmed.match(pattern);
                if (match && match[1]) {
                    functions.push(match[1]);
                }
            });
        });

        return functions;
    }

    private extractVariables(lines: string[], currentLine: number): string[] {
        const variables: string[] = [];
        const varPatterns = [
            /(?:let|const|var)\s+(\w+)/, // JavaScript
            /(\w+)\s*=/, // General assignment
            /(\w+)\s*:/, // Type annotation
        ];

        // Only look at lines before current position
        lines.slice(0, currentLine).forEach(line => {
            const trimmed = line.trim();
            varPatterns.forEach(pattern => {
                const match = trimmed.match(pattern);
                if (match && match[1] && !match[1].includes('function')) {
                    variables.push(match[1]);
                }
            });
        });

        return [...new Set(variables)]; // Remove duplicates
    }

    private extractClasses(lines: string[]): string[] {
        const classes: string[] = [];
        const classPatterns = [
            /class\s+(\w+)/, // JavaScript/TypeScript/Python
            /public\s+class\s+(\w+)/, // Java/C#
            /struct\s+(\w+)/ // C/C++
        ];

        lines.forEach(line => {
            const trimmed = line.trim();
            classPatterns.forEach(pattern => {
                const match = trimmed.match(pattern);
                if (match && match[1]) {
                    classes.push(match[1]);
                }
            });
        });

        return classes;
    }

    private getCurrentScope(lines: string[], currentLine: number): string {
        let scope = 'global';
        let braceCount = 0;
        
        for (let i = 0; i < currentLine; i++) {
            const line = lines[i].trim();
            
            // Check for function/class definitions
            if (line.includes('function ') || line.includes('class ') || line.includes('def ')) {
                const match = line.match(/(?:function|class|def)\s+(\w+)/);
                if (match) {
                    scope = match[1];
                }
            }
            
            // Count braces to track scope depth
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
        }
        
        return scope;
    }

    private getIndentLevel(line: string): number {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    getSmartSuggestions(context: CodeContext, language: string): string[] {
        const suggestions: string[] = [];
        
        // Suggest based on context
        if (context.currentScope !== 'global') {
            suggestions.push(`// Inside ${context.currentScope}`);
        }
        
        // Suggest imports if none exist
        if (context.imports.length === 0 && language === 'javascript') {
            suggestions.push('import ');
        }
        
        // Suggest variable usage
        if (context.variables.length > 0) {
            suggestions.push(context.variables[context.variables.length - 1]);
        }
        
        return suggestions;
    }
}