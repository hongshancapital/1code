# Common MCP Servers — Ready-to-Use Configurations

Reference catalog of popular MCP servers. Copy the JSON config into `~/.claude.json` under `mcpServers` (global) or `projects[path].mcpServers` (project scope).

## Documentation & Knowledge

### Context7 (Library Documentation)

Retrieves up-to-date documentation for any programming library.

```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
```

No API key required.

## File System & Database

### Filesystem

Read, write, and manage files in specified directories.

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
  }
}
```

Replace `/path/to/allowed/dir` with the directory to grant access to. Multiple directories can be listed as additional args.

### SQLite

Query and manage SQLite databases.

```json
{
  "sqlite": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/path/to/database.db"]
  }
}
```

Replace `/path/to/database.db` with the actual database file path.

### PostgreSQL

Connect to PostgreSQL databases.

```json
{
  "postgres": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-postgres"],
    "env": {
      "POSTGRES_CONNECTION_STRING": "postgresql://user:password@localhost:5432/dbname"
    }
  }
}
```

## Developer Tools

### GitHub

Interact with GitHub repositories, issues, and pull requests.

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_TOKEN": "ghp_your_personal_access_token"
    }
  }
}
```

Requires a GitHub Personal Access Token. Generate at: https://github.com/settings/tokens

### GitLab

Interact with GitLab repositories and merge requests.

```json
{
  "gitlab": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-gitlab"],
    "env": {
      "GITLAB_TOKEN": "glpat-your_access_token",
      "GITLAB_URL": "https://gitlab.com"
    }
  }
}
```

### Linear

Manage Linear issues and projects.

```json
{
  "linear": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-linear"],
    "env": {
      "LINEAR_API_KEY": "lin_api_your_key"
    }
  }
}
```

## Web & Search

### Brave Search

Web search via Brave Search API.

```json
{
  "brave-search": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-server-brave-search"],
    "env": {
      "BRAVE_API_KEY": "your_brave_api_key"
    }
  }
}
```

Get an API key at: https://brave.com/search/api/

### Puppeteer

Browser automation for scraping and testing.

```json
{
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
  }
}
```

No API key required. Requires Chrome/Chromium installed.

### Fetch

Fetch and convert web pages to markdown.

```json
{
  "fetch": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-server-fetch"]
  }
}
```

## Communication

### Slack

Interact with Slack workspaces.

```json
{
  "slack": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-slack"],
    "env": {
      "SLACK_BOT_TOKEN": "xoxb-your-bot-token"
    }
  }
}
```

Requires a Slack Bot Token with appropriate scopes.

## Cloud & Infrastructure

### AWS Knowledge Base

Query AWS Bedrock Knowledge Bases.

```json
{
  "aws-kb": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-aws-kb-retrieval"],
    "env": {
      "AWS_ACCESS_KEY_ID": "your_access_key",
      "AWS_SECRET_ACCESS_KEY": "your_secret_key",
      "AWS_REGION": "us-east-1"
    }
  }
}
```

## Notes

- All `npx` configs use the `-y` flag to auto-confirm installation.
- Replace placeholder values (API keys, paths, tokens) with actual values from the user.
- Server names use lowercase with hyphens (Hong auto-sanitizes to underscores for SDK).
- For the latest server list, consult: https://github.com/modelcontextprotocol/servers
