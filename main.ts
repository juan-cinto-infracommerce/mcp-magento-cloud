#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { validateQuery } from './validators.js';
import { parseTsv } from './parsers.js';

/**
 * Build an env object that prepends ~/.magento-cloud/bin to PATH,
 * so the CLI is found even when the MCP host doesn't inherit the
 * user's shell profile.
 */
function execEnv(): NodeJS.ProcessEnv {
  const magentoCloudBin = join(homedir(), ".magento-cloud", "bin");
  return {
    ...process.env,
    PATH: `${magentoCloudBin}:${process.env.PATH ?? ""}`,
  };
}

const server = new McpServer({
  name: "mcp-magento-cloud",
  version: "1.0.1",
});

server.tool(
  "execute_sql",
  "Execute a read-only SQL query on a Magento Cloud environment using `magento-cloud db:sql`",
  {
    query: z.string().describe("The SQL query to execute"),
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
  },
  async ({ query, project, environment }) => {
    // Validate query is read-only using validators module
    try {
      validateQuery(query);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Validation error: ${message}`,
          },
        ],
        isError: true,
      };
    }

    const args = ["db:sql", "-p", project, "-e", environment, "-r", "database-slave"];

    // Query must be the last positional argument
    const escapedQuery = query.replace(/"/g, '\\"');
    const cmd = `magento-cloud ${args.join(" ")} "${escapedQuery}"`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing query:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_projects",
  "List all Magento Cloud projects available to the current user",
  {},
  async () => {
    try {
      const output = execSync("magento-cloud project:list --format tsv --no-header", {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      const projects = parseTsv(output, ["id", "title", "region"]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing projects:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_environments",
  "List all environments for a Magento Cloud project",
  {
    project: z.string().describe("The Magento Cloud project ID"),
  },
  async ({ project }) => {
    const cmd = `magento-cloud environment:list -p ${project} --format tsv --no-header`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      const environments = parseTsv(output, ["id", "title", "status", "type"]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(environments, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing environments:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_environment_info",
  "Get detailed information about a specific Magento Cloud environment (status, URLs, type, etc.)",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
  },
  async ({ project, environment }) => {
    const cmd = `magento-cloud environment:info -p ${project} -e ${environment} --format tsv --no-header`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      const info = parseTsv(output, ["property", "value"]);

      // Convert array of {property, value} into a single object
      const result: Record<string, string> = {};
      for (const row of info) {
        if (row.property) {
          result[row.property] = row.value;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting environment info:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

const LOG_TYPES = [
  "access",
  "cron",
  "deploy",
  "error",
  "newrelic_php_agent",
  "php.access",
  "php5-fpm-xdebug",
  "php5-fpm",
  "post_deploy",
  "router",
  "site",
  "xdebug.access",
] as const;

server.tool(
  "list_log_types",
  "List the available log types for Magento Cloud environments",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(LOG_TYPES, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_environment_logs",
  "Read logs from a Magento Cloud environment. Use list_log_types to see available log types.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
    type: z.enum(LOG_TYPES).describe("The log type to read, e.g. 'deploy', 'error', 'cron'"),
    lines: z.number().optional().describe("Number of lines to return (optional, defaults to 100)"),
  },
  async ({ project, environment, type, lines }) => {
    const args = ["environment:logs", "-p", project, "-e", environment];

    if (lines) {
      args.push("--lines", String(lines));
    }

    args.push(type);

    const cmd = `magento-cloud ${args.join(" ")}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error reading logs:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_environment_relationships",
  "Get the service relationships (database, redis, opensearch, rabbitmq, etc.) for a Magento Cloud environment. Returns connection details including host, port, username, password and URL for each service.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
  },
  async ({ project, environment }) => {
    const cmd = `magento-cloud environment:relationships -p ${project} -e ${environment}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting relationships:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_activities",
  "List recent activities (deploys, pushes, crons, etc.) for a Magento Cloud environment or project",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
    limit: z.number().optional().describe("Number of activities to return (default: 10)"),
    type: z.string().optional().describe("Filter by activity type, e.g. 'push', 'cron', 'environment.backup'. Supports wildcards like '%var%'"),
    exclude_type: z.string().optional().describe("Exclude activities by type, e.g. '*.cron,*.backup*'"),
    state: z.enum(["in_progress", "pending", "complete", "cancelled"]).optional().describe("Filter by activity state"),
    result: z.enum(["success", "failure"]).optional().describe("Filter by activity result"),
    start: z.string().optional().describe("Only list activities created before this date, e.g. '2026-05-01'"),
  },
  async ({ project, environment, limit, type, exclude_type, state, result, start }) => {
    const args = ["activity:list", "-p", project, "-e", environment];

    if (limit) {
      args.push("--limit", String(limit));
    }
    if (type) {
      args.push("--type", type);
    }
    if (exclude_type) {
      args.push("--exclude-type", exclude_type);
    }
    if (state) {
      args.push("--state", state);
    }
    if (result) {
      args.push("--result", result);
    }
    if (start) {
      args.push("--start", start);
    }

    args.push("--format", "tsv", "--no-header");

    const cmd = `magento-cloud ${args.join(" ")}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      const activities = parseTsv(output, ["id", "created", "description", "progress", "state", "result"]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(activities, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing activities:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_activity_log",
  "Display the log output for a specific activity on a Magento Cloud environment. If no activity ID is provided, shows the log for the most recent activity.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
    id: z.string().optional().describe("The activity ID. Defaults to the most recent activity if omitted. Use list_activities to find IDs."),
    type: z.string().optional().describe("Filter by type when selecting default activity, e.g. 'environment.push', '%push'. Supports wildcards."),
    timestamps: z.boolean().optional().describe("Display a timestamp next to each log message"),
  },
  async ({ project, environment, id, type, timestamps }) => {
    const args = ["activity:log", "-p", project, "-e", environment, "--no-interaction", "--refresh", "0"];

    if (type) {
      args.push("--type", type);
    }
    if (timestamps) {
      args.push("--timestamps");
    }
    if (id) {
      args.push(id);
    }

    const cmd = `magento-cloud ${args.join(" ")}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 120_000,
        env: execEnv(),
      });

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting activity log:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_variables",
  "List variables for a Magento Cloud project or environment",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
    level: z.enum(["project", "environment"]).optional().describe("The variable level: 'project' or 'environment'. Lists all if omitted."),
  },
  async ({ project, environment, level }) => {
    const args = ["variable:list", "-p", project, "-e", environment];

    if (level) {
      args.push("--level", level);
    }

    args.push("--format", "csv");

    const cmd = `magento-cloud ${args.join(" ")}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing variables:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_environment_urls",
  "Get the public URLs of a Magento Cloud environment",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
    primary: z.boolean().optional().describe("Only return the URL for the primary route"),
  },
  async ({ project, environment, primary }) => {
    const args = ["environment:url", "-p", project, "-e", environment, "--browser", "0", "--pipe"];

    if (primary) {
      args.push("--primary");
    }

    const cmd = `magento-cloud ${args.join(" ")}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 60_000,
        env: execEnv(),
      });

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting environment URLs:\n${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
