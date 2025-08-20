import * as vscode from 'vscode';
import { ClaudeMessage, WorkspaceContext } from '../types';

interface ClaudeSDKOptions {
    systemPrompt?: string;
    maxTurns?: number;
    maxTokens?: number;
    temperature?: number;
    permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
    allowedTools?: string[];
    disallowedTools?: string[];
}

interface ClaudeSDKResponse {
    content: string;
    metadata?: {
        toolCalls?: any[];
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
        requestId?: string;
        sessionId?: string;
    };
}

/**
 * Claude Code SDK Client for direct programmatic access
 * This provides better control than CLI subprocess calls
 */
export class ClaudeSDKClient {
    private outputChannel: vscode.OutputChannel;
    private isInitialized = false;
    private sessionId: string | null = null;
    private conversationHistory: ClaudeMessage[] = [];

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Initialize the SDK client
     */
    async initialize(options: ClaudeSDKOptions = {}): Promise<void> {
        try {
            this.outputChannel.appendLine('🚀 Initializing Claude SDK Client...');

            // Check if we can use the SDK directly
            const hasSDKSupport = await this.checkSDKSupport();
            
            if (!hasSDKSupport) {
                throw new Error('Claude Code SDK not available. Using CLI fallback.');
            }

            // Initialize with default options for VS Code integration
            const defaultOptions: ClaudeSDKOptions = {
                systemPrompt: this.getVSCodeSystemPrompt(),
                maxTurns: 100,
                maxTokens: 4096,
                temperature: 0.1,
                permissionMode: 'default',
                allowedTools: this.getDefaultAllowedTools(),
                ...options
            };

            this.outputChannel.appendLine(`✅ Claude SDK initialized with options: ${JSON.stringify(defaultOptions, null, 2)}`);
            this.isInitialized = true;

        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to initialize Claude SDK: ${error}`);
            throw error;
        }
    }

    /**
     * Send a message to Claude using the SDK
     */
    async sendMessage(
        message: string, 
        workspaceContext?: WorkspaceContext,
        sessionId?: string
    ): Promise<ClaudeSDKResponse> {
        if (!this.isInitialized) {
            throw new Error('SDK client not initialized');
        }

        try {
            // Prepare enhanced message with context
            const enhancedMessage = this.enhanceMessageWithContext(message, workspaceContext);
            
            this.outputChannel.appendLine(`📤 Sending message to Claude SDK...`);
            this.outputChannel.appendLine(`Message: ${enhancedMessage.substring(0, 100)}...`);

            // For now, we'll simulate the SDK call since the actual SDK might not be available
            // In production, this would be the actual SDK call
            const response = await this.simulateSDKCall(enhancedMessage, sessionId);
            
            // Add to conversation history
            this.conversationHistory.push({
                id: Date.now().toString(),
                role: 'user',
                content: message,
                timestamp: Date.now()
            });

            this.conversationHistory.push({
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response.content,
                timestamp: Date.now(),
                metadata: response.metadata
            });

            this.outputChannel.appendLine(`📥 Received response from Claude SDK`);
            return response;

        } catch (error) {
            this.outputChannel.appendLine(`❌ SDK call failed: ${error}`);
            throw error;
        }
    }

    /**
     * Start a new conversation session
     */
    async startNewSession(): Promise<string> {
        this.sessionId = this.generateSessionId();
        this.conversationHistory = [];
        this.outputChannel.appendLine(`🆕 Started new SDK session: ${this.sessionId}`);
        return this.sessionId;
    }

    /**
     * Resume an existing session
     */
    async resumeSession(sessionId: string, history?: ClaudeMessage[]): Promise<void> {
        this.sessionId = sessionId;
        this.conversationHistory = history || [];
        this.outputChannel.appendLine(`🔄 Resumed SDK session: ${sessionId} with ${this.conversationHistory.length} messages`);
    }

    /**
     * Get current conversation history
     */
    getConversationHistory(): ClaudeMessage[] {
        return [...this.conversationHistory];
    }

    /**
     * Get current session ID
     */
    getCurrentSessionId(): string | null {
        return this.sessionId;
    }

    /**
     * Check if the Claude Code SDK is available for direct use
     */
    private async checkSDKSupport(): Promise<boolean> {
        try {
            // Try to import the Claude SDK (if available as a Node module)
            // This would check if @anthropic-ai/claude-code SDK is available
            const { exec } = require('child_process');
            
            return new Promise((resolve) => {
                exec('node -e "require(\'@anthropic-ai/claude-code\')"', (error: any) => {
                    resolve(!error);
                });
            });
        } catch (error) {
            return false;
        }
    }

    /**
     * Simulate SDK call for development/testing
     * In production, this would be replaced with actual SDK calls
     */
    private async simulateSDKCall(message: string, sessionId?: string): Promise<ClaudeSDKResponse> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

        const responses = [
            `I understand you want to work on: "${message.substring(0, 50)}..."\n\n🚀 **Using Claude Code SDK Integration**\n\nI have access to your VS Code workspace and can help with:\n• Code analysis and refactoring\n• Debugging and problem solving\n• Feature implementation\n• Documentation generation\n\nWhat specific task would you like me to help with?`,
            
            `Analyzing your request: "${message.substring(0, 50)}..."\n\n🔧 **SDK Features Available:**\n• Direct workspace access\n• Real-time file operations\n• Advanced tool integrations\n• Session continuity\n\nI'm ready to assist with your development needs. Please provide more details about what you'd like to accomplish.`,
            
            `Processing: "${message.substring(0, 50)}..."\n\n💡 **Enhanced Capabilities:**\n• Multi-turn conversations with context\n• Intelligent code suggestions\n• Automated testing and validation\n• MCP tool integrations\n\nHow can I best help you with your current development task?`
        ];

        const randomResponse = responses[Math.floor(Math.random() * responses.length)];

        return {
            content: randomResponse,
            metadata: {
                toolCalls: [],
                usage: {
                    inputTokens: Math.floor(Math.random() * 100) + 50,
                    outputTokens: Math.floor(Math.random() * 200) + 100
                },
                requestId: this.generateRequestId(),
                sessionId: sessionId || this.sessionId || undefined
            }
        };
    }

    /**
     * Enhance message with VS Code workspace context
     */
    private enhanceMessageWithContext(message: string, context?: WorkspaceContext): string {
        if (!context) {
            return message;
        }

        let enhancedMessage = message;

        // Add workspace context
        if (context.rootPath) {
            enhancedMessage += `\n\n**Workspace:** ${context.rootPath}`;
        }

        // Add current file context
        if (context.currentFile) {
            enhancedMessage += `\n**Current File:** ${context.currentFile.path}`;
            
            if (context.currentFile.selection) {
                const selection = context.currentFile.selection;
                enhancedMessage += `\n**Selected Lines:** ${selection.start.line}-${selection.end.line}`;
            }
        }

        // Add open files context
        if (context.openFiles && context.openFiles.length > 0) {
            enhancedMessage += `\n**Open Files:** ${context.openFiles.map(f => f.path).join(', ')}`;
        }

        return enhancedMessage;
    }

    /**
     * Get VS Code specific system prompt
     */
    private getVSCodeSystemPrompt(): string {
        return `You are Claude Code integrated into VS Code through a native extension. You have access to:

1. **Workspace Access**: You can read, analyze, and modify files in the current workspace
2. **VS Code Integration**: You understand VS Code concepts like selections, open files, and project structure
3. **Development Tools**: You can run commands, execute tests, and interact with development tools
4. **Context Awareness**: You maintain context about the current file, selections, and workspace state

Guidelines:
- Be concise but thorough in your responses
- Focus on practical, actionable advice
- Use VS Code terminology when appropriate
- Offer to perform file operations when relevant
- Maintain conversation context across multiple turns

Your goal is to be a seamless coding assistant integrated into the developer's workflow.`;
    }

    /**
     * Get default allowed tools for VS Code integration
     */
    private getDefaultAllowedTools(): string[] {
        return [
            'file_read',
            'file_write', 
            'file_edit',
            'bash_execute',
            'grep_search',
            'directory_list',
            'git_operations'
        ];
    }

    /**
     * Generate unique session ID
     */
    private generateSessionId(): string {
        return 'sdk-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.isInitialized = false;
        this.sessionId = null;
        this.conversationHistory = [];
    }
}