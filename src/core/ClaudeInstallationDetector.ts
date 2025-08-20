import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ClaudeInstallation {
    type: 'global' | 'local' | 'unknown';
    executablePath: string;
    claudeDir: string;
    projectsDir: string;
    version?: string;
    isWorking: boolean;
}

export class ClaudeInstallationDetector {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Detect Claude Code installation automatically
     */
    async detectInstallation(): Promise<ClaudeInstallation> {
        this.outputChannel.appendLine('🔍 Detecting Claude Code installation...');

        // Try multiple detection strategies
        const candidates = await this.getCandidateInstallations();
        
        for (const candidate of candidates) {
            this.outputChannel.appendLine(`Testing candidate: ${candidate.type} at ${candidate.executablePath}`);
            
            if (await this.validateInstallation(candidate)) {
                this.outputChannel.appendLine(`✅ Found working installation: ${candidate.type}`);
                return candidate;
            }
        }

        // Fallback to default paths
        this.outputChannel.appendLine('⚠️  No working installation found, using defaults');
        return {
            type: 'unknown',
            executablePath: 'claude',
            claudeDir: path.join(os.homedir(), '.claude'),
            projectsDir: path.join(os.homedir(), '.claude', 'projects'),
            isWorking: false
        };
    }

    /**
     * Get all possible Claude Code installation candidates
     */
    private async getCandidateInstallations(): Promise<ClaudeInstallation[]> {
        const candidates: ClaudeInstallation[] = [];

        // 1. Check global npm installation
        try {
            const { exec } = require('child_process');
            const globalNpmPrefix = await this.execPromise('npm config get prefix');
            const globalBinPath = path.join(globalNpmPrefix.trim(), 'bin', 'claude');
            
            if (fs.existsSync(globalBinPath)) {
                candidates.push({
                    type: 'global',
                    executablePath: globalBinPath,
                    claudeDir: path.join(os.homedir(), '.claude'),
                    projectsDir: path.join(os.homedir(), '.claude', 'projects'),
                    isWorking: false
                });
            }
        } catch (error) {
            // Ignore errors, continue with other methods
        }

        // 2. Check local npm installation (in current workspace)
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const localNodeModulesPath = path.join(workspaceFolder.uri.fsPath, 'node_modules', '.bin', 'claude');
            if (fs.existsSync(localNodeModulesPath)) {
                candidates.push({
                    type: 'local',
                    executablePath: localNodeModulesPath,
                    claudeDir: path.join(os.homedir(), '.claude'),
                    projectsDir: path.join(os.homedir(), '.claude', 'projects'),
                    isWorking: false
                });
            }
        }

        // 3. Check PATH environment variable
        try {
            const whichResult = await this.execPromise('which claude').catch(() => '');
            if (whichResult.trim()) {
                const pathInstallation = whichResult.trim();
                const installationType = pathInstallation.includes('node_modules') ? 'local' : 'global';
                
                candidates.push({
                    type: installationType,
                    executablePath: pathInstallation,
                    claudeDir: path.join(os.homedir(), '.claude'),
                    projectsDir: path.join(os.homedir(), '.claude', 'projects'),
                    isWorking: false
                });
            }
        } catch (error) {
            // Ignore errors
        }

        // 4. Check common installation paths
        const commonPaths = [
            '/usr/local/bin/claude',
            '/usr/bin/claude',
            path.join(os.homedir(), '.local', 'bin', 'claude'),
            path.join(os.homedir(), 'bin', 'claude')
        ];

        for (const commonPath of commonPaths) {
            if (fs.existsSync(commonPath)) {
                candidates.push({
                    type: 'global',
                    executablePath: commonPath,
                    claudeDir: path.join(os.homedir(), '.claude'),
                    projectsDir: path.join(os.homedir(), '.claude', 'projects'),
                    isWorking: false
                });
            }
        }

