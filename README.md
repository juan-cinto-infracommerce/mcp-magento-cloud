# mcp-magento-cloud

MCP (Model Context Protocol) server that wraps the `magento-cloud` CLI, allowing AI agents to interact with Adobe Commerce Cloud projects — query databases, read logs, list environments, inspect activities, and more.

## Prerequisites

- **Node.js 20+**
- **`magento-cloud` CLI** installed and authenticated (`magento-cloud auth:browser-login`)

## Quick Start (no cloning required)

Add the MCP server to your client configuration and it will be installed automatically via npx:

### Kilo

In your `kilo.json` (project-level or `~/.config/kilo/kilo.json` for global):

```json
{
  "mcpServers": {
    "magento-cloud": {
      "command": "npx",
      "args": ["-y", "mcp-magento-cloud"]
    }
  }
}
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "magento-cloud": {
      "command": "npx",
      "args": ["-y", "mcp-magento-cloud"]
    }
  }
}
```

## Install from Source

```bash
git clone https://github.com/juan-cinto-infracommerce/mcp-magento-cloud.git
cd mcp-magento-cloud
npm install
npm run build
```

## Available Tools

### Projects

| Tool | Description |
|------|-------------|
| `list_projects` | List all Magento Cloud projects available to the current user |

### Environments

| Tool | Description |
|------|-------------|
| `list_environments` | List all environments for a project |
| `get_environment_info` | Get detailed info about an environment (status, type, parent, etc.) |
| `get_environment_urls` | Get the public URLs of an environment |
| `get_environment_relationships` | Get service connections (database, redis, opensearch, etc.) |

### Database

| Tool | Description |
|------|-------------|
| `execute_sql` | Execute a read-only SQL query via `magento-cloud db:sql` |

Only `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN` queries are allowed. Write operations are blocked by the validator.

### Logs

| Tool | Description |
|------|-------------|
| `list_log_types` | List available log types (deploy, error, cron, etc.) |
| `get_environment_logs` | Read logs from an environment |

### Activities

| Tool | Description |
|------|-------------|
| `list_activities` | List recent activities (deploys, pushes, crons) with filters |
| `get_activity_log` | Display the full log output for a specific activity |

### Variables

| Tool | Description |
|------|-------------|
| `list_variables` | List project or environment variables |

## Security

- **SQL queries are validated** before execution — only read-only operations are allowed
- SQL comments are stripped and multiple statements are blocked to prevent injection
- The `execute_sql` tool connects via `database-slave` relationship by default
- No write/mutation commands are exposed (no deploy, merge, push, delete, etc.)

## Development

```bash
# Run directly with tsx (no build needed)
npm run dev

# Build TypeScript
npm run build

# Run compiled version
npm start
```

## License

MIT
