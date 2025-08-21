import * as vscode from 'vscode';
import * as pty from 'node-pty';
import { ClaudeMessage, ClaudeTask, ClaudeCodeConfig, WorkspaceContext } from '../types';
import { ClaudeSessionManager } from './ClaudeSessionManager';
import { ClaudeInstallationDetector, ClaudeInstallation } from './ClaudeInstallationDetector';
import { ClaudeSDKClient } from './ClaudeSDKClient';
import { ClaudeStreamingClient, StreamingCallbacks, StreamingMessage } from './ClaudeStreamingClient';

export class ClaudeCodeManager implements vscode.Disposable {
    private terminal: pty.IPty | null = null;
    private currentTask: ClaudeTask | null = null;
    private tasks: ClaudeTask[] = [];
    private config: ClaudeCodeConfig = {
        claudeExecutablePath: 'claude',
        autoStart: true,
        maxTokens: 4096,
        temperature: 0.1,
        showNotifications: true
    };
    private outputChannel: vscode.OutputChannel;
    private isInitialized = false;
    private sessionManager: ClaudeSessionManager;
    private installationDetector: ClaudeInstallationDetector;
    private installation: ClaudeInstallation | null = null;
    private sdkClient: ClaudeSDKClient;
    private streamingClient: ClaudeStreamingClient;
    private useSDK: boolean = false;

    private _onTaskUpdate = new vscode.EventEmitter<ClaudeTask>();
    public readonly onTaskUpdate = this._onTaskUpdate.event;

    private _onMessageReceived = new vscode.EventEmitter<ClaudeMessage>();
    public readonly onMessageReceived = this._onMessageReceived.event;

    private _onStreamingMessage = new vscode.EventEmitter<StreamingMessage>();
    public readonly onStreamingMessage = this._onStreamingMessage.event;

    private _onStreamingProgress = new vscode.EventEmitter<number>();
    public readonly onStreamingProgress = this._onStreamingProgress.event;

