import * as vscode from 'vscode';

export class LSPIntegration {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private mcpClient: any;
  
  constructor(mcpClient: any) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('smartcode-ai');
    this.mcpClient = mcpClient;
  }
  
  async getDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    try {
      const result = await this.mcpClient.request('handleVSCodeLSPIntegration', {
        uri: document.uri.toString(),
        code: document.getText(),
        language: document.languageId,
        action: 'diagnostics'
      });
      
      return result.diagnostics?.map((d: any) => new vscode.Diagnostic(
        new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character),
        d.message,
        this.mapSeverity(d.severity)
      )) || [];
    } catch {
      return vscode.languages.getDiagnostics(document.uri);
    }
  }
  
  async getSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
    try {
      const result = await this.mcpClient.request('handleVSCodeLSPIntegration', {
        uri: document.uri.toString(),
        code: document.getText(),
        language: document.languageId,
        action: 'symbols'
      });
      
      return result?.map((s: any) => new vscode.DocumentSymbol(
        s.name,
        s.kind,
        vscode.SymbolKind.Function,
        new vscode.Range(0, 0, 0, 0),
        new vscode.Range(0, 0, 0, 0)
      )) || [];
    } catch {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
      return symbols || [];
    }
  }
  
  async getHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );
    return hovers?.[0];
  }
  
  async getDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      position
    );
    return definitions || [];
  }
  
  async getReferences(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      position
    );
    return references || [];
  }
  
  addDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic): void {
    const existing = this.diagnosticCollection.get(uri) || [];
    this.diagnosticCollection.set(uri, [...existing, diagnostic]);
  }
  
  clearDiagnostics(uri?: vscode.Uri): void {
    if (uri) {
      this.diagnosticCollection.delete(uri);
    } else {
      this.diagnosticCollection.clear();
    }
  }
  
  private mapSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'info': return vscode.DiagnosticSeverity.Information;
      case 'hint': return vscode.DiagnosticSeverity.Hint;
      default: return vscode.DiagnosticSeverity.Information;
    }
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}