        // 5. Check if using alternative .claude directory (for local installations)
        const workspaceFolder2 = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder2) {
            const localClaudeDir = path.join(workspaceFolder2.uri.fsPath, '.claude');
            if (fs.existsSync(localClaudeDir)) {
                candidates.push({
                    type: 'local',
                    executablePath: 'claude', // Will use PATH
                    claudeDir: localClaudeDir,
                    projectsDir: path.join(localClaudeDir, 'projects'),
                    isWorking: false
                });
            }
        }

        // Remove duplicates based on executable path
        const uniqueCandidates = candidates.filter((candidate, index, arr) => 
            arr.findIndex(c => c.executablePath === candidate.executablePath && c.claudeDir === candidate.claudeDir) === index
        );

        this.outputChannel.appendLine(`Found ${uniqueCandidates.length} installation candidates`);
        return uniqueCandidates;
    }

    /**
     * Validate if a Claude installation candidate is working
     */
    private async validateInstallation(candidate: ClaudeInstallation): Promise<boolean> {
        try {
            // Test 1: Check if executable exists and is accessible
            if (candidate.executablePath !== 'claude' && !fs.existsSync(candidate.executablePath)) {
                this.outputChannel.appendLine(`  ❌ Executable not found: ${candidate.executablePath}`);
                return false;
            }

            // Test 2: Try to get version
            try {
                const versionOutput = await this.execPromise(`${candidate.executablePath} --version`, { timeout: 5000 });
                candidate.version = versionOutput.trim();
                this.outputChannel.appendLine(`  ✅ Version: ${candidate.version}`);
            } catch (error) {
                this.outputChannel.appendLine(`  ❌ Cannot get version: ${error}`);
                return false;
            }

            // Test 3: Check if .claude directory exists and has expected structure
            if (!fs.existsSync(candidate.claudeDir)) {
                this.outputChannel.appendLine(`  ❌ Claude directory not found: ${candidate.claudeDir}`);
                return false;
            }

            // Test 4: Check for projects directory
            if (!fs.existsSync(candidate.projectsDir)) {
                this.outputChannel.appendLine(`  ⚠️  Projects directory not found (will be created): ${candidate.projectsDir}`);
                // This is not a failure - directory might not exist yet
            } else {
                this.outputChannel.appendLine(`  ✅ Projects directory exists: ${candidate.projectsDir}`);
            }

            // Test 5: Try a simple command to ensure it's responsive
            try {
                await this.execPromise(`${candidate.executablePath} --help`, { timeout: 5000 });
                this.outputChannel.appendLine(`  ✅ Help command works`);
            } catch (error) {
                this.outputChannel.appendLine(`  ❌ Help command failed: ${error}`);
                return false;
            }

            candidate.isWorking = true;
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`  ❌ Validation failed: ${error}`);
            return false;
        }
    }

    /**
     * Try to fix or suggest fixes for common installation issues
     */
    async diagnoseProblem(): Promise<string[]> {
        const suggestions: string[] = [];
        
        try {
            // Check if npm is available
            await this.execPromise('npm --version', { timeout: 3000 });
            
            // Check if global installation exists but is not in PATH
            try {
                const globalPrefix = await this.execPromise('npm config get prefix');
                const globalBinPath = path.join(globalPrefix.trim(), 'bin', 'claude');
                
                if (fs.existsSync(globalBinPath)) {
                    suggestions.push(`Found Claude at ${globalBinPath} but it's not in PATH. Add ${path.dirname(globalBinPath)} to your PATH.`);
                } else {
                    suggestions.push('Install Claude Code globally: npm install -g @anthropic-ai/claude-code');
                }
            } catch (error) {
                suggestions.push('Install Claude Code globally: npm install -g @anthropic-ai/claude-code');
            }
            
        } catch (error) {
            suggestions.push('Node.js/npm not found. Install Node.js first, then: npm install -g @anthropic-ai/claude-code');
        }

        // Check for local installation possibility
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder && fs.existsSync(path.join(workspaceFolder.uri.fsPath, 'package.json'))) {
            suggestions.push(`Install Claude Code locally in this project: cd ${workspaceFolder.uri.fsPath} && npm install @anthropic-ai/claude-code`);
        }

        return suggestions;
    }

    /**
     * Helper to execute commands with promises
     */
    private execPromise(command: string, options: { timeout?: number } = {}): Promise<string> {
        const { exec } = require('child_process');
        
        return new Promise((resolve, reject) => {
            const child = exec(command, { 
                timeout: options.timeout || 10000,
                maxBuffer: 1024 * 1024 
            }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });

            if (options.timeout) {
                setTimeout(() => {
                    child.kill();
                    reject(new Error('Command timed out'));
                }, options.timeout);
            }
        });
    }

    /**
     * Get installation info for display
     */
    getInstallationInfo(installation: ClaudeInstallation): string {
        const lines = [
            `📍 **Installation Type:** ${installation.type}`,
            `📂 **Executable:** ${installation.executablePath}`,
            `🏠 **Claude Directory:** ${installation.claudeDir}`,
            `📁 **Projects Directory:** ${installation.projectsDir}`,
        ];

        if (installation.version) {
            lines.push(`📋 **Version:** ${installation.version}`);
        }

        lines.push(`${installation.isWorking ? '✅' : '❌'} **Status:** ${installation.isWorking ? 'Working' : 'Not Working'}`);

        return lines.join('\n');
    }
}