    private _onStreamingComplete = new vscode.EventEmitter<ClaudeMessage>();
    public readonly onStreamingComplete = this._onStreamingComplete.event;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Claude Code');
        this.installationDetector = new ClaudeInstallationDetector(this.outputChannel);
        this.sessionManager = new ClaudeSessionManager(this.outputChannel);
        this.sdkClient = new ClaudeSDKClient(this.outputChannel);
        this.streamingClient = new ClaudeStreamingClient(this.outputChannel);
        this.updateConfig();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('equantic-claude-code')) {
                this.updateConfig();
            }
        });
    }

    private updateConfig() {
        const config = vscode.workspace.getConfiguration('equantic-claude-code');
        this.config = {
            claudeExecutablePath: config.get('claudeExecutablePath', 'claude'),
            autoStart: config.get('autoStart', true),
            maxTokens: config.get('maxTokens', 4096),
            temperature: config.get('temperature', 0.1),
            showNotifications: config.get('showNotifications', true)
        };
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        this.outputChannel.appendLine('🚀 Initializing Claude Code Manager...');

        try {
            // Step 1: Try to initialize SDK (now with global path detection)
            this.outputChannel.appendLine('🎯 Attempting to initialize Claude Code SDK from global installation...');
            try {
                // Increased timeout since global import might take longer
                const sdkInitPromise = this.sdkClient.initialize({
                    maxTokens: this.config.maxTokens,
                    temperature: this.config.temperature
                });

                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('SDK initialization timeout')), 10000); // 10 seconds
                });

                await Promise.race([sdkInitPromise, timeoutPromise]);
                this.useSDK = true;
                this.outputChannel.appendLine('✨ Successfully initialized Claude Code SDK from global installation!');
            } catch (sdkError) {
                this.outputChannel.appendLine(`⚠️  SDK initialization failed: ${sdkError}. Falling back to CLI...`);
                this.useSDK = false;
            }

            // Step 2: Detect Claude Code installation (needed for CLI fallback and session management)
            this.outputChannel.appendLine('🔍 Detecting Claude Code installation...');
            this.installation = await this.installationDetector.detectInstallation();

            if (!this.useSDK && !this.installation.isWorking) {
                throw new Error(`Claude Code installation not working and SDK not available: ${this.installation.executablePath}`);
            }

            // Step 3: Update session manager with correct paths
            this.sessionManager = new ClaudeSessionManager(this.outputChannel, this.installation?.projectsDir);

            // Step 4: Update config with detected executable (for CLI fallback)
            if (this.installation) {
                this.config.claudeExecutablePath = this.installation.executablePath;
            }

            // Step 5: Start Claude session
            this.outputChannel.appendLine('🌟 Starting Claude Code session...');
            await this.startClaudeSession();
            this.isInitialized = true;

            // Step 6: Show success message with installation info
            const installationInfo = this.installation ? this.installationDetector.getInstallationInfo(this.installation) : 'SDK Only Mode';
            const integrationMode = this.useSDK ? '🎯 **Integration Mode:** Claude Code SDK (Preferred)' : '🔧 **Integration Mode:** Claude Code CLI (Fallback)';
            this.outputChannel.appendLine(`✅ Claude Code initialized successfully!\n\n${integrationMode}\n\n${installationInfo}`);

            if (this.config.showNotifications) {
                vscode.window.showInformationMessage(`Claude Code (${this.installation.type}) initialized successfully!`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`❌ Error initializing Claude Code: ${errorMessage}`);

            // Try to provide helpful suggestions
            const suggestions = await this.installationDetector.diagnoseProblem();
            if (suggestions.length > 0) {
                this.outputChannel.appendLine('\n💡 Suggestions:');
                suggestions.forEach((suggestion, index) => {
                    this.outputChannel.appendLine(`${index + 1}. ${suggestion}`);
                });
            }

            vscode.window.showErrorMessage(`Failed to initialize Claude Code: ${errorMessage}`, 'Show Output')
                .then(action => {
                    if (action === 'Show Output') {
                        this.outputChannel.show();
                    }
                });
        }
    }

    private async startClaudeSession(): Promise<void> {
        // For now, we'll simulate a successful connection
        // In a production version, this would establish the actual PTY connection
        this.outputChannel.appendLine('Simulating Claude Code connection...');

        // Simulate some delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        this.outputChannel.appendLine('Claude Code connection established (simulated)');
    }

    private handleTerminalOutput(data: string) {
        this.outputChannel.append(data);

        // Parse Claude's responses and tool calls
        try {
            const lines = data.split('\n').filter(line => line.trim());
            for (const line of lines) {
                if (this.isJsonMessage(line)) {
                    const message = this.parseClaudeMessage(line);
                    if (message) {
                        this._onMessageReceived.fire(message);
                        this.updateCurrentTask(message);
                    }
                }
            }
        } catch (error) {
            // Ignore parsing errors for non-JSON output
        }
    }

    private isJsonMessage(line: string): boolean {
        const trimmed = line.trim();
        return trimmed.startsWith('{') && trimmed.endsWith('}');
    }

    private parseClaudeMessage(line: string): ClaudeMessage | null {
        try {
            const data = JSON.parse(line);
            if (data.role && data.content) {
                return {
                    id: data.id || Date.now().toString(),
                    role: data.role,
                    content: data.content,
                    timestamp: Date.now(),
                    files: data.files,
                    metadata: data.metadata
                };
            }
        } catch (error) {
            // Not a valid Claude message
        }
        return null;
    }

    async sendMessage(message: string, files?: string[]): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('Claude Code session not started');
        }

        const userMessage: ClaudeMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: message,
            timestamp: Date.now(),
            files
        };

        // Add user message to current task
        this.updateCurrentTask(userMessage);
        this.outputChannel.appendLine(`User: ${message}`);

        // Use SDK if available, otherwise fallback to CLI
        if (this.useSDK) {
            await this.callClaudeSDK(message, files);
        } else {
            await this.callClaudeCodeCLI(message, files);
        }
    }

    /**
     * Send message with streaming response showing thinking process
     */
    async sendMessageStreaming(message: string, files?: string[]): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('Claude Code session not started');
        }

        const userMessage: ClaudeMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: message,
            timestamp: Date.now(),
            files
        };

        // Add user message to current task
        this.updateCurrentTask(userMessage);
        this.outputChannel.appendLine(`User: ${message}`);

        // Get workspace context and session ID
        const workspaceContext = this.getWorkspaceContext();
        const currentSessionId = this.currentTask?.metadata?.sessionId;

        // SOLUÇÃO DEFINITIVA: Usar API query correta do SDK com async iteration
        if (this.useSDK) {
            console.log('🚀 ClaudeCodeManager: Using correct SDK query API with async iteration');
            await this.callClaudeSDKQueryAPI(message, files, workspaceContext, currentSessionId);
        } else {
            console.log('🚀 ClaudeCodeManager: Using CLI streaming solution');
            await this.callClaudeCodeCLIStreaming(message, files, workspaceContext, currentSessionId);
        }
    }

    /**
     * New SDK implementation using correct query API with async iteration
     */
    private async callClaudeSDKQueryAPI(
        message: string,
        files?: string[],
        workspaceContext?: WorkspaceContext,
        currentSessionId?: string
    ): Promise<void> {
        try {
            console.log('🎆 SDK Query API: Starting correct streaming implementation');
            this.outputChannel.appendLine(`🎆 Starting SDK query API streaming...`);
            
            // Import the query function using dynamic global path detection
            const sdkPath = this.sdkClient.getGlobalSDKPath();
            if (!sdkPath) {
                throw new Error('SDK path not available');
            }
            const sdkModule = await import(sdkPath);
            const { query } = sdkModule;
            
            // Prepare context message
            let contextMessage = message;
            if (workspaceContext?.currentFile) {
                contextMessage += `\n\nCurrent file: ${workspaceContext.currentFile.path}`;
                
                if (workspaceContext.currentFile.selection) {
                    const selection = workspaceContext.currentFile.selection;
                    const content = workspaceContext.currentFile.content || '';
                    const lines = content.split('\n');
                    const selectedLines = lines.slice(selection.start.line, selection.end.line + 1);
                    contextMessage += `\n\nSelected code:\n\`\`\`\n${selectedLines.join('\n')}\n\`\`\``;
                }
            }
            
            if (workspaceContext?.rootPath) {
                contextMessage += `\n\nProject: ${workspaceContext.rootPath}`;
            }
            
            // Use the correct query API with async iteration
            console.log('🎆 SDK Query: About to start async iteration...');
            const queryIterable = query({
                prompt: contextMessage,
                options: {
                    permissionMode: this.getPermissionMode() || 'default',
                    maxTurns: 5
                }
            });
            
            console.log('🎆 SDK Query: Query iterable created, starting loop...');
            let messageCount = 0;
            
            for await (const sdkMessage of queryIterable) {
                messageCount++;
                console.log(`🎆 SDK Query: Received message #${messageCount}, type:`, sdkMessage.type);
                console.log('🎆 SDK Query: Full message:', JSON.stringify(sdkMessage, null, 2));
                this.outputChannel.appendLine(`SDK Message #${messageCount}: ${sdkMessage.type} - ${JSON.stringify(sdkMessage).substring(0, 200)}...`);
                
                // DEBUG: Test all conditions
                console.log('🔴 CONDITION TEST:');
                console.log('  - type === "system":', sdkMessage.type === 'system');
                console.log('  - type === "assistant":', sdkMessage.type === 'assistant');
                console.log('  - type === "user":', sdkMessage.type === 'user');
                console.log('  - type === "result":', sdkMessage.type === 'result');
                console.log('  - actual type:', JSON.stringify(sdkMessage.type));
                
                if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
                    console.log('🎆 SDK System Init:', {
                        model: sdkMessage.model,
                        permissionMode: sdkMessage.permissionMode,
                        tools: sdkMessage.tools?.length || 0,
                        mcp_servers: sdkMessage.mcp_servers?.length || 0
                    });
                } else if (sdkMessage.type === 'assistant') {
                    console.log('🔥 FOUND ASSISTANT MESSAGE!');
                    console.log('🎆 Processing assistant message...');
                    // Assistant message from Claude - this contains the actual response content
                    const content = sdkMessage.message.content;
                    console.log('🎆 Content type:', Array.isArray(content) ? 'array' : typeof content);
                    console.log('🎆 Content:', content);
                    
                    if (Array.isArray(content)) {
                        console.log(`🎆 Processing ${content.length} content blocks...`);
                        // Handle content blocks
                        for (const block of content) {
                            console.log('🎆 Block type:', block.type);
                            if (block.type === 'text') {
                                console.log('🎆 Emitting text block:', block.text?.substring(0, 50));
                                this.emitStreamingMessage({
                                    type: 'text',
                                    content: block.text
                                });
                            } else if (block.type === 'tool_use') {
                                console.log('🎆 Emitting tool_use block:', block.name);
                                this.emitStreamingMessage({
                                    type: 'tool_use',
                                    content: `Using tool: ${block.name}`,
                                    metadata: {
                                        toolName: block.name
                                    }
                                });
                            }
                        }
                    } else if (typeof content === 'string') {
                        console.log('🎆 Emitting string content:', content?.substring(0, 50));
                        this.emitStreamingMessage({
                            type: 'text',
                            content: content
                        });
                    } else {
                        console.log('🎆 Unknown content format:', typeof content, content);
                    }
                } else if (sdkMessage.type === 'user') {
                    // User message echo - usually not needed for display
                    console.log('🎆 SDK User message echo');
                } else if (sdkMessage.type === 'result') {
                    // Final result message
                    if (sdkMessage.subtype === 'success') {
                        console.log('🎆 SDK Success result:', {
                            duration: sdkMessage.duration_ms,
                            turns: sdkMessage.num_turns,
                            cost: sdkMessage.total_cost_usd
                        });
                        
                        // The result contains the final formatted output
                        if (sdkMessage.result) {
                            this.emitStreamingMessage({
                                type: 'text',
                                content: sdkMessage.result
                            });
                        }
                    } else {
                        // Error result
                        console.log('🎆 SDK Error result:', sdkMessage.subtype);
                        this.emitStreamingMessage({
                            type: 'text',
                            content: `Error: ${sdkMessage.subtype}`
                        });
                    }
                }
            }
            
            console.log(`🎉 SDK Query API: Streaming completed successfully - processed ${messageCount} messages`);
            this.outputChannel.appendLine(`✅ SDK query API streaming completed successfully - processed ${messageCount} messages`);
            
            // Emit completion
            const finalMessage: ClaudeMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: `SDK streaming response completed`,
                timestamp: Date.now(),
                metadata: {
                    sessionId: currentSessionId
                }
            };
            
            this.updateCurrentTask(finalMessage);
            this._onStreamingComplete.fire(finalMessage);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.log('❌ SDK Query API failed:', errorMessage);
            this.outputChannel.appendLine(`❌ SDK query API failed: ${errorMessage}`);
            
            // Disable SDK and fallback to CLI
            this.useSDK = false;
            this.outputChannel.appendLine(`⚠️  Disabling SDK mode, will use CLI fallback`);
            
            // Try CLI as fallback
            await this.callClaudeCodeCLIStreaming(message, files, workspaceContext, currentSessionId);
        }
    }

    /**
     * Emit streaming message (central point for all streaming events)
     */
    private emitStreamingMessage(message: StreamingMessage): void {
        console.log('🚀 Emitting streaming message:', message.type, message.content?.substring(0, 100));
        console.log('🚀 Event emitter has listeners:', this._onStreamingMessage.event !== undefined);
        this._onStreamingMessage.fire(message);
        console.log('🚀 Event fired successfully');
    }

    /**
     * CLI-based streaming implementation as fallback
     */
    private async callClaudeCodeCLIStreaming(
        message: string,
        files?: string[],
        workspaceContext?: WorkspaceContext,
        currentSessionId?: string
    ): Promise<void> {
        const { spawn } = require('child_process');
        
        // Prepare context for Claude
        let contextMessage = message;
        
        if (workspaceContext?.currentFile) {
            contextMessage += `\n\nCurrent file: ${workspaceContext.currentFile.path}`;
            
            if (workspaceContext.currentFile.selection) {
                const selection = workspaceContext.currentFile.selection;
                const content = workspaceContext.currentFile.content || '';
                const lines = content.split('\n');
                const selectedLines = lines.slice(selection.start.line, selection.end.line + 1);
                contextMessage += `\n\nSelected code:\n\`\`\`\n${selectedLines.join('\n')}\n\`\`\``;
            }
        }
        
        if (workspaceContext?.rootPath) {
            contextMessage += `\n\nProject: ${workspaceContext.rootPath}`;
        }
        
        console.log('🚀 CLI Streaming: Starting real Claude Code streaming...');
        this.outputChannel.appendLine(`📵 Starting CLI streaming for: ${message}`);
        
        // Use CLI with streaming output (requires --verbose with --output-format=stream-json)
        const claudeArgs = ['--print', '--verbose', '--output-format', 'stream-json'];
        if (currentSessionId) {
            claudeArgs.push('--session-id', currentSessionId);
        }
        
        const claudeProcess = spawn(this.config.claudeExecutablePath, claudeArgs, {
            cwd: workspaceContext?.rootPath || process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Send message to Claude
        claudeProcess.stdin.write(contextMessage);
        claudeProcess.stdin.end();
        
        let buffer = '';
        
        claudeProcess.stdout.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            
            // Process complete JSON lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const data = JSON.parse(line);
                        this.processStreamingJSON(data);
                    } catch (error) {
                        // Not JSON, treat as regular text
                        if (line.trim()) {
                            this.emitStreamingMessage({
                                type: 'text',
                                content: line.trim()
                            });
                        }
                    }
                }
            }
        });
        
        claudeProcess.stderr.on('data', (data: Buffer) => {
            const errorText = data.toString();
            console.log('🔥 CLI Streaming Error:', errorText);
            this.outputChannel.appendLine(`❌ CLI Error: ${errorText}`);
        });
        
        return new Promise((resolve, reject) => {
            claudeProcess.on('close', (code: number) => {
                // Process any remaining buffer content
                if (buffer.trim()) {
                    try {
                        const data = JSON.parse(buffer);
                        this.processStreamingJSON(data);
                    } catch (error) {
                        // Treat as final text
                        this.emitStreamingMessage({
                            type: 'text',
                            content: buffer.trim()
                        });
                    }
                }
                
                if (code === 0) {
                    console.log('🎉 CLI Streaming completed successfully');
                    this.outputChannel.appendLine(`✅ CLI streaming completed successfully`);
                    
                    // Emit completion
                    const finalMessage: ClaudeMessage = {
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: `Streaming response completed`,
                        timestamp: Date.now(),
                        metadata: {
                            sessionId: currentSessionId
                        }
                    };
                    
                    this.updateCurrentTask(finalMessage);
                    this._onStreamingComplete.fire(finalMessage);
                    
                    resolve();
                } else {
                    const error = `Claude Code process exited with code ${code}`;
                    console.log('❌ CLI Streaming failed:', error);
                    this.outputChannel.appendLine(`❌ CLI streaming failed: ${error}`);
                    reject(new Error(error));
                }
            });
            
            claudeProcess.on('error', (error: Error) => {
                console.log('❌ CLI Process Error:', error);
                this.outputChannel.appendLine(`❌ CLI process error: ${error}`);
                reject(error);
            });
        });
    }
    
    /**
     * Process streaming JSON from Claude Code CLI
     */
    private processStreamingJSON(data: any): void {
        console.log('📝 Processing CLI JSON:', data);
        
        if (data.type === 'thinking') {
            this.emitStreamingMessage({
                type: 'thinking',
                content: data.content || data.text || ''
            });
        } else if (data.type === 'text' || data.type === 'assistant') {
            this.emitStreamingMessage({
                type: 'text',
                content: data.content || data.text || ''
            });
        } else if (data.type === 'tool_use') {
            this.emitStreamingMessage({
                type: 'tool_use',
                content: `Using tool: ${data.name || 'Unknown'}`,
                metadata: {
                    toolName: data.name
                }
            });
        } else if (data.type === 'tool_result') {
            this.emitStreamingMessage({
                type: 'tool_result',
                content: data.content || 'Tool execution completed'
            });
        } else {
            // Generic streaming content
            this.emitStreamingMessage({
                type: 'text',
                content: JSON.stringify(data)
            });
        }
    }

    private async callClaudeSDKStreaming(
        message: string,
        files?: string[],
        callbacks?: StreamingCallbacks,
        workspaceContext?: WorkspaceContext,
        currentSessionId?: string
    ): Promise<void> {
        try {
            console.log('🎯 ClaudeCodeManager: callClaudeSDKStreaming - callbacks available:', !!callbacks?.onMessage);
            this.outputChannel.appendLine(`📡 Starting real SDK streaming response...`);

            // Use the SDK's real streaming functionality - NO SIMULATION  
            await this.sdkClient.sendMessageStreaming(message, workspaceContext, currentSessionId, {
                onMessage: (streamingMessage) => {
                    console.log('🔥🔥🔥 DIRECT CALLBACK IN SDK CALL - THIS SHOULD ALWAYS APPEAR!');
                    console.log('🔥🔥🔥 Message content:', streamingMessage.content);
                    
                    // Also call our original callbacks
                    if (callbacks?.onMessage) {
                        console.log('🔥🔥🔥 Calling original callback');
                        callbacks.onMessage(streamingMessage);
                    } else {
                        console.log('🔥🔥🔥 Original callback is MISSING!');
                    }
                },
                onProgress: (progress) => {
                    callbacks?.onProgress?.(progress);
                },
                onComplete: (finalMessage) => {
                    // Update current task with the real final message
                    this.updateCurrentTask(finalMessage);
                    callbacks?.onComplete?.(finalMessage);
                },
                onError: (error) => {
                    callbacks?.onError?.(error);
                }
            });

            this.outputChannel.appendLine(`✅ Real SDK streaming completed successfully`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`❌ SDK streaming failed: ${errorMessage}`);
            callbacks?.onError?.(errorMessage);

            // Disable SDK for future calls
            this.useSDK = false;
            this.outputChannel.appendLine(`⚠️  Disabling SDK mode, will use CLI fallback`);
        }
    }

    private async callClaudeSDK(message: string, files?: string[]): Promise<void> {
        try {
            const workspaceContext = this.getWorkspaceContext();
            const currentSessionId = this.currentTask?.metadata?.sessionId;

            // Send message using SDK
            this.outputChannel.appendLine(`📡 Sending message via Claude SDK...`);
            const response = await this.sdkClient.sendMessage(message, workspaceContext, currentSessionId);

            // Create assistant message from SDK response
            const assistantMessage: ClaudeMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: response.content,
                timestamp: Date.now(),
                metadata: {
                    ...response.metadata,
                    sessionId: response.metadata?.sessionId || currentSessionId
                }
            };

            // Update current task with session ID if we got one
            if (response.metadata?.sessionId && this.currentTask) {
                this.currentTask.metadata = {
                    ...this.currentTask.metadata,
                    sessionId: response.metadata.sessionId
                };
            }

            this.updateCurrentTask(assistantMessage);
            this._onMessageReceived.fire(assistantMessage);

            // Log success with usage info
            if (response.metadata?.usage) {
                this.outputChannel.appendLine(
                    `✅ SDK Response received (${response.metadata.usage.inputTokens} input, ${response.metadata.usage.outputTokens} output tokens)`
                );
            } else {
                this.outputChannel.appendLine(`✅ SDK Response received`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`❌ SDK call failed: ${errorMessage}`);

            // Create error message for user
            const errorResponse: ClaudeMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: `❌ **SDK Error**: ${errorMessage}\n\n💡 The extension will attempt to use CLI fallback for future messages. You can try refreshing the installation or check the output logs for more details.`,
                timestamp: Date.now()
            };

            this.updateCurrentTask(errorResponse);
            this._onMessageReceived.fire(errorResponse);

            // Disable SDK for future calls
            this.useSDK = false;
            this.outputChannel.appendLine(`⚠️  Disabling SDK mode, will use CLI fallback`);
        }
    }

    private async callClaudeCodeCLI(message: string, files?: string[]): Promise<void> {
        const { exec } = require('child_process');
        const workspaceContext = this.getWorkspaceContext();

        // Prepare context for Claude
        let contextMessage = message;

        if (workspaceContext.currentFile) {
            contextMessage += `\n\nCurrent file: ${workspaceContext.currentFile.path}`;

            if (workspaceContext.currentFile.selection) {
                const selection = workspaceContext.currentFile.selection;
                const content = workspaceContext.currentFile.content || '';
                const lines = content.split('\n');
                const selectedLines = lines.slice(selection.start.line, selection.end.line + 1);
                contextMessage += `\n\nSelected code:\n\`\`\`\n${selectedLines.join('\n')}\n\`\`\``;
            }
        }

        if (workspaceContext.rootPath) {
            contextMessage += `\n\nProject: ${workspaceContext.rootPath}`;
        }

        this.outputChannel.appendLine(`Sending to Claude Code: ${contextMessage}`);

        // Always use --print without session management to avoid conflicts
        // Session management will be handled differently
        const claudeArgs = ['--print'];
        const command = `${this.config.claudeExecutablePath} ${claudeArgs.join(' ')} "${contextMessage.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

        exec(command, {
            timeout: 60000,
            maxBuffer: 1024 * 1024, // 1MB
            cwd: workspaceContext.rootPath || process.cwd()
        }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                this.outputChannel.appendLine(`Claude Code error: ${error.message}`);

                const errorMessage: ClaudeMessage = {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: `❌ Erro ao conectar com Claude Code:\n\`\`\`\n${error.message}\n\`\`\`\n\n💡 **Possíveis soluções:**\n1. Verifique se Claude Code está instalado: \`npm install -g @anthropic-ai/claude-code\`\n2. Configure sua API key: \`claude config\`\n3. Teste no terminal: \`echo "teste" | claude\`\n\nSe continuar com problemas, verifique as configurações da extensão.`,
                    timestamp: Date.now()
                };

                this.updateCurrentTask(errorMessage);
                this._onMessageReceived.fire(errorMessage);
            } else {
                const response = stdout.trim() || stderr.trim();
                this.outputChannel.appendLine(`Claude Code response: ${response}`);

                if (response) {
                    const assistantMessage: ClaudeMessage = {
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: response,
                        timestamp: Date.now()
                    };

                    this.updateCurrentTask(assistantMessage);
                    this._onMessageReceived.fire(assistantMessage);
                } else {
                    const noResponseMessage: ClaudeMessage = {
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: `⚠️ Claude Code não retornou resposta.\n\nVerifique se:\n1. Sua API key está configurada\n2. O comando funciona no terminal: \`echo "teste" | claude\`\n3. Há conectividade com a internet`,
                        timestamp: Date.now()
                    };

                    this.updateCurrentTask(noResponseMessage);
                    this._onMessageReceived.fire(noResponseMessage);
                }
            }
        });
    }

    setCurrentTask(task: ClaudeTask): void {
        this.currentTask = task;
    }

    async loadClaudeCodeSessions(): Promise<ClaudeTask[]> {
        try {
            this.outputChannel.appendLine(`🔄 Starting to load Claude Code sessions...`);

            // Get real Claude Code sessions from the session manager
            const realSessions = await this.sessionManager.getProjectSessions();
            this.outputChannel.appendLine(`📄 Found ${realSessions.length} real Claude sessions`);

            // Log first few sessions for debug
            if (realSessions.length > 0) {
                this.outputChannel.appendLine(`📋 First session example: ${realSessions[0].title} (${realSessions[0].id})`);
            }

            // Combine with any local tasks (for compatibility)
            const allSessions = [...realSessions, ...this.tasks];
            this.outputChannel.appendLine(`📊 Local tasks: ${this.tasks.length}, Combined: ${allSessions.length}`);

            // Remove duplicates based on session ID
            const uniqueSessions = allSessions.filter((session, index, arr) =>
                arr.findIndex(s => s.id === session.id) === index
            );

            // Sort by most recent
            uniqueSessions.sort((a, b) => b.updatedAt - a.updatedAt);

            this.outputChannel.appendLine(`✅ Loaded ${uniqueSessions.length} total sessions (${realSessions.length} from Claude Code CLI)`);
            return uniqueSessions;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error loading Claude Code sessions: ${error}`);
            this.outputChannel.appendLine(`📚 Fallback: returning ${this.tasks.length} local tasks`);
            return this.tasks;
        }
    }

    private generateResponse(message: string, files?: string[], context?: WorkspaceContext): string {
        const msg = message.toLowerCase().trim();

        // Greeting responses
        if (msg.includes('olá') || msg.includes('oi') || msg.includes('hello') || msg.includes('hi')) {
            if (msg.includes('funciona') || msg.includes('working') || msg.includes('funcionando')) {
                return "Sim, estou funcionando perfeitamente! 🚀\n\nSou o Claude Code integrado ao VS Code. Posso ajudar com:\n\n• Análise e explicação de código\n• Debug e correção de bugs\n• Implementação de novas funcionalidades\n• Refatoração de código\n• Documentação\n\nO que gostaria que eu fizesse?";
            }
            return `Olá! 👋 Estou aqui e pronto para ajudar.\n\n${context?.currentFile ? `Vejo que você está trabalhando no arquivo: **${context.currentFile.path.split('/').pop()}**\n\n` : ''}Como posso ajudar você hoje?`;
        }

        // Code analysis requests
        if (msg.includes('analise') || msg.includes('analyze') || msg.includes('explique') || msg.includes('explain')) {
            if (context?.currentFile) {
                const fileName = context.currentFile.path.split('/').pop();
                const fileType = fileName?.split('.').pop();
                return `Vou analisar o arquivo **${fileName}** para você.\n\n${fileType ? `Este é um arquivo ${fileType.toUpperCase()}. ` : ''}Para uma análise mais detalhada, eu precisaria estar conectado ao Claude Code CLI real.\n\n**No momento estou em modo simulação.** Para análises reais:\n1. Configure sua API key do Claude\n2. Execute \`claude\` no terminal para testar\n3. A extensão se conectará automaticamente`;
            }
            return "Para analisar código, abra um arquivo e selecione o trecho que deseja que eu examine. Também posso analisar arquivos inteiros ou explicar conceitos específicos.";
        }

        // Help requests
        if (msg.includes('help') || msg.includes('ajuda') || msg.includes('como')) {
            return `Posso ajudar com várias tarefas de desenvolvimento:\n\n**📝 Análise de Código**\n• Explicar funções e algoritmos\n• Identificar bugs e problemas\n• Sugerir melhorias\n\n**🔧 Desenvolvimento**\n• Implementar novas funcionalidades\n• Refatorar código existente\n• Criar testes\n\n**📚 Documentação**\n• Gerar comentários\n• Criar README files\n• Documentar APIs\n\n**🛠️ Como usar:**\n• Abra arquivos que quer analisar\n• Selecione código específico se necessário\n• Faça perguntas específicas\n\nQual tarefa você tem em mente?`;
        }

        // File/project questions
        if (msg.includes('arquivo') || msg.includes('file') || msg.includes('projeto') || msg.includes('project')) {
            if (context?.rootPath) {
                const projectName = context.rootPath.split('/').pop();
                const openFilesCount = context.openFiles?.length || 0;
                return `**Projeto atual:** ${projectName}\n**Arquivos abertos:** ${openFilesCount}\n${context.currentFile ? `**Arquivo ativo:** ${context.currentFile.path.split('/').pop()}\n` : ''}\nO que gostaria de fazer com ${context.currentFile ? 'este arquivo' : 'o projeto'}?`;
            }
            return "Não vejo nenhum projeto aberto. Abra uma pasta no VS Code e eu poderei ajudar com os arquivos do seu projeto.";
        }

        // Default response
        return `Entendi sua mensagem: "${message}"\n\n💡 **Dica:** Esta é uma resposta simulada da extensão. Para respostas reais do Claude Code:\n\n1. Configure suas credenciais do Claude\n2. Teste no terminal: \`echo "teste" | claude\`\n3. A extensão se conectará automaticamente\n\nEnquanto isso, posso simular ajuda com código, explicações e análises básicas. O que gostaria de experimentar?`;
    }

    async startNewTask(): Promise<void> {
        // Generate new session ID
        let sessionId: string;
        if (this.useSDK) {
            sessionId = await this.sdkClient.startNewSession();
        } else {
            sessionId = this.sessionManager.generateSessionId();
        }

        const task: ClaudeTask = {
            id: sessionId,
            title: 'New Task',
            description: '',
            status: 'pending',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                sessionId: sessionId
            }
        };

        this.tasks.unshift(task);
        this.currentTask = task;
        this._onTaskUpdate.fire(task);

        this.outputChannel.appendLine(`🆕 Started new task with session ID: ${sessionId} (${this.useSDK ? 'SDK' : 'CLI'} mode)`);
    }

    stopCurrentTask(): void {
        if (this.currentTask && this.currentTask.status === 'running') {
            this.currentTask.status = 'completed';
            this.currentTask.updatedAt = Date.now();
            this._onTaskUpdate.fire(this.currentTask);
        }

        if (this.terminal) {
            this.terminal.write('\x03'); // Send Ctrl+C
        }
    }

    private updateCurrentTask(message: ClaudeMessage): void {
        if (!this.currentTask) {
            this.startNewTask();
        }

        if (this.currentTask) {
            this.currentTask.messages.push(message);
            this.currentTask.updatedAt = Date.now();

            // Update task title from first user message
            if (message.role === 'user' && this.currentTask.title === 'New Task') {
                this.currentTask.title = message.content.substring(0, 50) + '...';
            }

            // Update task status
            if (message.role === 'user') {
                this.currentTask.status = 'running';
            }

            this._onTaskUpdate.fire(this.currentTask);
        }
    }

    getWorkspaceContext(): WorkspaceContext {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const openFiles = vscode.window.visibleTextEditors.map(editor => ({
            path: editor.document.uri.fsPath,
            content: editor.document.getText(),
            selection: editor.selection.isEmpty ? undefined : {
                start: {
                    line: editor.selection.start.line,
                    character: editor.selection.start.character
                },
                end: {
                    line: editor.selection.end.line,
                    character: editor.selection.end.character
                }
            }
        }));

        const currentFile = vscode.window.activeTextEditor ? {
            path: vscode.window.activeTextEditor.document.uri.fsPath,
            content: vscode.window.activeTextEditor.document.getText(),
            selection: vscode.window.activeTextEditor.selection.isEmpty ? undefined : {
                start: {
                    line: vscode.window.activeTextEditor.selection.start.line,
                    character: vscode.window.activeTextEditor.selection.start.character
                },
                end: {
                    line: vscode.window.activeTextEditor.selection.end.line,
                    character: vscode.window.activeTextEditor.selection.end.character
                }
            }
        } : undefined;

        return {
            rootPath: workspaceFolder?.uri.fsPath || '',
            openFiles,
            currentFile
        };
    }

    getTasks(): ClaudeTask[] {
        return this.tasks;
    }

    getCurrentTask(): ClaudeTask | null {
        return this.currentTask;
    }

    /**
     * Resume an existing Claude Code session by ID
     */
    async resumeSession(sessionId: string): Promise<void> {
        try {
            // Get the session from Claude Code
            const session = await this.sessionManager.getSession(sessionId);
            if (!session) {
                throw new Error(`Session ${sessionId} not found`);
            }

            // Set this as the current task
            this.currentTask = session;
            this._onTaskUpdate.fire(session);

            // Load existing messages into the chat
            for (const message of session.messages) {
                this._onMessageReceived.fire(message);
            }

            this.outputChannel.appendLine(`Resumed session ${sessionId}: "${session.title}"`);

            if (this.config.showNotifications) {
                vscode.window.showInformationMessage(`Resumed Claude Code session: ${session.title}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to resume session: ${errorMessage}`);
            this.outputChannel.appendLine(`Error resuming session: ${errorMessage}`);
        }
    }

    /**
     * Start a new session with a specific ID
     */
    startNewSessionWithId(sessionId?: string): void {
        const newSessionId = sessionId || this.sessionManager.generateSessionId();

        const task: ClaudeTask = {
            id: newSessionId,
            title: 'New Claude Code Session',
            description: '',
            status: 'pending',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                sessionId: newSessionId
            }
        };

        this.tasks.unshift(task);
        this.currentTask = task;
        this._onTaskUpdate.fire(task);

        this.outputChannel.appendLine(`Started new session with ID: ${newSessionId}`);
    }

    /**
     * Get session manager for direct access
     */
    getSessionManager(): ClaudeSessionManager {
        return this.sessionManager;
    }

    /**
     * Get installation information
     */
    getInstallation(): ClaudeInstallation | null {
        return this.installation;
    }

    /**
     * Set permission mode for SDK
     */
    setPermissionMode(mode: 'plan' | 'default'): void {
        try {
            if (this.useSDK && this.sdkClient) {
                this.sdkClient.setPermissionMode(mode);
            }
            this.outputChannel.appendLine(`🔧 Permission mode set to: ${mode.toUpperCase()}`);
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error setting permission mode: ${error}`);
        }
    }

    /**
     * Get current permission mode
     */
    getPermissionMode(): 'plan' | 'default' {
        try {
            if (this.useSDK && this.sdkClient) {
                return this.sdkClient.getPermissionMode();
            }
            return 'default'; // Default for CLI mode
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error getting permission mode: ${error}`);
            return 'default'; // Safe fallback
        }
    }

    /**
     * Show installation diagnostics
     */
    async showInstallationInfo(): Promise<void> {
        if (!this.installation) {
            vscode.window.showWarningMessage('Claude Code not yet initialized. Initializing now...');
            await this.initialize();
            return;
        }

        const info = this.installationDetector.getInstallationInfo(this.installation);

        // Show in output channel
        this.outputChannel.clear();
        this.outputChannel.appendLine('🔧 Claude Code Installation Information');
        this.outputChannel.appendLine('='.repeat(50));
        this.outputChannel.appendLine(info);
        this.outputChannel.show();

        // Also show a summary in an information message
        const statusEmoji = this.installation.isWorking ? '✅' : '❌';
        const message = `${statusEmoji} Claude Code (${this.installation.type}) - ${this.installation.version || 'Unknown version'}`;

        if (this.installation.isWorking) {
            vscode.window.showInformationMessage(message, 'Show Details').then(action => {
                if (action === 'Show Details') {
                    this.outputChannel.show();
                }
            });
        } else {
            vscode.window.showErrorMessage(message, 'Show Details', 'Try Fix').then(async action => {
                if (action === 'Show Details') {
                    this.outputChannel.show();
                } else if (action === 'Try Fix') {
                    await this.initialize(); // Try to re-initialize
                }
            });
        }
    }

    /**
     * Refresh installation detection
     */
    async refreshInstallation(): Promise<void> {
        this.installation = null;
        this.isInitialized = false;
        await this.initialize();
    }

    dispose(): void {
        if (this.terminal) {
            this.terminal.kill();
        }
        this.sdkClient.dispose();
        this._onTaskUpdate.dispose();
        this._onMessageReceived.dispose();
        this.outputChannel.dispose();
    }
}