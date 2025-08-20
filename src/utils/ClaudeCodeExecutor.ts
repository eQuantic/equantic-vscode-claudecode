import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ClaudeCodeExecutor {
    private static instance: ClaudeCodeExecutor;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Claude Code Executor');
    }

    static getInstance(): ClaudeCodeExecutor {
        if (!ClaudeCodeExecutor.instance) {
            ClaudeCodeExecutor.instance = new ClaudeCodeExecutor();
        }
        return ClaudeCodeExecutor.instance;
    }

    async isClaudeCodeAvailable(): Promise<boolean> {
        try {
            // Use child_process to check if claude command exists
            const { exec } = require('child_process');
            
            return new Promise((resolve) => {
                exec('claude --version', { timeout: 3000 }, (error: any, stdout: string, stderr: string) => {
                    if (error) {
                        resolve(false);
                    } else {
                        resolve(stdout.includes('claude') || stderr.includes('claude'));
                    }
                });
            });
        } catch (error) {
            return false;
        }
    }

    async executeClaudeCommand(command: string, args: string[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            const fullCommand = `${command} ${args.join(' ')}`;
            
            exec(fullCommand, { 
                timeout: 30000,
                maxBuffer: 1024 * 1024 // 1MB buffer
            }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    reject(new Error(`Command failed: ${error.message}\n${stderr}`));
                } else {
                    resolve(stdout + stderr);
                }
            });
        });
    }

    async createClaudeConfig(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const configPath = path.join(workspaceFolder.uri.fsPath, '.claude');
        const configFile = path.join(configPath, 'config.json');

        // Create .claude directory if it doesn't exist
        if (!fs.existsSync(configPath)) {
            fs.mkdirSync(configPath, { recursive: true });
        }

        // Create default config if it doesn't exist
        if (!fs.existsSync(configFile)) {
            const defaultConfig = {
                model: 'claude-3-sonnet-20240229',
                max_tokens: 4096,
                temperature: 0.1,
                system_prompt: `You are Claude Code, an AI assistant integrated into VS Code. You have access to the user's workspace and can help with code analysis, debugging, feature implementation, and more.

Key capabilities:
- Read and analyze code files
- Edit files directly
- Run commands and scripts
- Debug issues
- Implement new features
- Explain complex code

Always provide clear, actionable responses and ask for clarification when needed.`,
                tools: [
                    'file_read',
                    'file_write',
                    'file_edit',
                    'bash_execute',
                    'grep_search',
                    'git_operations'
                ]
            };

            fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));
            this.outputChannel.appendLine(`Created Claude Code config at: ${configFile}`);
        }
    }

    async getProjectContext(): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return 'No workspace folder';
        }

        const rootPath = workspaceFolder.uri.fsPath;
        let context = `Project: ${path.basename(rootPath)}\nPath: ${rootPath}\n\n`;

        // Add package.json info if available
        const packageJsonPath = path.join(rootPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                context += `Package: ${packageJson.name}\n`;
                context += `Version: ${packageJson.version}\n`;
                context += `Description: ${packageJson.description}\n\n`;
            } catch (error) {
                // Ignore errors reading package.json
            }
        }

        // Add currently open files
        const openFiles = vscode.window.visibleTextEditors.map(editor => {
            const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
            return `- ${relativePath}`;
        });

        if (openFiles.length > 0) {
            context += `Open files:\n${openFiles.join('\n')}\n\n`;
        }

        // Add current file with selection if any
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
            context += `Current file: ${relativePath}\n`;
            
            if (!activeEditor.selection.isEmpty) {
                const selectedText = activeEditor.document.getText(activeEditor.selection);
                context += `Selected text:\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
            }
        }

        return context;
    }

    async runClaudeOnCurrentFile(): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('No active file to analyze');
            return;
        }

        const filePath = activeEditor.document.uri.fsPath;
        const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri);

        try {
            const result = await this.executeClaudeCommand('claude', ['analyze', filePath]);
            
            // Show result in output channel
            this.outputChannel.clear();
            this.outputChannel.appendLine(`Analysis of ${relativePath}:`);
            this.outputChannel.appendLine('='.repeat(50));
            this.outputChannel.appendLine(result);
            this.outputChannel.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to analyze file: ${errorMessage}`);
        }
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}