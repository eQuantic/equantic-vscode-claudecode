import * as vscode from 'vscode';
import { ClaudeCodeManager } from '../core/ClaudeCodeManager';
import { ClaudeMessage } from '../types';
import { StreamingMessage } from '../core/ClaudeStreamingClient';
import { AnsiColorConverter, ClaudeOutputParser } from '../utils/AnsiColorConverter';
import { createWebviewTemplate } from '../utils/TemplateEngine';

export class ClaudeChatProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'equantic-claude-code.chatView';
    private _view?: vscode.WebviewView;
    private messages: ClaudeMessage[] = [];
    private isStreaming: boolean = false;
    private streamingMessageId: string | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private context: vscode.ExtensionContext,
        private claudeManager: ClaudeCodeManager
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Claude Code Chat');
        this.outputChannel.appendLine('🔧 ClaudeChatProvider: Constructor called');
        
        // Listen for new messages from Claude
        const messageDisposable = this.claudeManager.onMessageReceived(message => {
            this.outputChannel.appendLine('📨 ClaudeChatProvider: onMessageReceived fired');
            this.addMessage(message);
        });
        this.outputChannel.appendLine('🔧 ClaudeChatProvider: onMessageReceived listener registered');

        // Listen for streaming messages
        const streamingDisposable = this.claudeManager.onStreamingMessage(streamingMessage => {
            this.outputChannel.appendLine(`🎯 ClaudeChatProvider: Received streaming message: ${streamingMessage.type} - ${streamingMessage.content?.substring(0, 50)}`);
            this.outputChannel.appendLine('🎯 ClaudeChatProvider: About to call handleStreamingMessage');
            this.handleStreamingMessage(streamingMessage);
            this.outputChannel.appendLine('🎯 ClaudeChatProvider: handleStreamingMessage completed');
        });
        this.outputChannel.appendLine('🔧 ClaudeChatProvider: onStreamingMessage listener registered');

        // Listen for streaming progress
        this.claudeManager.onStreamingProgress(progress => {
            this.updateStreamingProgress(progress);
        });

        // Listen for streaming completion
        this.claudeManager.onStreamingComplete(finalMessage => {
            this.finalizeStreamingMessage(finalMessage);
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext<unknown>,
        token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this.context.extensionUri
            ]
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Proactively load recent tasks when webview is created
        setTimeout(() => {
            this.sendRecentTasks();
            this.sendPermissionModeUpdate(); // Send initial permission mode
            this.sendModelUpdate(); // Send initial model
        }, 1000);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleSendMessage(data.message, data.files, data.useStreaming || false);
                    break;
                case 'clearChat':
                    this.clearChat();
                    break;
                case 'getWorkspaceContext':
                    this.sendWorkspaceContext();
                    break;
                case 'loadRecentTasks':
                    this.sendRecentTasks();
                    break;
                case 'loadAllHistory':
                    this.sendAllHistory();
                    break;
                case 'resumeTask':
                    this.resumeTask(data.taskId);
                    break;
                case 'viewAllHistory':
                    this.showAllHistory();
                    break;
                case 'setPermissionMode':
                    this.claudeManager.setPermissionMode(data.mode);
                    this.sendPermissionModeUpdate();
                    break;
                case 'getPermissionMode':
                    this.sendPermissionModeUpdate();
                    break;
                case 'changeModel':
                    this.claudeManager.setModel(data.model);
                    this.sendModelUpdate();
                    break;
            }
        });
    }

    private async handleSendMessage(message: string, files?: string[], useStreaming: boolean = true) {
        try {
            // Start streaming indicator
            this.isStreaming = true;
            this.streamingMessageId = Date.now().toString();

            // Show typing indicator
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'showTyping'
                });
            }

            if (useStreaming) {
                await this.claudeManager.sendMessageStreaming(message, files);
            } else {
                await this.claudeManager.sendMessage(message, files);
                this.isStreaming = false;
                this.streamingMessageId = null;
            }
        } catch (error) {
            this.isStreaming = false;
            this.streamingMessageId = null;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Error sending message: ${errorMessage}`);

            // Hide typing indicator and send error to webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'hideTyping'
                });
                this._view.webview.postMessage({
                    type: 'streamingError',
                    error: errorMessage
                });
            }
        }
    }

    private handleStreamingMessage(streamingMessage: StreamingMessage) {
        if (!this._view || !this.isStreaming) {
            return;
        }

        // Hide typing indicator as soon as we get the first real message
        this._view.webview.postMessage({
            type: 'hideTyping'
        });

        // Process message content based on type
        let processedContent = streamingMessage.content;
        let cssClass = 'streaming-text';

        switch (streamingMessage.type) {
            case 'thinking':
                processedContent = ClaudeOutputParser.formatThinkingText(streamingMessage.content);
                cssClass = 'thinking-text';
                break;
            case 'tool_use':
                if (streamingMessage.metadata?.toolName) {
                    processedContent = ClaudeOutputParser.formatToolUsage(
                        streamingMessage.metadata.toolName,
                        streamingMessage.metadata
                    );
                }
                cssClass = 'tool-usage';
                break;
            case 'tool_result':
                cssClass = 'tool-result';
                break;
            case 'progress':
                cssClass = 'progress-update';
                break;
            case 'text':
            default:
                // Check for ANSI colors and convert
                if (AnsiColorConverter.hasAnsiCodes(streamingMessage.content)) {
                    processedContent = AnsiColorConverter.toStyledSpans(streamingMessage.content);
                }
                break;
        }

        // Send streaming message to webview
        const messageToSend = {
            type: 'streamingMessage',
            messageId: this.streamingMessageId,
            messageType: streamingMessage.type,
            content: processedContent,
            cssClass: cssClass,
            metadata: streamingMessage.metadata
        };
        this.outputChannel.appendLine(`🎯 ClaudeChatProvider: Sending message to webview: ${messageToSend.type} - ${messageToSend.content?.substring(0, 50)}`);
        this.outputChannel.appendLine(`🎯 ClaudeChatProvider: Webview available: ${!!this._view?.webview}`);
        this._view.webview.postMessage(messageToSend);
        this.outputChannel.appendLine('🎯 ClaudeChatProvider: Message posted to webview successfully');
    }

    private updateStreamingProgress(progress: number) {
        if (!this._view || !this.isStreaming) {
            return;
        }

        this._view.webview.postMessage({
            type: 'streamingProgress',
            messageId: this.streamingMessageId,
            progress: progress
        });
    }

    private finalizeStreamingMessage(finalMessage: ClaudeMessage) {
        if (!this._view || !this.isStreaming) {
            return;
        }

        // Hide typing indicator and send finalization message
        this._view.webview.postMessage({
            type: 'hideTyping'
        });
        this._view.webview.postMessage({
            type: 'streamingComplete',
            messageId: this.streamingMessageId,
            finalMessage: finalMessage
        });

        this.isStreaming = false;
        this.streamingMessageId = null;
    }

    private addMessage(message: ClaudeMessage) {
        this.messages.push(message);
        if (this._view) {
            this._view.webview.postMessage({
                type: 'addMessage',
                message: message
            });
        }
    }

    clearChat() {
        this.messages = [];
        if (this._view) {
            this._view.webview.postMessage({
                type: 'clearMessages'
            });
        }
    }

    private sendWorkspaceContext() {
        const context = this.claudeManager.getWorkspaceContext();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'workspaceContext',
                context: context
            });
        }
    }

    private async sendRecentTasks() {
        try {
            console.log('🎯 ClaudeChatProvider: Starting sendRecentTasks');
            const tasks = await this.claudeManager.loadClaudeCodeSessions();
            console.log(`🎯 ClaudeChatProvider: Received ${tasks.length} tasks from manager`);
            
            // Format tasks for display - limit to 4 most recent for welcome screen
            const formattedTasks = tasks.slice(0, 4).map(task => ({
                id: task.id,
                title: task.title || task.messages?.[0]?.content || 'New Task',
                firstMessage: task.messages?.[0]?.content,
                timestamp: task.createdAt || task.updatedAt,
                tokenCount: task.metadata?.tokenCount || 0,
                cacheInfo: task.metadata?.cacheInfo
            }));
            
            console.log(`🎯 ClaudeChatProvider: Formatted ${formattedTasks.length} tasks for display`);
            
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'loadRecentTasks',
                    tasks: formattedTasks
                });
                console.log('🎯 ClaudeChatProvider: Sent loadRecentTasks message to webview');
            } else {
                console.log('🎯 ClaudeChatProvider: No webview available to send tasks');
            }
        } catch (error) {
            console.error('❌ ClaudeChatProvider: Error loading recent tasks:', error);
        }
    }

    private async sendAllHistory() {
        try {
            console.log('🎯 ClaudeChatProvider: Starting sendAllHistory');
            const tasks = await this.claudeManager.loadClaudeCodeSessions();
            console.log(`🎯 ClaudeChatProvider: Received ${tasks.length} total tasks`);
            
            // Format all tasks for history view (no limit)
            const formattedTasks = tasks.map(task => ({
                id: task.id,
                title: task.title || task.messages?.[0]?.content || 'New Task',
                firstMessage: task.messages?.[0]?.content,
                timestamp: task.createdAt || task.updatedAt,
                tokenCount: task.metadata?.tokenCount || 0,
                cacheInfo: task.metadata?.cacheInfo
            }));
            
            console.log(`🎯 ClaudeChatProvider: Formatted ${formattedTasks.length} tasks for history view`);
            
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'loadAllHistory',
                    tasks: formattedTasks
                });
                console.log('🎯 ClaudeChatProvider: Sent loadAllHistory message to webview');
            } else {
                console.log('🎯 ClaudeChatProvider: No webview available to send history');
            }
        } catch (error) {
            console.error('❌ ClaudeChatProvider: Error loading all history:', error);
        }
    }

    private async resumeTask(taskId: string) {
        try {
            // Load the specific task
            const tasks = await this.claudeManager.loadClaudeCodeSessions();
            const task = tasks.find(t => t.id === taskId);
            
            if (task) {
                // Set as current task in manager
                this.claudeManager.setCurrentTask(task);
                
                // Load messages into chat
                this.messages = task.messages || [];
                
                // Tell webview to start chat session
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'startChat',
                        taskId: taskId
                    });
                    
                    // Send existing messages
                    this.messages.forEach(msg => {
                        this._view?.webview.postMessage({
                            type: 'addMessage',
                            message: msg
                        });
                    });
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error resuming task: ${error}`);
        }
    }

    private showAllHistory() {
        vscode.commands.executeCommand('equantic-claude-code.openHistory');
    }

    private sendPermissionModeUpdate() {
        const currentMode = this.claudeManager.getPermissionMode();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'permissionModeUpdate',
                mode: currentMode
            });
        }
    }

    private sendModelUpdate() {
        const currentModel = this.claudeManager.getModel();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'modelUpdate',
                model: currentModel
            });
        }
    }

    private getWebviewContent(webview: vscode.Webview): string {
        try {
            // Use the template system to generate HTML
            return createWebviewTemplate('chat', {
                // Add any dynamic variables here
                extensionName: 'Claude Code Integration',
                version: '0.1.0'
            }, webview);
        } catch (error) {
            // Fallback to simple HTML if template fails
            return '';
        }
    }
}