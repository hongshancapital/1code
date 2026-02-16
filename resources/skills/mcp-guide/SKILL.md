---
name: mcp-guide
description: "This skill should be used when the user asks to \"install MCP\", \"add an MCP server\", \"configure MCP\", \"set up MCP\", \"connect MCP server\", \"remove MCP server\", or mentions MCP installation, configuration paths, or troubleshooting MCP connection issues. Provides configuration file locations, JSON format, and installation workflow for Claude Code MCP servers."
---

# MCP Server Installation & Configuration

## When to Use
- Install or add a new MCP server.
- Configure or reconfigure an existing MCP server.
- Remove an MCP server from configuration.
- Troubleshoot MCP server connection failures.
- Determine where MCP configuration is stored.

## Configuration File

All MCP server configuration lives in a single file: `~/.claude.json`

Two scopes are available:

### Global Scope (all projects)

Add to root-level `mcpServers`:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@scope/mcp-server-name"]
    }
  }
}
```

### Project Scope (specific project only)

Add under `projects` with the absolute project path as key:

```json
{
  "projects": {
    "/absolute/path/to/project": {
      "mcpServers": {
        "server-name": {
          "command": "npx",
          "args": ["-y", "@scope/mcp-server-name"]
        }
      }
    }
  }
}
```

## Server Transport Types

### stdio (local command-line tool)

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-name"],
  "env": {
    "API_KEY": "user-provided-key"
  }
}
```

### HTTP / SSE (remote service)

```json
{
  "url": "https://server.example.com/mcp",
  "headers": {
    "Authorization": "Bearer token-here"
  }
}
```

## Installation Workflow

1. Read the existing `~/.claude.json` (create `{}` if file does not exist).
2. Determine scope — ask the user if unclear:
   - **Global**: add to root `mcpServers`
   - **Project**: add to `projects["/abs/path"].mcpServers`
3. Merge the new server config into the existing JSON — never overwrite unrelated keys.
4. Write back the updated JSON with proper formatting (`JSON.stringify(config, null, 2)`).
5. Inform the user: start a new chat session for the MCP server to load.

## Removal Workflow

1. Read the existing `~/.claude.json`.
2. Locate the server entry — check both root `mcpServers` and `projects[path].mcpServers`.
3. Delete only the target server key. Preserve all other configuration.
4. Write back the updated JSON.

## Critical Rules

- Always read `~/.claude.json` before writing — preserve all existing configuration.
- Use absolute paths for project scope keys (e.g., `/Users/chris/projects/myapp`).
- Use lowercase with hyphens for server names (e.g., `my-server`).
- For npx-based servers, always include the `-y` flag to skip install confirmation.
- Never guess or fabricate API keys — ask the user if a key is required.
- After writing, remind the user to open a new chat session (MCP loads at session start).
- Validate JSON syntax before writing (no trailing commas, proper quoting).

## Troubleshooting

| Problem | Solution |
|---------|----------|
| MCP not loading after config change | Open a new chat session (MCP loads at session start) |
| "command not found" for npx | Ensure Node.js is installed and `npx` is in PATH |
| Server fails to connect | Run the command manually in terminal to verify it works |
| Permission denied on config file | Check file permissions: `ls -la ~/.claude.json` |
| JSON parse error in config | Validate syntax — common issues: trailing commas, missing quotes |
| Server name hyphens cause errors | Hong sanitizes hyphens to underscores for SDK compatibility — automatic |

## Additional Resources

### Reference Files

For a catalog of popular MCP servers with ready-to-use configurations:
- **`references/common-servers.md`** — Installation configs for Context7, Filesystem, GitHub, Puppeteer, SQLite, and more.
