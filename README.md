# mcp-magento-cloud

MCP (Model Context Protocol) server for Adobe Commerce Cloud. Allows AI agents to interact with Magento Cloud projects — query databases, read logs, list environments, inspect activities, and more.

**No PHP CLI required** — uses the REST API and SSH directly.

## Versions

| Version | Description | Requirements |
|---------|-------------|--------------|
| **v2.x** (latest) | REST API + SSH directly. Browser login or API token. | Node.js 20+, `ssh` binary |
| **v1.x** | Wraps the `magento-cloud` PHP CLI. | Node.js 20+, `magento-cloud` CLI installed |

### Using a specific version

```bash
# Latest (v2.x)
npx -y mcp-magento-cloud

# v1.x (requires magento-cloud CLI)
npx -y mcp-magento-cloud@1.0.1
```

## Prerequisites (v2.x)

- **Node.js 20+**
- **`ssh` binary** — Available by default on Linux/macOS

## Quick Start

### Authentication

You have two options to authenticate:

#### Option A: Browser login (recommended)

```bash
npx mcp-magento-cloud-login
```

This opens your browser for OAuth2 login via your Adobe/Magento account. Credentials are stored locally in `~/.config/mcp-magento-cloud/credentials.json`. No need to create or manage API tokens.

To logout:

```bash
npx mcp-magento-cloud-login logout
```

#### Option B: API token

Create a token at https://accounts.magento.cloud/user/api-tokens and pass it as an environment variable (`MAGENTO_CLOUD_CLI_TOKEN`).

> **Security note:** API tokens grant full access to all projects your account has access to. Treat them as sensitive secrets. If a token is compromised, revoke it immediately at the URL above.

### Configure your MCP client

#### Kilo

In `~/.config/kilo/kilo.json`:

```json
{
  "mcp": {
    "magento-cloud": {
      "type": "local",
      "command": ["npx", "-y", "mcp-magento-cloud"]
    }
  }
}
```

If using an API token instead of browser login, add the `environment` key:

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
      "args": ["-y", "mcp-magento-cloud"]
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
      "args": ["-y", "mcp-magento-cloud"]
    }
  }
}
```

## Available Tools

### REST API Tools

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

### SSH Tools

| Tool | Description |
|------|-------------|
| `execute_sql` | Execute a read-only SQL query on the remote database |
| `get_environment_logs` | Read server logs (deploy, error, cron, etc.) |
| `get_environment_relationships` | Get service connection details (host, port, credentials) |
| `list_log_types` | List available log types |

## Security

- **Read-only** — no write/mutation commands are exposed
- **SQL queries are validated** — only SELECT, SHOW, DESCRIBE, and EXPLAIN are allowed
- SQL comments are stripped and multiple statements are blocked to prevent injection
- SSH authentication uses temporary Ed25519 certificates signed by the Magento Cloud API
- Browser login stores refresh tokens locally with `0600` permissions
- API tokens should be treated as sensitive secrets — they grant full access to all projects

## Testing with MCP Inspector

```bash
# With browser login (run npx mcp-magento-cloud-login first)
npx @modelcontextprotocol/inspector node dist/main.js

# With API token
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
