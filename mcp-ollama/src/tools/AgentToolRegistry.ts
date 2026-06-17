import { FileSystemTool } from './FileSystemTool.js';

export type AgentToolRole = 'code' | 'test' | 'project' | 'file' | 'autonomous';

const ROLES: AgentToolRole[] = ['code', 'test', 'project', 'file', 'autonomous'];

/**
 * Separate FileSystemTool instance per agent role (isolated allowWorkspace state).
 */
export class AgentToolRegistry {
  private readonly tools = new Map<AgentToolRole, FileSystemTool>();

  constructor() {
    for (const role of ROLES) {
      this.tools.set(role, new FileSystemTool());
    }
  }

  get(role: AgentToolRole): FileSystemTool {
    const tool = this.tools.get(role);
    if (!tool) {
      throw new Error(`No FileSystemTool registered for role: ${role}`);
    }
    return tool;
  }
}
