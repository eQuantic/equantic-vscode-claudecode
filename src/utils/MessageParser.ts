import { ClaudeMessage, ToolCall } from '../types';

export class MessageParser {
    static parseClaudeOutput(output: string): ClaudeMessage[] {
        const messages: ClaudeMessage[] = [];
        const lines = output.split('\n');
        
        let currentMessage: Partial<ClaudeMessage> | null = null;
        let currentContent = '';
        let currentToolCalls: ToolCall[] = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Check for JSON-formatted messages
            if (this.isJsonMessage(trimmed)) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.role && parsed.content) {
                        if (currentMessage) {
                            // Save previous message
                            messages.push(this.finalizeMessage(currentMessage, currentContent, currentToolCalls));
                        }
                        
                        currentMessage = {
                            id: parsed.id || Date.now().toString(),
                            role: parsed.role,
                            timestamp: parsed.timestamp || Date.now(),
                            files: parsed.files,
                            metadata: parsed.metadata
                        };
                        currentContent = parsed.content;
                        currentToolCalls = parsed.metadata?.toolCalls || [];
                    }
                } catch (error) {
                    // Not a valid JSON message, continue
                }
            }
            // Check for tool call indicators
            else if (trimmed.startsWith('Tool:') || trimmed.startsWith('Function:')) {
                const toolCall = this.parseToolCall(trimmed);
                if (toolCall) {
                    currentToolCalls.push(toolCall);
                }
            }
            // Check for assistant responses
            else if (trimmed.startsWith('Assistant:') || trimmed.startsWith('Claude:')) {
                if (currentMessage) {
                    messages.push(this.finalizeMessage(currentMessage, currentContent, currentToolCalls));
                }
                
                currentMessage = {
                    id: Date.now().toString(),
                    role: 'assistant',
                    timestamp: Date.now()
                };
                currentContent = trimmed.substring(trimmed.indexOf(':') + 1).trim();
                currentToolCalls = [];
            }
            // Check for user messages
            else if (trimmed.startsWith('User:') || trimmed.startsWith('Human:')) {
                if (currentMessage) {
                    messages.push(this.finalizeMessage(currentMessage, currentContent, currentToolCalls));
                }
                
                currentMessage = {
                    id: Date.now().toString(),
                    role: 'user',
                    timestamp: Date.now()
                };
                currentContent = trimmed.substring(trimmed.indexOf(':') + 1).trim();
                currentToolCalls = [];
            }
            // Continue building current message content
            else if (currentMessage && trimmed) {
                if (currentContent) {
                    currentContent += '\n' + trimmed;
                } else {
                    currentContent = trimmed;
                }
            }
        }
        
        // Add final message if exists
        if (currentMessage) {
            messages.push(this.finalizeMessage(currentMessage, currentContent, currentToolCalls));
        }
        
        return messages;
    }
    
    private static isJsonMessage(line: string): boolean {
        return line.startsWith('{') && line.endsWith('}');
    }
    
    private static parseToolCall(line: string): ToolCall | null {
        try {
            const match = line.match(/^(?:Tool|Function):\s*(\w+)(?:\s*\((.*)\))?/);
            if (match) {
                const name = match[1];
                const paramsStr = match[2];
                let parameters: Record<string, any> = {};
                
                if (paramsStr) {
                    try {
                        parameters = JSON.parse(`{${paramsStr}}`);
                    } catch (error) {
                        // Simple key=value parsing
                        const pairs = paramsStr.split(',').map(p => p.trim());
                        for (const pair of pairs) {
                            const [key, value] = pair.split('=').map(s => s.trim());
                            if (key && value) {
                                (parameters as any)[key] = value.replace(/^["']|["']$/g, '');
                            }
                        }
                    }
                }
                
                return {
                    id: Date.now().toString(),
                    name,
                    parameters,
                    status: 'pending'
                };
            }
        } catch (error) {
            // Ignore parsing errors
        }
        
        return null;
    }
    
    private static finalizeMessage(
        message: Partial<ClaudeMessage>, 
        content: string, 
        toolCalls: ToolCall[]
    ): ClaudeMessage {
        return {
            id: message.id!,
            role: message.role!,
            content: content,
            timestamp: message.timestamp!,
            files: message.files,
            metadata: {
                ...message.metadata,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            }
        };
    }
    
    static formatMessageForDisplay(message: ClaudeMessage): string {
        let formatted = message.content;
        
        if (message.metadata?.toolCalls && message.metadata.toolCalls.length > 0) {
            formatted += '\n\n**Tool Calls:**\n';
            for (const tool of message.metadata.toolCalls) {
                formatted += `- ${tool.name}(${JSON.stringify(tool.parameters)}) - Status: ${tool.status}\n`;
            }
        }
        
        if (message.files && message.files.length > 0) {
            formatted += '\n\n**Files:**\n';
            for (const file of message.files) {
                formatted += `- ${file}\n`;
            }
        }
        
        return formatted;
    }
    
    static extractCodeBlocks(content: string): Array<{language: string, code: string}> {
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        const blocks: Array<{language: string, code: string}> = [];
        
        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            blocks.push({
                language: match[1] || 'text',
                code: match[2].trim()
            });
        }
        
        return blocks;
    }
    
    static extractFilePaths(content: string): string[] {
        const filePathRegex = /(?:^|\s)([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)(?:\s|$)/gm;
        const paths: string[] = [];
        
        let match;
        while ((match = filePathRegex.exec(content)) !== null) {
            const path = match[1];
            if (path && !paths.includes(path)) {
                paths.push(path);
            }
        }
        
        return paths;
    }
}