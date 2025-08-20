# eQuantic Claude Code VS Code Extension

A VS Code extension that provides seamless integration with Claude Code, offering a chat-like interface similar to Cline but specifically designed for Claude Code's capabilities.

## Features

- **Interactive Chat Interface**: Chat directly with Claude Code within VS Code
- **Real-time Terminal Integration**: Connects to Claude Code CLI in real-time
- **Task Management**: Organize conversations into tasks with history
- **Workspace Context**: Automatically provides workspace context to Claude
- **File Integration**: Share files and code selections with Claude
- **Tool Call Visualization**: See Claude's tool usage in real-time

## Prerequisites

- VS Code 1.74.0 or higher
- Claude Code CLI installed and configured (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18.x or higher

## Installation

1. Clone this repository
2. Run `npm install`
3. Press F5 to run in development mode, or:
4. Run `npm run compile` to build
5. Package with `vsce package` and install the .vsix file

## Usage

1. **Open Claude Code**: Use `Ctrl+Shift+C` (Cmd+Shift+C on Mac) or click the Claude Code icon in the Activity Bar
2. **Start Chatting**: Type your questions or requests in the chat interface
3. **New Task**: Use `Ctrl+Shift+N` (Cmd+Shift+N on Mac) to start a new task
4. **Context Menu**: Right-click files or code to send them to Claude Code

## Configuration

Configure the extension in VS Code settings:

- `equantic-claude-code.claudeExecutablePath`: Path to Claude Code executable (default: "claude")
- `equantic-claude-code.autoStart`: Auto-start Claude Code session (default: true)
- `equantic-claude-code.maxTokens`: Maximum tokens for responses (default: 4096)
- `equantic-claude-code.temperature`: Response temperature (default: 0.1)
- `equantic-claude-code.showNotifications`: Show status notifications (default: true)

## Commands

- `equantic-claude-code.openChat`: Open Claude Code chat
- `equantic-claude-code.newTask`: Start a new task
- `equantic-claude-code.stopTask`: Stop current task
- `equantic-claude-code.clearHistory`: Clear chat history
- `equantic-claude-code.openSettings`: Open extension settings

## Architecture

The extension consists of several key components:

### Core Components

- **ClaudeCodeManager**: Manages the Claude Code CLI process and communication
- **ClaudeChatProvider**: Provides the webview-based chat interface
- **ClaudeHistoryProvider**: Manages task history and organization
- **ClaudeCodeExecutor**: Handles command execution and workspace integration

### Utilities

- **MessageParser**: Parses Claude Code outputs and tool calls
- **Types**: TypeScript definitions for messages, tasks, and configuration

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
vsce package
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub Issues page.