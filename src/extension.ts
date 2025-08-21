import * as vscode from 'vscode';
import { ClaudeChatProvider } from './providers/ClaudeChatProvider';
import { ClaudeCodeManager } from './core/ClaudeCodeManager';

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Extension Debug');
    outputChannel.appendLine('Equantic Claude Code extension is now active!');

    outputChannel.appendLine('Creating ClaudeCodeManager...');
    const claudeManager = new ClaudeCodeManager(context);
    outputChannel.appendLine('ClaudeCodeManager created successfully');
    
    outputChannel.appendLine('Creating ClaudeChatProvider...');
    const chatProvider = new ClaudeChatProvider(context, claudeManager);
    outputChannel.appendLine('ClaudeChatProvider created successfully');

    // Register webview provider for chat
    const chatWebview = vscode.window.registerWebviewViewProvider(
        'equantic-claude-code.chatView',
        chatProvider,
        {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }
    );


    // Register commands
    const openChatCommand = vscode.commands.registerCommand(
        'equantic-claude-code.openChat',
        () => {
            vscode.commands.executeCommand('workbench.view.extension.equantic-claude-code');
        }
    );

    const newTaskCommand = vscode.commands.registerCommand(
        'equantic-claude-code.newTask',
        async () => {
            await claudeManager.startNewTask();
        }
    );

    const stopTaskCommand = vscode.commands.registerCommand(
        'equantic-claude-code.stopTask',
        () => {
            claudeManager.stopCurrentTask();
        }
    );

    const clearHistoryCommand = vscode.commands.registerCommand(
        'equantic-claude-code.clearHistory',
        () => {
            chatProvider.clearChat();
        }
    );

    const openSettingsCommand = vscode.commands.registerCommand(
        'equantic-claude-code.openSettings',
        () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'equantic-claude-code');
        }
    );

    const resumeSessionCommand = vscode.commands.registerCommand(
        'equantic-claude-code.resumeSession',
        async (sessionId: string) => {
            try {
                await claudeManager.resumeSession(sessionId);
                // Clear current chat and reload with session messages
                chatProvider.clearChat();
                // Open the chat view
                vscode.commands.executeCommand('workbench.view.extension.equantic-claude-code');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to resume session: ${error}`);
            }
        }
    );


    const showInstallationInfoCommand = vscode.commands.registerCommand(
        'equantic-claude-code.showInstallationInfo',
        async () => {
            await claudeManager.showInstallationInfo();
        }
    );

    const refreshInstallationCommand = vscode.commands.registerCommand(
        'equantic-claude-code.refreshInstallation',
        async () => {
            await claudeManager.refreshInstallation();
        }
    );

    // Add all disposables to context
    context.subscriptions.push(
        chatWebview,
        openChatCommand,
        newTaskCommand,
        stopTaskCommand,
        clearHistoryCommand,
        openSettingsCommand,
        resumeSessionCommand,
        showInstallationInfoCommand,
        refreshInstallationCommand,
        claudeManager
    );

    // Auto-start if enabled
    const config = vscode.workspace.getConfiguration('equantic-claude-code');
    if (config.get('autoStart', true)) {
        outputChannel.appendLine('Starting ClaudeCodeManager initialization...');
        claudeManager.initialize().then(() => {
            outputChannel.appendLine('ClaudeCodeManager initialization completed');
        }).catch(error => {
            outputChannel.appendLine(`ClaudeCodeManager initialization failed: ${error}`);
        });
    }
}

export function deactivate() {
    console.log('Equantic Claude Code extension is now deactivated!');
}