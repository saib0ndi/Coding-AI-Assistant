import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { ContextAnalyzer, CodeContext } from './contextAnalyzer';

export class MultiLineGenerator {
    private mcpClient: MCPClient;
    private contextAnalyzer: ContextAnalyzer;

    constructor(mcpClient: MCPClient, contextAnalyzer: ContextAnalyzer) {
        this.mcpClient = mcpClient;
        this.contextAnalyzer = contextAnalyzer;
    }

    async generateFunction(
        document: vscode.TextDocument,
        position: vscode.Position,
        functionSignature: string
    ): Promise<string | null> {
        const context = this.contextAnalyzer.analyzeDocument(document, position);
        const language = document.languageId;

        try {
            const prompt = this.buildFunctionPrompt(functionSignature, context, language);
            const result = await this.mcpClient.handleSlashCommand('/generate', prompt, language);
            return this.cleanGeneratedCode(result, language);
        } catch (error) {
            console.error('Error generating function:', error);
            return this.getFallbackFunction(functionSignature, language);
        }
    }

    async generateClass(
        document: vscode.TextDocument,
        position: vscode.Position,
        className: string
    ): Promise<string | null> {
        const context = this.contextAnalyzer.analyzeDocument(document, position);
        const language = document.languageId;

        try {
            const prompt = this.buildClassPrompt(className, context, language);
            const result = await this.mcpClient.handleSlashCommand('/generate', prompt, language);
            return this.cleanGeneratedCode(result, language);
        } catch (error) {
            console.error('Error generating class:', error);
            return this.getFallbackClass(className, language);
        }
    }

    private buildFunctionPrompt(signature: string, context: CodeContext, language: string): string {
        return `Generate a complete ${language} function:
Signature: ${signature}
Context: ${JSON.stringify(context)}
Requirements:
- Include proper error handling
- Add JSDoc/docstring comments
- Use existing imports: ${context.imports.join(', ')}
- Follow ${language} best practices`;
    }

    private buildClassPrompt(className: string, context: CodeContext, language: string): string {
        return `Generate a complete ${language} class:
Class name: ${className}
Context: ${JSON.stringify(context)}
Requirements:
- Include constructor
- Add common methods
- Include proper documentation
- Follow ${language} conventions`;
    }

    private cleanGeneratedCode(code: string, language: string): string {
        // Remove markdown code blocks
        code = code.replace(/```[\w]*\n?/g, '').replace(/```/g, '');
        
        // Remove extra whitespace
        code = code.trim();
        
        // Language-specific cleaning
        if (language === 'javascript' || language === 'typescript') {
            // Ensure proper semicolons
            code = code.replace(/([^;])\n/g, '$1;\n');
        }
        
        return code;
    }

    private getFallbackFunction(signature: string, language: string): string {
        if (language === 'javascript' || language === 'typescript') {
            return `${signature} {\n    // TODO: Implement function\n    throw new Error('Not implemented');\n}`;
        }
        if (language === 'python') {
            return `${signature}:\n    """TODO: Implement function"""\n    raise NotImplementedError()`;
        }
        return `${signature} {\n    // TODO: Implement\n}`;
    }

    private getFallbackClass(className: string, language: string): string {
        if (language === 'javascript' || language === 'typescript') {
            return `class ${className} {\n    constructor() {\n        // TODO: Initialize\n    }\n}`;
        }
        if (language === 'python') {
            return `class ${className}:\n    def __init__(self):\n        """Initialize ${className}"""\n        pass`;
        }
        return `class ${className} {\n    // TODO: Implement\n}`;
    }
}