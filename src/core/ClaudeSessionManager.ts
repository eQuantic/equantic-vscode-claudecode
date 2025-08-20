import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeTask, ClaudeMessage } from '../types';

interface ClaudeSessionEntry {
    parentUuid: string | null;
    isSidechain: boolean;
    userType: string;
    cwd: string;
    sessionId: string;
    version: string;
    gitBranch?: string;
    type: 'user' | 'assistant';
    message: {
        role: 'user' | 'assistant';
        content: string | any[];
    };
    uuid: string;
    timestamp: string;
    requestId?: string;
    toolUseResult?: any;
}

export class ClaudeSessionManager {
    private claudeDir: string;
    private projectsDir: string;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel, customProjectsDir?: string) {
        this.claudeDir = path.join(os.homedir(), '.claude');
        this.projectsDir = customProjectsDir || path.join(this.claudeDir, 'projects');
        this.outputChannel = outputChannel;
        
        this.outputChannel.appendLine(`📁 Using projects directory: ${this.projectsDir}`);
    }

    /**
     * Get all Claude Code sessions for the current project
     */
    async getProjectSessions(): Promise<ClaudeTask[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const projectPath = workspaceFolder.uri.fsPath;
        const projectKey = this.getProjectKey(projectPath);
        const projectSessionDir = path.join(this.projectsDir, projectKey);

        if (!fs.existsSync(projectSessionDir)) {
            this.outputChannel.appendLine(`No sessions found for project: ${projectPath}`);
            return [];
        }

        try {
            const sessionFiles = fs.readdirSync(projectSessionDir)
                .filter(file => file.endsWith('.jsonl'))
                .sort((a, b) => {
                    const statA = fs.statSync(path.join(projectSessionDir, a));
                    const statB = fs.statSync(path.join(projectSessionDir, b));
                    return statB.mtime.getTime() - statA.mtime.getTime(); // Most recent first
                });

            const sessions: ClaudeTask[] = [];

            for (const sessionFile of sessionFiles) {
                const sessionPath = path.join(projectSessionDir, sessionFile);
                const sessionId = path.basename(sessionFile, '.jsonl');
                
                try {
                    const task = await this.parseSessionFile(sessionPath, sessionId);
                    if (task) {
                        sessions.push(task);
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`Error parsing session ${sessionFile}: ${error}`);
                }
            }

            this.outputChannel.appendLine(`Loaded ${sessions.length} sessions for project`);
            return sessions;
        } catch (error) {
            this.outputChannel.appendLine(`Error reading project sessions: ${error}`);
            return [];
        }
    }

    /**
     * Get a specific session by ID
     */
    async getSession(sessionId: string): Promise<ClaudeTask | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const projectPath = workspaceFolder.uri.fsPath;
        const projectKey = this.getProjectKey(projectPath);
        const sessionPath = path.join(this.projectsDir, projectKey, `${sessionId}.jsonl`);

        if (!fs.existsSync(sessionPath)) {
            return null;
        }

        return this.parseSessionFile(sessionPath, sessionId);
    }

    /**
     * Create a new session ID (UUID format)
     */
    generateSessionId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Get the latest/most recent session ID for continuing
     */
    async getLatestSessionId(): Promise<string | null> {
        const sessions = await this.getProjectSessions();
        return sessions.length > 0 ? sessions[0].id : null;
    }

    /**
     * Check if a session exists
     */
    sessionExists(sessionId: string): boolean {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        const projectPath = workspaceFolder.uri.fsPath;
        const projectKey = this.getProjectKey(projectPath);
        const sessionPath = path.join(this.projectsDir, projectKey, `${sessionId}.jsonl`);

        return fs.existsSync(sessionPath);
    }

    private async parseSessionFile(sessionPath: string, sessionId: string): Promise<ClaudeTask | null> {
        try {
            const content = fs.readFileSync(sessionPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
                return null;
            }

            const entries: ClaudeSessionEntry[] = [];
            for (const line of lines) {
                try {
                    entries.push(JSON.parse(line));
                } catch (error) {
                    // Skip invalid lines
                }
            }

            if (entries.length === 0) {
                return null;
            }

            // Get session info from first entry
            const firstEntry = entries[0];
            const lastEntry = entries[entries.length - 1];

            // Convert entries to messages
            const messages: ClaudeMessage[] = [];
            
            for (const entry of entries) {
                if (entry.type === 'user' || entry.type === 'assistant') {
                    const content = typeof entry.message.content === 'string' 
                        ? entry.message.content 
                        : this.formatComplexContent(entry.message.content);

                    messages.push({
                        id: entry.uuid,
                        role: entry.message.role,
                        content,
                        timestamp: new Date(entry.timestamp).getTime(),
                        metadata: {
                            sessionId: entry.sessionId,
                            requestId: entry.requestId,
                            toolUseResult: entry.toolUseResult
                        }
                    });
                }
            }

            // Determine session status and title
            const status = this.determineSessionStatus(entries);
            const title = this.generateSessionTitle(messages);

            return {
                id: sessionId,
                title,
                description: `Claude Code Session - ${messages.length} messages`,
                status,
                messages,
                createdAt: new Date(firstEntry.timestamp).getTime(),
                updatedAt: new Date(lastEntry.timestamp).getTime(),
                metadata: {
                    sessionId,
                    cwd: firstEntry.cwd,
                    version: firstEntry.version,
                    gitBranch: firstEntry.gitBranch
                }
            };
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing session file ${sessionPath}: ${error}`);
            return null;
        }
    }

    private formatComplexContent(content: any[]): string {
        if (!Array.isArray(content)) {
            return String(content);
        }

        let formatted = '';
        for (const item of content) {
            if (item.type === 'text') {
                formatted += item.text;
            } else if (item.type === 'tool_use') {
                formatted += `\n\n🔧 **Tool Use:** ${item.name}\n`;
                if (item.input) {
                    formatted += `Parameters: ${JSON.stringify(item.input, null, 2)}\n`;
                }
            } else {
                formatted += `\n[${item.type}]: ${JSON.stringify(item, null, 2)}\n`;
            }
        }

        return formatted.trim();
    }

    private determineSessionStatus(entries: ClaudeSessionEntry[]): 'pending' | 'running' | 'completed' | 'error' {
        // Simple heuristic: if last message is from user, it's pending
        // If last message is from assistant, it's completed
        const lastMessage = entries[entries.length - 1];
        
        if (lastMessage.type === 'user') {
            return 'pending';
        } else if (lastMessage.type === 'assistant') {
            return 'completed';
        }
        
        return 'completed';
    }

    private generateSessionTitle(messages: ClaudeMessage[]): string {
        // Use first user message as title
        const firstUserMessage = messages.find(m => m.role === 'user');
        if (firstUserMessage && firstUserMessage.content) {
            const title = firstUserMessage.content.substring(0, 50).replace(/\n/g, ' ').trim();
            return title + (firstUserMessage.content.length > 50 ? '...' : '');
        }
        
        return 'Claude Code Session';
    }

    private getProjectKey(projectPath: string): string {
        // Convert project path to Claude's format
        return projectPath.replace(/\//g, '-').replace(/^-/, '');
    }

    /**
     * Get all Claude sessions across all projects (for global history)
     */
    async getAllSessions(): Promise<ClaudeTask[]> {
        if (!fs.existsSync(this.projectsDir)) {
            return [];
        }

        const allSessions: ClaudeTask[] = [];
        
        try {
            const projectDirs = fs.readdirSync(this.projectsDir);
            
            for (const projectDir of projectDirs) {
                const projectSessionDir = path.join(this.projectsDir, projectDir);
                if (!fs.statSync(projectSessionDir).isDirectory()) {
                    continue;
                }

                const sessionFiles = fs.readdirSync(projectSessionDir)
                    .filter(file => file.endsWith('.jsonl'));

                for (const sessionFile of sessionFiles) {
                    const sessionPath = path.join(projectSessionDir, sessionFile);
                    const sessionId = path.basename(sessionFile, '.jsonl');
                    
                    try {
                        const task = await this.parseSessionFile(sessionPath, sessionId);
                        if (task) {
                            // Add project info to metadata
                            task.metadata = {
                                ...task.metadata,
                                projectDir: projectDir.replace(/-/g, '/')
                            };
                            allSessions.push(task);
                        }
                    } catch (error) {
                        // Skip invalid sessions
                    }
                }
            }

            // Sort by most recent
            allSessions.sort((a, b) => b.updatedAt - a.updatedAt);
            
            this.outputChannel.appendLine(`Loaded ${allSessions.length} total sessions across all projects`);
            return allSessions;
        } catch (error) {
            this.outputChannel.appendLine(`Error reading all sessions: ${error}`);
            return [];
        }
    }
}