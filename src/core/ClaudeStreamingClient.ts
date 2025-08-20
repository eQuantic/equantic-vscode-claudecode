import * as vscode from 'vscode';
import { ClaudeMessage, WorkspaceContext } from '../types';

export interface StreamingMessage {
    type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'progress' | 'complete' | 'error';
    content: string;
    metadata?: {
        toolName?: string;
        progress?: number;
        sessionId?: string;
        requestId?: string;
        filePath?: string;
        language?: string;
        isCodeFile?: boolean;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    };
}

export interface StreamingCallbacks {
    onMessage?: (message: StreamingMessage) => void;
    onProgress?: (progress: number) => void;
    onComplete?: (finalMessage: ClaudeMessage) => void;
    onError?: (error: string) => void;
}

/**
 * Streaming client for real-time Claude Code responses with thinking process
 */
export class ClaudeStreamingClient {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Send message with streaming response
     */
    async sendMessageStreaming(
        message: string,
        workspaceContext?: WorkspaceContext,
        sessionId?: string,
        callbacks?: StreamingCallbacks
    ): Promise<void> {
        try {
            this.outputChannel.appendLine('🌊 Starting streaming response...');

            // Try to use CLI with streaming first
            await this.streamFromCLI(message, workspaceContext, sessionId, callbacks);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`❌ Streaming failed: ${errorMessage}`);
            callbacks?.onError?.(errorMessage);
        }
    }

    /**
     * Stream from Claude Code CLI using --output-format stream-json
     */
    private async streamFromCLI(
        message: string,
        workspaceContext?: WorkspaceContext,
        sessionId?: string,
        callbacks?: StreamingCallbacks
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const { spawn } = require('child_process');
            
            // Prepare Claude command with streaming - MUST use --print and --verbose for stream-json
            const claudeArgs = ['--print', '--verbose', '--output-format', 'stream-json'];
            
            // Add session management
            if (sessionId) {
                claudeArgs.push('--session-id', sessionId);
            } else {
                claudeArgs.push('--continue'); // Continue previous session
            }
            
            // Add the message directly as argument
            claudeArgs.push(message);
            
            this.outputChannel.appendLine(`🚀 Spawning Claude CLI: claude ${claudeArgs.join(' ')}`);
            
            // Spawn Claude process
            const claudeProcess = spawn('claude', claudeArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: workspaceContext?.rootPath || process.cwd(),
                shell: true // Enable shell for better compatibility
            });

            let fullResponse = '';
            let messageBuffer = '';
            let hasReceivedData = false;

            // Process streaming output
            claudeProcess.stdout.on('data', (data: Buffer) => {
                hasReceivedData = true;
                const chunk = data.toString();
                this.outputChannel.appendLine(`📥 Received chunk: ${chunk.substring(0, 100)}...`);
                
                messageBuffer += chunk;
                
                // Process complete JSON lines
                const lines = messageBuffer.split('\n');
                messageBuffer = lines.pop() || ''; // Keep incomplete line in buffer
                
                for (const line of lines) {
                    if (line.trim()) {
                        this.processStreamingLine(line.trim(), callbacks, (content, type) => {
                            if (type === 'text') {
                                fullResponse += content;
                            }
                        });
                    }
                }
            });

            claudeProcess.stderr.on('data', (data: Buffer) => {
                const error = data.toString();
                this.outputChannel.appendLine(`⚠️  Claude stderr: ${error}`);
                
                // Don't treat all stderr as errors - some might be progress info
                if (error.toLowerCase().includes('error') || error.toLowerCase().includes('failed')) {
                    callbacks?.onError?.(error);
                }
            });

            claudeProcess.on('close', (code: number) => {
                this.outputChannel.appendLine(`✅ Claude process exited with code: ${code}`);
                
                if (code === 0) {
                    // If we didn't receive any response, that's an error
                    if (!hasReceivedData || !fullResponse.trim()) {
                        const errorMsg = 'No response received from Claude CLI';
                        this.outputChannel.appendLine(`❌ ${errorMsg}`);
                        callbacks?.onError?.(errorMsg);
                        reject(new Error(errorMsg));
                        return;
                    }
                    
                    // Create final message
                    const finalMessage: ClaudeMessage = {
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: fullResponse,
                        timestamp: Date.now(),
                        metadata: {
                            sessionId,
                            streamingComplete: true
                        }
                    };
                    
                    callbacks?.onComplete?.(finalMessage);
                    resolve();
                } else {
                    const errorMsg = `Claude CLI failed with code ${code}`;
                    this.outputChannel.appendLine(`❌ ${errorMsg}`);
                    callbacks?.onError?.(errorMsg);
                    reject(new Error(errorMsg));
                }
            });

            claudeProcess.on('error', (error: Error) => {
                this.outputChannel.appendLine(`❌ Claude process error: ${error.message}`);
                callbacks?.onError?.(error.message);
                reject(error);
            });

            // Set a timeout for the process (increased to 2 minutes)
            const timeout = setTimeout(() => {
                this.outputChannel.appendLine('⏰ Claude CLI timeout, killing process...');
                claudeProcess.kill('SIGTERM');
                const timeoutError = 'Claude CLI request timed out after 2 minutes';
                callbacks?.onError?.(timeoutError);
                reject(new Error(timeoutError));
            }, 120000); // 2 minute timeout

            claudeProcess.on('close', () => {
                clearTimeout(timeout);
            });
        });
    }

    /**
     * Process individual streaming line from Claude output
     */
    private processStreamingLine(
        line: string, 
        callbacks?: StreamingCallbacks,
        contentCollector?: (content: string, type: 'text' | 'thinking') => void
    ): void {
        this.outputChannel.appendLine(`🔍 Processing line: ${line}`);
        
        try {
            // Try to parse as JSON first
            const data = JSON.parse(line);
            this.outputChannel.appendLine(`📊 Parsed JSON: ${JSON.stringify(data)}`);
            
            // Handle Claude Code CLI real stream-json formats
            if (data.type === 'system' && data.subtype === 'init') {
                // System initialization
                this.outputChannel.appendLine(`🎯 Session initialized: ${data.session_id}`);
                callbacks?.onMessage?.({
                    type: 'progress',
                    content: 'Initializing Claude session...',
                    metadata: { sessionId: data.session_id }
                });
                
            } else if (data.type === 'assistant' && data.message) {
                // Main assistant response
                const message = data.message;
                let content = '';
                
                // Extract content from content blocks
                if (message.content && Array.isArray(message.content)) {
                    for (const block of message.content) {
                        if (block.type === 'text') {
                            content += block.text;
                        } else if (block.type === 'tool_use' && block.name === 'Write') {
                            // Handle tool_use for file writing (explicit code detection)
                            const filePath = block.input?.file_path || '';
                            const fileContent = block.input?.content || '';
                            const fileExt = filePath.split('.').pop()?.toLowerCase() || '';
                            
                            // Determine language from file extension
                            const langMap: {[key: string]: string} = {
                                'js': 'javascript', 'ts': 'typescript', 'py': 'python',
                                'cs': 'csharp', 'java': 'java', 'cpp': 'cpp', 'c': 'c',
                                'html': 'html', 'css': 'css', 'json': 'json', 'xml': 'xml'
                            };
                            const detectedLang = langMap[fileExt] || 'code';
                            
                            callbacks?.onMessage?.({
                                type: 'tool_use',
                                content: `Creating file: ${filePath}\n\`\`\`${detectedLang}\n${fileContent}\n\`\`\``,
                                metadata: {
                                    toolName: 'Write',
                                    sessionId: data.session_id,
                                    filePath,
                                    language: detectedLang,
                                    isCodeFile: true
                                }
                            });
                            contentCollector?.(fileContent, 'text');
                        }
                    }
                } else if (typeof message.content === 'string') {
                    content = message.content;
                }
                
                if (content) {
                    // Check if this looks like thinking
                    const isThinking = this.isThinkingContent(content);
                    const messageType = isThinking ? 'thinking' : 'text';
                    
                    callbacks?.onMessage?.({
                        type: messageType,
                        content,
                        metadata: {
                            sessionId: data.session_id,
                            usage: message.usage ? {
                                inputTokens: message.usage.input_tokens || 0,
                                outputTokens: message.usage.output_tokens || 0
                            } : undefined,
                            requestId: message.id
                        }
                    });
                    contentCollector?.(content, messageType === 'thinking' ? 'thinking' : 'text');
                }
                
            } else if (data.type === 'result') {
                // Final result summary
                this.outputChannel.appendLine(`✅ Request completed in ${data.duration_ms}ms`);
                
                if (data.usage) {
                    const usage = data.usage;
                    this.outputChannel.appendLine(`📊 Usage: ${usage.input_tokens} input, ${usage.output_tokens} output tokens`);
                    if (data.total_cost_usd) {
                        this.outputChannel.appendLine(`💰 Cost: $${data.total_cost_usd.toFixed(4)}`);
                    }
                }
                
                callbacks?.onMessage?.({
                    type: 'progress',
                    content: `Completed in ${data.duration_ms}ms`,
                    metadata: { 
                        usage: data.usage ? {
                            inputTokens: data.usage.input_tokens || 0,
                            outputTokens: data.usage.output_tokens || 0
                        } : undefined,
                        sessionId: data.session_id 
                    }
                });
                
            } else if (data.type === 'error') {
                // Error message
                callbacks?.onError?.(data.message || data.error?.message || 'Unknown error');
                
            } else {
                // Unknown JSON format, log and treat as text
                this.outputChannel.appendLine(`❓ Unknown JSON type: ${data.type}`);
                const content = data.content || data.text || data.message || line;
                if (content) {
                    callbacks?.onMessage?.({
                        type: 'text',
                        content,
                        metadata: data
                    });
                    contentCollector?.(content, 'text');
                }
            }
            
        } catch (error) {
            // Not JSON, might be plain text output or partial JSON
            this.outputChannel.appendLine(`📝 Processing as plain text: ${line}`);
            
            if (line.trim()) {
                // Check if this looks like thinking process
                const isThinking = this.isThinkingContent(line);
                const messageType = isThinking ? 'thinking' : 'text';
                
                callbacks?.onMessage?.({
                    type: messageType,
                    content: line + '\n'
                });
                contentCollector?.(line + '\n', messageType === 'thinking' ? 'thinking' : 'text');
            }
        }
    }
    
    /**
     * Determine if content appears to be thinking process
     */
    private isThinkingContent(content: string): boolean {
        const thinkingIndicators = [
            // Common Claude thinking patterns
            'I need to', 'Let me', 'First, I', 'I should', 'I\'ll need to',
            'Looking at', 'Based on', 'To solve this', 'I can see',
            // Analyzing patterns
            'analyzing', 'considering', 'thinking', 'examining',
            // Planning patterns
            'planning', 'preparing', 'organizing', 'structuring',
            // Portuguese patterns
            'preciso', 'vou', 'primeiro', 'analisando', 'pensando'
        ];
        
        const lowerContent = content.toLowerCase();
        return thinkingIndicators.some(indicator => 
            lowerContent.includes(indicator.toLowerCase())
        ) || content.startsWith('🤔') || content.includes('...');
    }

    /**
     * Simulate streaming for testing/development
     */
    async simulateStreaming(
        message: string,
        callbacks?: StreamingCallbacks
    ): Promise<void> {
        const steps = [
            { type: 'thinking' as const, content: '🤔 Analyzing your request...' },
            { type: 'thinking' as const, content: '📋 Creating task list...' },
            { type: 'progress' as const, content: 'Progress: 25%', metadata: { progress: 0.25 } },
            { type: 'tool_use' as const, content: 'Using tool: file_read', metadata: { toolName: 'file_read' } },
            { type: 'progress' as const, content: 'Progress: 50%', metadata: { progress: 0.50 } },
            { type: 'tool_result' as const, content: 'File analysis complete' },
            { type: 'thinking' as const, content: '💡 Formulating response...' },
            { type: 'progress' as const, content: 'Progress: 75%', metadata: { progress: 0.75 } },
            { type: 'text' as const, content: `I understand you want help with: "${message.substring(0, 50)}..."\n\n` },
            { type: 'text' as const, content: '🚀 **Analysis Complete**\n\n' },
            { type: 'text' as const, content: 'Based on your request, I can help with:\n\n' },
            { type: 'text' as const, content: '• Code analysis and refactoring\n' },
            { type: 'text' as const, content: '• Feature implementation\n' },
            { type: 'text' as const, content: '• Debugging assistance\n\n' },
            { type: 'text' as const, content: 'What specific aspect would you like me to focus on?' },
            { type: 'progress' as const, content: 'Progress: 100%', metadata: { progress: 1.0 } }
        ];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
            
            callbacks?.onMessage?.(step);
            
            if (step.metadata?.progress !== undefined) {
                callbacks?.onProgress?.(step.metadata.progress);
            }
        }

        // Complete the streaming
        const finalContent = steps
            .filter(step => step.type === 'text')
            .map(step => step.content)
            .join('');

        const finalMessage: ClaudeMessage = {
            id: Date.now().toString(),
            role: 'assistant',
            content: finalContent,
            timestamp: Date.now(),
            metadata: {
                streamingComplete: true,
                simulatedResponse: true
            }
        };

        callbacks?.onComplete?.(finalMessage);
    }

    /**
     * Enhance message with workspace context
     */
    private enhanceMessageWithContext(message: string, context?: WorkspaceContext): string {
        if (!context) {
            return message;
        }

        let enhancedMessage = message;

        // Add workspace context
        if (context.rootPath) {
            enhancedMessage += `\n\nWorkspace: ${context.rootPath}`;
        }

        // Add current file context
        if (context.currentFile) {
            enhancedMessage += `\nCurrent File: ${context.currentFile.path}`;
            
            if (context.currentFile.selection) {
                const selection = context.currentFile.selection;
                enhancedMessage += `\nSelected Lines: ${selection.start.line}-${selection.end.line}`;
            }
        }

        // Add open files context (limit to avoid too long messages)
        if (context.openFiles && context.openFiles.length > 0) {
            const fileNames = context.openFiles.slice(0, 5).map(f => f.path.split('/').pop()).join(', ');
            enhancedMessage += `\nOpen Files: ${fileNames}${context.openFiles.length > 5 ? ` (+${context.openFiles.length - 5} more)` : ''}`;
        }

        return enhancedMessage;
    }
}