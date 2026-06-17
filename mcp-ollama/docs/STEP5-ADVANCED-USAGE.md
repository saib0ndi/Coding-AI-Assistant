# Step 5: Advanced Usage

## API Integration

Use the MCP server directly via REST API:

```bash
# Generate code
curl -X POST http://localhost:3078/generate-code \
  -H "Content-Type: application/json" \
  -d '{"description": "Create a REST API", "language": "python"}'

# Analyze code
curl -X POST http://localhost:3078/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "def hello(): print(\"world\")", "language": "python"}'

# Fix errors
curl -X POST http://localhost:3078/fix-error \
  -H "Content-Type: application/json" \
  -d '{"code": "print(hello)", "error": "NameError", "language": "python"}'
```

## Custom Workflows

**Development Workflow:**
1. Write code
2. Use `/review` for code review
3. Use `/test` to generate tests
4. Use `/docs` for documentation

**Debugging Workflow:**
1. Select error code
2. Right-click → "Fix Code Issues"
3. Review suggested fixes
4. Apply changes

## Extension Settings

Advanced configuration options:

```json
{
  "mcp-ollama.serverUrl": "http://localhost:3078",
  "mcp-ollama.model": "llama3.1:8b-instruct-q4_K_M",
  "mcp-ollama.maxSuggestions": 3,
  "mcp-ollama.suggestionDelay": 500,
  "mcp-ollama.enableAgentCommands": true,
  "mcp-ollama.showWorkflowProgress": true,
  "mcp-ollama.enableDiffViewer": true
}
```

## Run Your Own Server (Optional)

If you want to run your own MCP server:

```bash
# Quick setup
./docker-setup.sh

# Manual setup
npm install
npm run build
npm start

# Update extension settings to use localhost:3078
```

## Troubleshooting

**Extension not working?**
- Check server URL in settings
- Test: `curl http://localhost:3078/health`

**No suggestions appearing?**
- Check if extension is enabled
- Restart VSCode
- Check output panel for errors

**Server not responding?**
- Verify network connectivity
- Check firewall settings
- Try alternative server setup

## Support

- 🐛 **Issues**: Create GitHub issue
- 📖 **Documentation**: See README.md
- 💬 **Help**: Use extension's AI chat feature