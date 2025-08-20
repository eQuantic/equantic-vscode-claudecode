/**
 * Converts ANSI color codes to HTML/CSS for rich terminal output display
 */
export class AnsiColorConverter {
    private static readonly ANSI_COLORS = {
        // Standard colors
        '30': '#000000', // black
        '31': '#cd3131', // red
        '32': '#00bc00', // green  
        '33': '#e5e510', // yellow
        '34': '#2472c8', // blue
        '35': '#bc3fbc', // magenta
        '36': '#11a8cd', // cyan
        '37': '#e5e5e5', // white
        
        // Bright colors
        '90': '#666666', // bright black (gray)
        '91': '#f14c4c', // bright red
        '92': '#23d18b', // bright green
        '93': '#f5f543', // bright yellow
        '94': '#3b8eea', // bright blue
        '95': '#d670d6', // bright magenta
        '96': '#29b8db', // bright cyan
        '97': '#ffffff', // bright white
        
        // Background colors (add 10 to foreground)
        '40': '#000000', '41': '#cd3131', '42': '#00bc00', '43': '#e5e510',
        '44': '#2472c8', '45': '#bc3fbc', '46': '#11a8cd', '47': '#e5e5e5',
        '100': '#666666', '101': '#f14c4c', '102': '#23d18b', '103': '#f5f543',
        '104': '#3b8eea', '105': '#d670d6', '106': '#29b8db', '107': '#ffffff'
    };

