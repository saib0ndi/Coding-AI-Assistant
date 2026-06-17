import * as vscode from 'vscode';
import { registerCoreCommands } from './coreCommands';
import { registerEditorCommands } from './editorCommands';
import { registerAgentCommands } from './agentCommands';
import type { CommandServices } from './types';

export type { CommandServices } from './types';

export function registerAllCommands(
    context: vscode.ExtensionContext,
    services: CommandServices
): vscode.Disposable[] {
    return [
        ...registerCoreCommands(context, services),
        ...registerEditorCommands(services),
        ...registerAgentCommands(services),
    ];
}
