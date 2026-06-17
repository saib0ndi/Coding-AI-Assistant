import * as vscode from 'vscode';

export interface SemanticMatch {
  code: string;
  similarity: number;
  location: vscode.Location;
  filePath?: string;
  symbolName?: string;
}

export class SemanticProvider {
  private mcpClient: { indexCodebase?: (p: string, f?: boolean, fp?: string) => Promise<any>; searchCodebase?: (q: string, p: string, l?: number) => Promise<any> } | undefined;
  private indexPromise: Promise<void> | null = null;

  constructor(mcpClient?: SemanticProvider['mcpClient']) {
    this.mcpClient = mcpClient;
  }

  private getWorkspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async indexWorkspace(force = false): Promise<void> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath || !this.mcpClient?.indexCodebase) return;

    if (this.indexPromise && !force) {
      return this.indexPromise;
    }

    this.indexPromise = (async () => {
      try {
        const status = await this.mcpClient!.indexCodebase!(workspacePath, force);
        console.log('[SemanticProvider] Index ready:', status?.chunkCount ?? 0, 'chunks');
      } catch (error) {
        console.warn('[SemanticProvider] Index failed:', error);
      }
    })();

    return this.indexPromise;
  }

  async indexFile(filePath: string): Promise<void> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath || !this.mcpClient?.indexCodebase) return;

    try {
      const status = await this.mcpClient.indexCodebase(workspacePath, false, filePath);
      console.log('[SemanticProvider] Incremental file index updated:', filePath, status?.chunkCount ?? 0, 'chunks');
    } catch (error) {
      console.warn('[SemanticProvider] Incremental file index failed for:', filePath, error);
    }
  }

  async findSimilarCode(query: string, language: string): Promise<SemanticMatch[]> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) return [];

    await this.indexWorkspace();

    if (this.mcpClient?.searchCodebase) {
      try {
        const result = await this.mcpClient.searchCodebase(query, workspacePath, 8);
        const matches = Array.isArray(result?.matches) ? result.matches : [];
        return matches.map((m: any) => this.toSemanticMatch(m, workspacePath));
      } catch (error) {
        console.warn('[SemanticProvider] search_codebase failed:', error);
      }
    }

    return [];
  }

  private toSemanticMatch(raw: any, workspaceRoot: string): SemanticMatch {
    const filePath = raw.filePath ?? raw.metadata?.filePath ?? 'unknown';
    const absPath = filePath.startsWith('/') ? filePath : `${workspaceRoot}/${filePath}`;
    const startLine = Math.max(0, (raw.startLine ?? raw.metadata?.startLine ?? 1) - 1);
    const endLine = Math.max(startLine, (raw.endLine ?? raw.metadata?.endLine ?? startLine + 1) - 1);

    return {
      code: raw.code ?? '',
      similarity: raw.similarity ?? raw.score ?? 0,
      filePath: absPath,
      symbolName: raw.symbolName ?? raw.metadata?.symbolName,
      location: new vscode.Location(
        vscode.Uri.file(absPath),
        new vscode.Range(startLine, 0, endLine, 0)
      ),
    };
  }
}
