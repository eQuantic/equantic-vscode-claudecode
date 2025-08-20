import * as vscode from 'vscode';
import { ClaudeChatProvider } from './providers/ClaudeChatProvider';
import { ClaudeHistoryProvider } from './providers/ClaudeHistoryProvider';
import { ClaudeCodeManager } from './core/ClaudeCodeManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('Equantic Claude Code extension is now active!');

    const claudeManager = new ClaudeCodeManager(context);
    const chatProvider = new ClaudeChatProvider(context, claudeManager);
    const historyProvider = new ClaudeHistoryProvider(context, claudeManager);

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

    // Register tree data provider for history
    const historyView = vscode.window.registerTreeDataProvider(
        'equantic-claude-code.historyView',
        historyProvider
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
            historyProvider.clearHistory();
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

    const refreshHistoryCommand = vscode.commands.registerCommand(
        'equantic-claude-code.refreshHistory',
        async () => {
            await historyProvider.refresh();
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
        historyView,
        openChatCommand,
        newTaskCommand,
        stopTaskCommand,
        clearHistoryCommand,
        openSettingsCommand,
        resumeSessionCommand,
        refreshHistoryCommand,
        showInstallationInfoCommand,
        refreshInstallationCommand,
        claudeManager
    );

    // Auto-start if enabled
    const config = vscode.workspace.getConfiguration('equantic-claude-code');
    if (config.get('autoStart', true)) {
        claudeManager.initialize();
    }
}

export function deactivate() {
    console.log('Equantic Claude Code extension is now deactivated!');
}