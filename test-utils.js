const { AnsiColorConverter, ClaudeOutputParser } = require('./dist/utils/AnsiColorConverter');

// Test ANSI color conversion
console.log('🎨 Testing ANSI Color Conversion:');
const ansiText = '\x1b[31mRed text\x1b[0m \x1b[32mGreen text\x1b[0m \x1b[33mYellow text\x1b[0m';
console.log('Original:', ansiText);
console.log('Converted HTML:', AnsiColorConverter.toHtml(ansiText));
console.log('Has ANSI:', AnsiColorConverter.hasAnsiCodes(ansiText));
console.log('Plain text:', AnsiColorConverter.toPlainText(ansiText));

// Test TODO parsing
console.log('\n📋 Testing TODO List Parsing:');
const todoText = `
Here's what I need to do:
- [x] Implement streaming client
- [ ] Add error handling
- [ ] Write tests
1. [x] Setup basic structure
2. [ ] Add documentation
`;
const todos = ClaudeOutputParser.parseTodoList(todoText);
console.log('Parsed TODOs:', JSON.stringify(todos, null, 2));

// Test tool calls parsing
console.log('\n🔧 Testing Tool Call Parsing:');
const toolText = '🔧 Using tool: file_read (path="/test.js") and 🔧 Tool: bash_execute (command="ls -la")';
const toolCalls = ClaudeOutputParser.parseToolCalls(toolText);
console.log('Parsed tool calls:', JSON.stringify(toolCalls, null, 2));

// Test thinking text detection
console.log('\n💭 Testing Thinking Detection:');
const thinkingTexts = [
    '🤔 Let me analyze this request...',
    'I need to understand the requirements first',
    'thinking about the best approach',
    'Regular response text'
];
thinkingTexts.forEach(text => {
    console.log(`"${text}" is thinking:`, ClaudeOutputParser.isThinkingText(text));
});

console.log('\n✅ All tests completed!');