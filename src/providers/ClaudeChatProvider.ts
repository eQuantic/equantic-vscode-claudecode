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

    constructor(
        private context: vscode.ExtensionContext,
        private claudeManager: ClaudeCodeManager
    ) {
        // Listen for new messages from Claude
        this.claudeManager.onMessageReceived(message => {
            this.addMessage(message);
        });

        // Listen for streaming messages
        this.claudeManager.onStreamingMessage(streamingMessage => {
            this.handleStreamingMessage(streamingMessage);
        });

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
        this._view.webview.postMessage({
            type: 'streamingMessage',
            messageId: this.streamingMessageId,
            messageType: streamingMessage.type,
            content: processedContent,
            cssClass: cssClass,
            metadata: streamingMessage.metadata
        });
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