# mcp-magento-cloud

MCP (Model Context Protocol) server for Adobe Commerce Cloud. Allows AI agents to interact with Magento Cloud projects — query databases, read logs, list environments, inspect activities, and more.

## Versions

| Version | Description | Requirements |
|---------|-------------|--------------|
| **v2.x** (latest) | Uses REST API + SSH directly. No PHP CLI needed. | Node.js 20+, API token, `ssh` binary |
| **v1.x** | Wraps the `magento-cloud` PHP CLI. | Node.js 20+, `magento-cloud` CLI installed and authenticated |

### Using a specific version

```bash
# Latest (v2.x)
npx -y mcp-magento-cloud

# v1.x (requires magento-cloud CLI)
npx -y mcp-magento-cloud@1.0.1
```

## Prerequisites (v2.x)

- **Node.js 20+**
- **Magento Cloud API token** — Create one at https://accounts.magento.cloud/user/api-tokens
- **`ssh` binary** — Required for SSH-based tools (`execute_sql`, `get_environment_logs`, `get_environment_relationships`). Available by default on Linux/macOS.

## Quick Start

### 1. Get an API token

Go to https://accounts.magento.cloud/user/api-tokens and create a new token.

### 2. Configure your MCP client

#### Kilo

In `~/.config/kilo/kilo.json`:

```json
{
  "mcp": {
    "magento-cloud": {
      "type": "local",
      "command": ["npx", "-y", "mcp-magento-cloud"],
      "environment": {
        "MAGENTO_CLOUD_CLI_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

#### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "magento-cloud": {
      "command": "npx",
      "args": ["-y", "mcp-magento-cloud"],
      "env": {
        "MAGENTO_CLOUD_CLI_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

#### Gemini CLI

In `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "magento-cloud": {
      "command": "npx",
      "args": ["-y", "mcp-magento-cloud"],
      "env": {
        "MAGENTO_CLOUD_CLI_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## Available Tools

### REST API Tools (no CLI needed)

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects available to the current user |
| `list_environments` | List all environments for a project |
| `get_environment_info` | Get detailed info about an environment |
| `get_environment_urls` | Get the public URLs of an environment |
| `list_activities` | List recent activities with filters |
| `get_activity_log` | Display the full log for an activity |
| `list_variables` | List project or environment variables |
| `list_services` | List services with versions and disk allocation |

### SSH Tools (via SSH certificates, no CLI needed)

| Tool | Description |
|------|-------------|
| `execute_sql` | Execute a read-only SQL query on the remote database |
| `get_environment_logs` | Read server logs (deploy, error, cron, etc.) |
| `get_environment_relationships` | Get service connection details (host, port, credentials) |
| `list_log_types` | List available log types |

## Security

- **SQL queries are validated** — only SELECT, SHOW, DESCRIBE, and EXPLAIN are allowed
- SQL comments are stripped and multiple statements are blocked
- SSH authentication uses temporary Ed25519 certificates signed by the Magento Cloud API
- No write/mutation commands are exposed

## Testing with MCP Inspector

```bash
MAGENTO_CLOUD_CLI_TOKEN=your-token npx @modelcontextprotocol/inspector node dist/main.js
```

## Development

```bash
git clone https://github.com/juan-cinto-infracommerce/mcp-magento-cloud.git
cd mcp-magento-cloud
npm install
npm run build
npm start
```

## License

MIT
