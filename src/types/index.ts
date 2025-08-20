export interface ClaudeMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    files?: string[];
    metadata?: {
        toolCalls?: ToolCall[];
        taskId?: string;
        status?: 'pending' | 'running' | 'completed' | 'error';
        sessionId?: string;
        requestId?: string;
        toolUseResult?: any;
        [key: string]: any;
    };
}

export interface ToolCall {
    id: string;
    name: string;
    parameters: Record<string, any>;
    result?: any;
    status: 'pending' | 'running' | 'completed' | 'error';
}

export interface ClaudeTask {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    messages: ClaudeMessage[];
    createdAt: number;
    updatedAt: number;
    metadata?: {
        sessionId?: string;
        cwd?: string;
        version?: string;
        gitBranch?: string;
        projectDir?: string;
        [key: string]: any;
    };
}

export interface ClaudeCodeConfig {
    claudeExecutablePath: string;
    autoStart: boolean;
    maxTokens: number;
    temperature: number;
    showNotifications: boolean;
}

export interface FileContext {
    path: string;
    content?: string;
    selection?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

export interface WorkspaceContext {
    rootPath: string;
    openFiles: FileContext[];
    currentFile?: FileContext;
}