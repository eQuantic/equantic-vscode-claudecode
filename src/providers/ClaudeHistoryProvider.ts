import * as vscode from 'vscode';
import { ClaudeTask } from '../types';
import { ClaudeCodeManager } from '../core/ClaudeCodeManager';

export class ClaudeHistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<HistoryItem | undefined | null | void> = new vscode.EventEmitter<HistoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<HistoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private tasks: ClaudeTask[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private claudeManager?: ClaudeCodeManager
    ) {
        this.loadTasksFromStorage();
    }

    async refresh(): Promise<void> {
        if (this.claudeManager) {
            try {
                // Load real Claude Code sessions
                this.tasks = await this.claudeManager.loadClaudeCodeSessions();
            } catch (error) {
                console.error('Error loading Claude Code sessions:', error);
                // Fall back to stored tasks
                this.loadTasksFromStorage();
            }
        } else {
            this.loadTasksFromStorage();
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: HistoryItem): Thenable<HistoryItem[]> {
        if (!element) {
            // Return root items (tasks grouped by date)
            return Promise.resolve(this.getTaskGroups());
        } else if (element.contextValue === 'taskGroup') {
            // Return tasks in this group
            const groupTasks = this.tasks.filter(task => {
                const taskDate = new Date(task.createdAt).toDateString();
                return taskDate === element.label;
            });
            return Promise.resolve(groupTasks.map(task => new TaskItem(task)));
        } else if (element.contextValue === 'task') {
            // Return messages in this task
            const task = (element as TaskItem).task;
            return Promise.resolve(task.messages.map((message, index) => new MessageItem(message, index, task.id)));
        }
        
        return Promise.resolve([]);
    }

    private getTaskGroups(): HistoryItem[] {
        const groups = new Map<string, ClaudeTask[]>();
        
        this.tasks.forEach(task => {
            const dateStr = new Date(task.createdAt).toDateString();
            if (!groups.has(dateStr)) {
                groups.set(dateStr, []);
            }
            groups.get(dateStr)!.push(task);
        });

        const sortedDates = Array.from(groups.keys()).sort((a, b) => 
            new Date(b).getTime() - new Date(a).getTime()
        );

        return sortedDates.map(date => {
            const tasksInGroup = groups.get(date)!;
            const item = new HistoryItem(
                date,
                vscode.TreeItemCollapsibleState.Collapsed,
                'taskGroup'
            );
            item.description = `${tasksInGroup.length} task${tasksInGroup.length !== 1 ? 's' : ''}`;
            item.iconPath = new vscode.ThemeIcon('history');
            return item;
        });
    }

    addTask(task: ClaudeTask): void {
        this.tasks.unshift(task);
        this.saveTasksToStorage();
        this.refresh();
    }

    updateTask(task: ClaudeTask): void {
        const index = this.tasks.findIndex(t => t.id === task.id);
        if (index !== -1) {
            this.tasks[index] = task;
            this.saveTasksToStorage();
            this.refresh();
        }
    }

    clearHistory(): void {
        this.tasks = [];
        this.saveTasksToStorage();
        this.refresh();
    }

    private loadTasksFromStorage(): void {
        const storedTasks = this.context.globalState.get<ClaudeTask[]>('claudeCodeTasks', []);
        this.tasks = storedTasks;
    }

    private saveTasksToStorage(): void {
        // Keep only the last 50 tasks to prevent excessive storage usage
        const tasksToKeep = this.tasks.slice(0, 50);
        this.context.globalState.update('claudeCodeTasks', tasksToKeep);
        this.tasks = tasksToKeep;
    }
}

class HistoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
    }
}

class TaskItem extends HistoryItem {
    constructor(public readonly task: ClaudeTask) {
        super(
            task.title.length > 40 ? task.title.substring(0, 40) + '...' : task.title,
            vscode.TreeItemCollapsibleState.Collapsed,
            'task'
        );

        const statusIcon = {
            'pending': 'clock',
            'running': 'sync~spin',
            'completed': 'check',
            'error': 'error'
        }[task.status] || 'question';

        this.iconPath = new vscode.ThemeIcon(statusIcon);
        this.description = new Date(task.createdAt).toLocaleTimeString();
        this.tooltip = `Status: ${task.status}\nCreated: ${new Date(task.createdAt).toLocaleString()}\nMessages: ${task.messages.length}`;
        
        // Add command to resume session in chat
        this.command = {
            command: 'equantic-claude-code.resumeSession',
            title: 'Resume Session',
            arguments: [task.id]
        };
        
        // Add session ID to tooltip if available
        if (task.metadata?.sessionId) {
            this.tooltip += `\nSession ID: ${task.metadata.sessionId}`;
        }
    }
}

class MessageItem extends HistoryItem {
    constructor(
        private readonly message: any,
        private readonly index: number,
        private readonly taskId: string
    ) {
        const content = message.content.length > 60 
            ? message.content.substring(0, 60) + '...' 
            : message.content;
        
        super(content, vscode.TreeItemCollapsibleState.None, 'message');
        
        const roleIcon = message.role === 'user' ? 'person' : 'robot';
        this.iconPath = new vscode.ThemeIcon(roleIcon);
        this.description = new Date(message.timestamp).toLocaleTimeString();
        this.tooltip = `${message.role}: ${message.content}`;
    }
}