    /**
     * Convert ANSI escape sequences to HTML
     */
    static toHtml(text: string): string {
        let html = text;
        let currentForeground = '';
        let currentBackground = '';
        let currentStyles: string[] = [];

        // Replace ANSI escape sequences
        html = html.replace(/\x1b\[([0-9;]*)m/g, (match, codes) => {
            const codeList = codes.split(';').filter((code: string) => code !== '');
            
            if (codeList.length === 0 || codeList.includes('0')) {
                // Reset all styles
                currentForeground = '';
                currentBackground = '';
                currentStyles = [];
                return '</span>';
            }

            let styleChanges = '';
            
            for (const code of codeList) {
                const numCode = parseInt(code);
                
                // Foreground colors
                if (numCode >= 30 && numCode <= 37 || numCode >= 90 && numCode <= 97) {
                    currentForeground = this.ANSI_COLORS[code as keyof typeof this.ANSI_COLORS] || '';
                }
                // Background colors
                else if (numCode >= 40 && numCode <= 47 || numCode >= 100 && numCode <= 107) {
                    currentBackground = this.ANSI_COLORS[code as keyof typeof this.ANSI_COLORS] || '';
                }
                // Text styles
                else if (numCode === 1) {
                    if (!currentStyles.includes('font-weight: bold')) {
                        currentStyles.push('font-weight: bold');
                    }
                } else if (numCode === 3) {
                    if (!currentStyles.includes('font-style: italic')) {
                        currentStyles.push('font-style: italic');
                    }
                } else if (numCode === 4) {
                    if (!currentStyles.includes('text-decoration: underline')) {
                        currentStyles.push('text-decoration: underline');
                    }
                }
            }

            // Build CSS style
            const styles = [...currentStyles];
            if (currentForeground) {
                styles.push(`color: ${currentForeground}`);
            }
            if (currentBackground) {
                styles.push(`background-color: ${currentBackground}`);
            }

            if (styles.length > 0) {
                return `<span style="${styles.join('; ')}">`;
            }
            
            return '';
        });

        // Clean up any remaining escape sequences
        html = html.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        
        return html;
    }

    /**
     * Convert ANSI text to styled spans for webview
     */
    static toStyledSpans(text: string): string {
        const html = this.toHtml(text);
        
        // Wrap in a container with terminal-like styling
        return `<div class="ansi-output">${html}</div>`;
    }

    /**
     * Extract plain text from ANSI colored text
     */
    static toPlainText(text: string): string {
        return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    }

    /**
     * Detect if text contains ANSI escape sequences
     */
    static hasAnsiCodes(text: string): boolean {
        return /\x1b\[[0-9;]*[a-zA-Z]/.test(text);
    }

    /**
     * Get CSS styles for ANSI output container
     */
    static getCssStyles(): string {
        return `
            .ansi-output {
                font-family: 'Courier New', 'Monaco', 'Menlo', monospace;
                white-space: pre-wrap;
                line-height: 1.4;
                background: var(--vscode-terminal-background, #000000);
                color: var(--vscode-terminal-foreground, #ffffff);
                padding: 8px;
                border-radius: 4px;
                overflow-x: auto;
            }
            
            .ansi-output span {
                font-family: inherit;
            }
        `;
    }
}

/**
 * Parser for Claude Code specific output formats
 */
export class ClaudeOutputParser {
    /**
     * Parse TODO list from Claude output
     */
    static parseTodoList(text: string): Array<{ id: string; content: string; status: string; completed?: boolean }> {
        const todos: Array<{ id: string; content: string; status: string; completed?: boolean }> = [];
        const todoRegex = /(?:^|\n)\s*(?:[-*•]|\d+\.)\s*\[([x\s])\]\s*(.*?)$/gmi;
        
        let match;
        let index = 0;
        
        while ((match = todoRegex.exec(text)) !== null) {
            const completed = match[1].toLowerCase() === 'x';
            const content = match[2].trim();
            
            todos.push({
                id: `todo-${index}`,
                content,
                status: completed ? 'completed' : 'pending',
                completed
            });
            
            index++;
        }
        
        return todos;
    }

    /**
     * Parse tool calls from Claude output
     */
    static parseToolCalls(text: string): Array<{ name: string; args: any; result?: string }> {
        const toolCalls: Array<{ name: string; args: any; result?: string }> = [];
        
        // Look for tool use patterns
        const toolUseRegex = /🔧\s*(?:Using tool|Tool):\s*(\w+)(?:\s*\((.*?)\))?/gi;
        
        let match;
        while ((match = toolUseRegex.exec(text)) !== null) {
            const name = match[1];
            const argsStr = match[2];
            
            let args = {};
            if (argsStr) {
                try {
                    args = JSON.parse(`{${argsStr}}`);
                } catch (error) {
                    // Simple parsing for key=value pairs
                    const pairs = argsStr.split(',').map(p => p.trim());
                    for (const pair of pairs) {
                        const [key, value] = pair.split('=').map(s => s.trim());
                        if (key && value) {
                            (args as any)[key] = value.replace(/^["']|["']$/g, '');
                        }
                    }
                }
            }
            
            toolCalls.push({ name, args });
        }
        
        return toolCalls;
    }

    /**
     * Parse progress indicators
     */
    static parseProgress(text: string): number | null {
        const progressRegex = /(?:Progress|Progresso):\s*(\d+(?:\.\d+)?)%/i;
        const match = text.match(progressRegex);
        
        if (match) {
            return parseFloat(match[1]) / 100;
        }
        
        return null;
    }

    /**
     * Identify thinking vs output text
     */
    static isThinkingText(text: string): boolean {
        const thinkingKeywords = [
            '🤔', 'thinking', 'analyzing', 'considering', 'planning',
            'let me', 'i need to', 'first i', 'i should',
            'analisando', 'pensando', 'considerando', 'planejando'
        ];
        
        const lowerText = text.toLowerCase();
        return thinkingKeywords.some(keyword => lowerText.includes(keyword));
    }

    /**
     * Format thinking text with special styling
     */
    static formatThinkingText(text: string): string {
        return `<div class="thinking-text">💭 ${text}</div>`;
    }

    /**
     * Format tool usage with styling
     */
    static formatToolUsage(toolName: string, args?: any): string {
        const argsStr = args ? ` (${JSON.stringify(args, null, 2)})` : '';
        return `<div class="tool-usage">🔧 <strong>${toolName}</strong>${argsStr}</div>`;
    }
}