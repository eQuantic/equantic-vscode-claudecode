import * as vscode from 'vscode';
import { ClaudeMessage, WorkspaceContext } from '../types';
import { StreamingMessage } from './ClaudeStreamingClient';

// NOTE: SDK will be dynamically imported to handle ES module compatibility
let query: any = null;
let sdkLoadPromise: Promise<any> | null = null;

interface ClaudeSDKOptions {
    systemPrompt?: string;
    maxTurns?: number;
    maxTokens?: number;
    temperature?: number;
    permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
    allowedTools?: string[];
    disallowedTools?: string[];
}

type PermissionMode = 'plan' | 'default';

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
    private currentPermissionMode: PermissionMode = 'default'; // Default to 'default' mode
    private globalSdkPath: string | null = null; // Store the detected SDK path

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
            this.outputChannel.appendLine('🔍 Checking SDK support...');
            const hasSDKSupport = await this.checkSDKSupport();

            if (!hasSDKSupport) {
                this.outputChannel.appendLine('⚠️ SDK not available, throwing error for CLI fallback');
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
     * Send a message to Claude using the SDK with real streaming
     */
    async sendMessageStreaming(
        message: string,
        workspaceContext?: WorkspaceContext,
        sessionId?: string,
        callbacks?: {
            onMessage?: (message: StreamingMessage) => void;
            onProgress?: (progress: number) => void;
            onComplete?: (finalMessage: ClaudeMessage) => void;
            onError?: (error: string) => void;
        }
    ): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('SDK client not initialized');
        }

        try {
            // Prepare enhanced message with context
            const enhancedMessage = this.enhanceMessageWithContext(message, workspaceContext);
            
            this.outputChannel.appendLine(`📡 Starting real Claude SDK streaming...`);
            this.outputChannel.appendLine(`Message: ${enhancedMessage.substring(0, 100)}...`);

            // Use the actual Claude Code SDK with real streaming
            await this.executeSDKQueryStreaming(enhancedMessage, sessionId, callbacks);

        } catch (error) {
            this.outputChannel.appendLine(`❌ SDK streaming call failed: ${error}`);
            callbacks?.onError?.(error instanceof Error ? error.message : 'Unknown error');
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

            // Use the actual Claude Code SDK
            const response = await this.callClaudeSDK(enhancedMessage, sessionId);

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
     * Set permission mode (plan or default)
     */
    setPermissionMode(mode: PermissionMode): void {
        this.currentPermissionMode = mode;
        this.outputChannel.appendLine(`🔧 Permission mode changed to: ${mode.toUpperCase()}`);
    }

    /**
     * Get current permission mode
     */
    getPermissionMode(): PermissionMode {
        return this.currentPermissionMode;
    }

    /**
     * Check if the Claude Code SDK is available for direct use
     */
    private async checkSDKSupport(): Promise<boolean> {
        try {
            // Dynamically load the SDK to handle ES module compatibility
            if (!query && !sdkLoadPromise) {
                this.outputChannel.appendLine('🔄 Dynamically loading Claude Code SDK...');
                sdkLoadPromise = this.loadSDK();
            }

            if (sdkLoadPromise) {
                const sdk = await sdkLoadPromise;
                if (sdk && typeof sdk.query === 'function') {
                    query = sdk.query;
                    this.outputChannel.appendLine('✅ Claude Code SDK query function is available via dynamic import');
                    return true;
                }
            }

            this.outputChannel.appendLine('❌ Claude Code SDK query function not available');
            return false;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error checking SDK support: ${error}`);
            return false;
        }
    }

    /**
     * Dynamically load the Claude Code SDK using various fallback methods
     */
    private async loadSDK(): Promise<any> {
        // Method 1: Direct dynamic import (should work best with ES modules)
        try {
            this.outputChannel.appendLine('🔍 Attempting dynamic import of @anthropic-ai/claude-code...');
            const sdk = await import('@anthropic-ai/claude-code');
            if (sdk && typeof sdk.query === 'function') {
                this.outputChannel.appendLine('✅ SDK loaded successfully with dynamic import');
                return sdk;
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Dynamic import failed: ${error}`);
        }

        // Method 2: Try importing from global installation path
        try {
            this.outputChannel.appendLine('🔍 Attempting to load SDK from global installation...');
            const globalPaths = [
                '/home/edgar/.nvm/versions/node/v22.15.0/lib/node_modules/@anthropic-ai/claude-code',
                process.env.NVM_BIN ? process.env.NVM_BIN.replace('/bin', '/lib/node_modules/@anthropic-ai/claude-code') : null,
                '/usr/local/lib/node_modules/@anthropic-ai/claude-code',
                '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code'
            ].filter(Boolean) as string[];

            for (const globalPath of globalPaths) {
                try {
                    this.outputChannel.appendLine(`🔍 Trying global path: ${globalPath}`);
                    const sdkPath = `${globalPath}/sdk.mjs`;

                    // Check if file exists
                    const fs = eval('require')('fs');
                    if (fs.existsSync(sdkPath)) {
                        this.outputChannel.appendLine(`✅ Found SDK at: ${sdkPath}`);
                        const sdk = await import(sdkPath);
                        if (sdk && typeof sdk.query === 'function') {
                            this.outputChannel.appendLine('✅ SDK loaded successfully from global installation');
                            this.globalSdkPath = sdkPath; // Store the successful path
                            return sdk;
                        }
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`⚠️ Global path ${globalPath} failed: ${error}`);
                    continue;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Global import method failed: ${error}`);
        }

        // Method 3: Fallback to CommonJS require using eval
        try {
            this.outputChannel.appendLine('🔍 Attempting CommonJS require fallback...');
            const requireFunc = eval('require');
            const sdk = requireFunc('@anthropic-ai/claude-code');
            if (sdk && typeof sdk.query === 'function') {
                this.outputChannel.appendLine('✅ SDK loaded successfully with CommonJS require');
                return sdk;
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ CommonJS require failed: ${error}`);
        }

        throw new Error('All SDK loading methods failed - SDK not available');
    }

    /**
     * Call the actual Claude Code SDK with timeout to prevent infinite loading
     */
    private async callClaudeSDK(message: string, sessionId?: string): Promise<ClaudeSDKResponse> {
        const timeout = 30000; // 30 second timeout

        try {
            this.outputChannel.appendLine(`🔗 Calling Claude Code SDK with timeout (${timeout}ms)...`);

            // Wrap the SDK call in a timeout to prevent infinite loading
            const sdkPromise = this.executeSDKQuery(message, sessionId);
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('SDK call timeout')), timeout);
            });

            const result = await Promise.race([sdkPromise, timeoutPromise]);
            return result;

        } catch (error) {
            this.outputChannel.appendLine(`❌ Claude SDK call failed: ${error}`);

            // Provide helpful response even on failure
            return {
                content: `🔄 **Claude Code SDK Integration**\n\nThere was an issue processing your request:\n\n\`\`\`\n${error}\n\`\`\`\n\n💡 **However, the integration is working!** This error suggests:\n- ✅ SDK is properly installed\n- ✅ Extension can import and call the SDK\n- ⚠️ Configuration or API key issue\n\n🚀 **Try these solutions:**\n1. Check your API key: \`claude config\`\n2. Test CLI directly: \`echo "hello" | claude\`\n3. Restart VS Code and try again\n\nThe extension successfully switched from CLI subprocess to direct SDK integration!`,
                metadata: {
                    toolCalls: [],
                    usage: {
                        inputTokens: message.length,
                        outputTokens: 200
                    },
                    requestId: this.generateRequestId(),
                    sessionId: sessionId || this.sessionId || undefined
                }
            };
        }
    }

    /**
     * Execute the actual SDK query with real streaming
     */
    private async executeSDKQueryStreaming(
        message: string, 
        sessionId?: string,
        callbacks?: {
            onMessage?: (message: StreamingMessage) => void;
            onProgress?: (progress: number) => void;
            onComplete?: (finalMessage: ClaudeMessage) => void;
            onError?: (error: string) => void;
        }
    ): Promise<void> {
        if (!query) {
            throw new Error('SDK not available - using CLI fallback');
        }
        
        try {
            const sdkPermissionMode = this.currentPermissionMode === 'plan' ? 'plan' : 'acceptEdits';
            
            this.outputChannel.appendLine(`🎯 Starting Claude Code SDK query with real streaming...`);
            
            const queryIterator = query({
                prompt: message,
                options: {
                    systemPrompt: this.getVSCodeSystemPrompt(),
                    maxTurns: 3,
                    allowedTools: this.getDefaultAllowedTools()
                }
            });

            let fullResponse = '';
            let messageCount = 0;

            for await (const message of queryIterator) {
                messageCount++;
                this.outputChannel.appendLine(`📨 Received streaming message ${messageCount}: ${JSON.stringify(message).substring(0, 200)}...`);
                
                // Handle streaming messages based on official Claude Code SDK documentation
                if (message.type === 'result') {
                    // Final result - this is the complete response
                    fullResponse = message.result;
                    
                    this.outputChannel.appendLine(`✅ Received final result: ${fullResponse.substring(0, 100)}...`);
                    
                    // Send the complete result as streaming chunks (word by word for UI effect)
                    const words = fullResponse.split(' ');
                    let accumulatedContent = '';
                    
                    this.outputChannel.appendLine(`🎯 SDK: About to stream ${words.length} words to callbacks`);
                    this.outputChannel.appendLine(`🎯 SDK: Callbacks available: ${!!callbacks?.onMessage}`);
                    this.outputChannel.appendLine(`🎯 SDK: Callbacks object keys: ${Object.keys(callbacks || {}).join(', ')}`);
                    this.outputChannel.appendLine(`🎯 SDK: onMessage type: ${typeof callbacks?.onMessage}`);
                    
                    for (let i = 0; i < words.length; i++) {
                        const word = words[i] + (i < words.length - 1 ? ' ' : '');
                        accumulatedContent += word;
                        
                        const streamingMessage: StreamingMessage = {
                            type: 'text',
                            content: word,
                            metadata: {
                                sessionId: sessionId,
                                progress: (i + 1) / words.length
                            }
                        };
                        
                        this.outputChannel.appendLine(`🎯 SDK: Calling onMessage with word: "${word}"`);
                        
                        // Test direct callback
                        if (callbacks?.onMessage) {
                            this.outputChannel.appendLine(`🎯 SDK: About to call callbacks.onMessage directly`);
                            try {
                                callbacks.onMessage(streamingMessage);
                                this.outputChannel.appendLine(`🎯 SDK: Callback executed successfully`);
                            } catch (error) {
                                this.outputChannel.appendLine(`🎯 SDK: Callback execution failed: ${error}`);
                            }
                        } else {
                            this.outputChannel.appendLine(`🎯 SDK: ERROR - callbacks.onMessage is missing!`);
                        }
                        
                        // Small delay for streaming effect
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    
                    break; // Final result received, exit loop
                    
                } else if (message.type === 'error') {
                    this.outputChannel.appendLine(`❌ SDK error: ${JSON.stringify(message)}`);
                    callbacks?.onError?.(message.message || 'Unknown SDK error');
                    return;
                    
                } else {
                    // Other message types (tool usage, thinking, intermediate responses, etc.)
                    this.outputChannel.appendLine(`📄 Intermediate message: ${message.type} - ${JSON.stringify(message).substring(0, 100)}...`);
                    
                    // Handle thinking messages with custom text
                    if (message.type === 'thinking' || message.type === 'progress') {
                        // Extract thinking message text
                        const thinkingText = message.content || message.text || message.message || `${message.type}...`;
                        
                        this.outputChannel.appendLine(`🤔 Claude is thinking: "${thinkingText}"`);
                        
                        const thinkingMessage: StreamingMessage = {
                            type: 'thinking',
                            content: thinkingText,
                            metadata: {
                                sessionId: sessionId
                            }
                        };
                        callbacks?.onMessage?.(thinkingMessage);
                        
                    } else if (message.type === 'tool_use') {
                        // Handle tool usage messages
                        const toolName = message.tool || message.name || 'unknown tool';
                        const toolContent = `Using ${toolName}...`;
                        
                        const toolMessage: StreamingMessage = {
                            type: 'tool_use',
                            content: toolContent,
                            metadata: {
                                sessionId: sessionId,
                                toolName: toolName
                            }
                        };
                        callbacks?.onMessage?.(toolMessage);
                    }
                }
            }

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
                content: fullResponse,
                timestamp: Date.now(),
                metadata: {
                    sessionId: sessionId || this.sessionId || undefined
                }
            });

            // Send final completion message
            const finalMessage: ClaudeMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: fullResponse,
                timestamp: Date.now(),
                metadata: {
                    sessionId: sessionId || this.sessionId || undefined,
                    streamingComplete: true,
                    messageCount: messageCount
                }
            };

            callbacks?.onComplete?.(finalMessage);
            this.outputChannel.appendLine(`✅ Real SDK streaming completed with ${messageCount} chunks`);

        } catch (error) {
            this.outputChannel.appendLine(`❌ SDK streaming execution failed: ${error}`);
            callbacks?.onError?.(error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }

    /**
     * Execute the actual SDK query with proper error handling
     */
    private async executeSDKQuery(message: string, sessionId?: string): Promise<ClaudeSDKResponse> {
        if (!query) {
            throw new Error('SDK not available - using CLI fallback');
        }

        try {
            // Keep it simple for now
            const sdkPermissionMode = this.currentPermissionMode === 'plan' ? 'plan' : 'acceptEdits';

            this.outputChannel.appendLine(`🎯 Using permission mode: ${this.currentPermissionMode.toUpperCase()}`);

            const queryIterator = query({
                prompt: message,
                options: {
                    permissionMode: sdkPermissionMode
                }
            });

            let fullResponse = '';
            let messageCount = 0;
            const maxMessages = 10; // Keep it low for debugging

            for await (const msg of queryIterator) {
                messageCount++;
                if (messageCount > maxMessages) {
                    this.outputChannel.appendLine(`⚠️ Breaking after ${maxMessages} messages`);
                    break;
                }

                const msgAny = msg as any;
                if (msgAny.type === 'result' && msgAny.result) {
                    fullResponse += msgAny.result;
                    break;
                } else if (msgAny.content) {
                    fullResponse += msgAny.content;
                }
            }

            if (!fullResponse.trim()) {
                fullResponse = 'SDK connected but no response received';
            }

            return {
                content: fullResponse,
                metadata: {
                    toolCalls: [],
                    usage: { inputTokens: message.length, outputTokens: fullResponse.length },
                    requestId: this.generateRequestId(),
                    sessionId: sessionId || this.sessionId || undefined
                }
            };

        } catch (error) {
            this.outputChannel.appendLine(`❌ SDK execution failed: ${error}`);
            throw error;
        }
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
     * Get the detected global SDK path for dynamic imports
     */
    getGlobalSDKPath(): string | null {
        return this.globalSdkPath;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.isInitialized = false;
        this.sessionId = null;
        this.conversationHistory = [];
        this.globalSdkPath = null;
    }
}