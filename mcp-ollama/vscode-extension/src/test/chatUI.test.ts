import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChatUI } from '../chatUI';

// Mock VS Code API
const mockContext: vscode.ExtensionContext = {
    subscriptions: [],
    workspaceState: {} as any,
    globalState: {} as any,
    extensionUri: vscode.Uri.file('/test'),
    extensionPath: '/test',
    asAbsolutePath: (relativePath: string) => `/test/${relativePath}`,
    storageUri: vscode.Uri.file('/test/storage'),
    globalStorageUri: vscode.Uri.file('/test/global'),
    logUri: vscode.Uri.file('/test/log'),
    storagePath: '/test/storage',
    globalStoragePath: '/test/global',
    logPath: '/test/log',
    languageModelAccessInformation: {} as any,
    secrets: {} as any,
    environmentVariableCollection: {} as any,
    extension: {} as any,
    extensionMode: vscode.ExtensionMode.Test
};

suite('ChatUI Test Suite', () => {
    let chatUI: ChatUI;

    setup(() => {
        chatUI = new ChatUI(mockContext);
    });

    teardown(() => {
        chatUI.dispose();
    });

    test('ChatUI constructor initializes correctly', () => {
        assert.ok(chatUI, 'ChatUI should be created');
    });

    test('formatModelName formats correctly', () => {
        const formatted = (chatUI as any).formatModelName('deepseek-coder-v2:236b');
        assert.strictEqual(formatted, 'Deepseek Coder V2', 'Should format model name correctly');
    });

    test('formatSize formats bytes correctly', () => {
        const sizeGB = (chatUI as any).formatSize(2 * 1024 * 1024 * 1024);
        const sizeMB = (chatUI as any).formatSize(500 * 1024 * 1024);
        
        assert.strictEqual(sizeGB, '2GB', 'Should format GB correctly');
        assert.strictEqual(sizeMB, '500MB', 'Should format MB correctly');
    });

    test('isCodeRelated detects code correctly', () => {
        const codeText = 'function test() { return true; }';
        const normalText = 'Hello, how are you?';
        
        assert.ok((chatUI as any).isCodeRelated(codeText), 'Should detect code');
        assert.ok(!(chatUI as any).isCodeRelated(normalText), 'Should not detect normal text as code');
    });

    test('getFallbackModels returns model list', () => {
        const models = (chatUI as any).getFallbackModels();
        
        assert.ok(Array.isArray(models), 'Should return array');
        assert.ok(models.length > 0, 'Should have models');
        assert.ok(models[0].name, 'Models should have name property');
        assert.ok(models[0].displayName, 'Models should have displayName property');
        assert.ok(models[0].size, 'Models should have size property');
    });
});