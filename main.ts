#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateQuery } from "./validators.js";
import {
  listProjects,
  listEnvironments,
  getEnvironmentInfo,
  getDeployment,
  listActivities,
  getActivityLog,
  listVariablesEnv,
  listVariablesProject,
  createBranch,
  getProjectGitUrl,
} from "./api-client.js";
import {
  getRelationshipsViaSsh,
  getLogViaSsh,
  execSqlViaSsh,
  pushBranch,
} from "./ssh-client.js";

const server = new McpServer({
  name: "mcp-magento-cloud",
  version: "2.0.0",
});

// ─── REST API Tools ───────────────────────────────────────────────

server.tool(
  "list_projects",
  "List all Magento Cloud projects available to the current user",
  {},
  async () => {
    try {
      const projects = await listProjects();
      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error listing projects:\n${message}` }],
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
    try {
      const environments = await listEnvironments(project);
      const result = environments.map((env) => ({
        id: env.id,
        title: env.title,
        status: env.status,
        type: env.type,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error listing environments:\n${message}` }],
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
    try {
      const info = await getEnvironmentInfo(project, environment);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error getting environment info:\n${message}` }],
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
    try {
      const deployment = await getDeployment(project, environment);
      const routes = deployment.routes;

      if (primary) {
        const primaryRoute = Object.entries(routes).find(
          ([, route]) => route.primary === true
        );
        const url = primaryRoute ? primaryRoute[0] : Object.keys(routes)[0];
        return {
          content: [{ type: "text", text: url || "No routes found" }],
        };
      }

      const urls = Object.entries(routes).map(([url, route]) => ({
        url,
        type: route.type,
        primary: route.primary || false,
        upstream: route.upstream,
        original_url: route.original_url,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(urls, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error getting environment URLs:\n${message}` }],
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
    type: z.string().optional().describe("Filter by activity type, e.g. 'push', 'cron', 'environment.backup'"),
    state: z.enum(["in_progress", "pending", "complete", "cancelled"]).optional().describe("Filter by activity state"),
    result: z.enum(["success", "failure"]).optional().describe("Filter by activity result"),
    start: z.string().optional().describe("Only list activities created before this date, e.g. '2026-05-01'"),
  },
  async ({ project, environment, limit, type, state, result, start }) => {
    try {
      const activities = await listActivities(project, environment, {
        limit,
        type,
        state,
        result,
        start,
      });

      const result_ = activities.map((act) => ({
        id: act.id,
        created_at: act.created_at,
        description: act.description,
        progress: act.progress,
        state: act.state,
        result: act.result,
        type: act.type,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result_, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error listing activities:\n${message}` }],
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
  },
  async ({ project, environment, id }) => {
    try {
      const log = await getActivityLog(project, environment, id);
      return {
        content: [{ type: "text", text: log }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error getting activity log:\n${message}` }],
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
    try {
      let variables;
      if (level === "project") {
        variables = await listVariablesProject(project);
      } else if (level === "environment") {
        variables = await listVariablesEnv(project, environment);
      } else {
        // List both
        const [projVars, envVars] = await Promise.all([
          listVariablesProject(project),
          listVariablesEnv(project, environment),
        ]);
        variables = [
          ...projVars.map((v) => ({ ...v, level: "project" })),
          ...envVars.map((v) => ({ ...v, level: "environment" })),
        ];
      }

      return {
        content: [{ type: "text", text: JSON.stringify(variables, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error listing variables:\n${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_services",
  "List services (MySQL, Redis, OpenSearch, RabbitMQ, etc.) in a Magento Cloud project with their versions and disk allocation",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
  },
  async ({ project, environment }) => {
    try {
      const deployment = await getDeployment(project, environment);
      const services = Object.entries(deployment.services).map(([name, svc]) => ({
        name,
        type: svc.type,
        disk: svc.disk,
        size: svc.size,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(services, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error listing services:\n${message}` }],
        isError: true,
      };
    }
  }
);

// ─── SSH Tools (via ssh2 library, no CLI needed) ─────────────────

server.tool(
  "execute_sql",
  "Execute a read-only SQL query on a Magento Cloud environment via SSH",
  {
    query: z.string().describe("The SQL query to execute"),
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
  },
  async ({ query, project, environment }) => {
    try {
      validateQuery(query);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Validation error: ${message}` }],
        isError: true,
      };
    }

    try {
      const output = await execSqlViaSsh(project, environment, query);
      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error executing query:\n${message}` }],
        isError: true,
      };
    }
  }
);

const LOG_TYPES = [
  "access", "cron", "deploy", "error", "newrelic_php_agent",
  "php.access", "php5-fpm-xdebug", "php5-fpm", "post_deploy",
  "router", "site", "xdebug.access",
] as const;

server.tool(
  "list_log_types",
  "List the available log types for Magento Cloud environments",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(LOG_TYPES, null, 2) }],
  })
);

server.tool(
  "get_environment_logs",
  "Read logs from a Magento Cloud environment via SSH. Use list_log_types to see available log types.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
    type: z.enum(LOG_TYPES).describe("The log type to read, e.g. 'deploy', 'error', 'cron'"),
    lines: z.number().optional().describe("Number of lines to return (optional, defaults to 100)"),
  },
  async ({ project, environment, type, lines }) => {
    try {
      const output = await getLogViaSsh(project, environment, type, lines || 100);
      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error reading logs:\n${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_environment_relationships",
  "Get the service relationships (database, redis, opensearch, rabbitmq, etc.) for a Magento Cloud environment via SSH. Returns connection details including host, port, username, password and URL for each service.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    environment: z.string().describe("The environment name, e.g. 'staging', 'production'"),
  },
  async ({ project, environment }) => {
    try {
      const relationships = await getRelationshipsViaSsh(project, environment);
      return {
        content: [{ type: "text", text: JSON.stringify(relationships, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error getting relationships:\n${message}` }],
        isError: true,
      };
    }
  }
);

// ─── Write Tools ──────────────────────────────────────────────────

server.tool(
  "create_branch",
  "Create a new environment branch from integration. The new branch will be a clone of the integration environment.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    branch_name: z.string().describe("The branch name (ID) for the new environment, e.g. 'feature-xyz', 'bugfix-123'"),
    title: z.string().optional().describe("Human-readable title for the branch. Defaults to the branch name if not provided."),
  },
  async ({ project, branch_name, title }) => {
    try {
      const result = await createBranch(project, branch_name, title || branch_name);
      return {
        content: [
          {
            type: "text",
            text: `Branch '${branch_name}' created successfully from integration.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error creating branch:\n${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "push_branch",
  "Push a local git branch to a Magento Cloud project. Uses SSH certificate authentication — no separate git credentials needed. The branch must exist locally.",
  {
    project: z.string().describe("The Magento Cloud project ID"),
    repo_path: z.string().describe("Absolute path to the local git repository, e.g. '/home/user/myproject'"),
    local_branch: z.string().describe("Local branch name to push, e.g. 'feature-xyz'"),
    remote_branch: z.string().optional().describe("Remote branch name. Defaults to the same as local_branch."),
  },
  async ({ project, repo_path, local_branch, remote_branch }) => {
    try {
      const gitRemoteUrl = await getProjectGitUrl(project);
      const output = await pushBranch(repo_path, gitRemoteUrl, local_branch, remote_branch);
      return {
        content: [
          {
            type: "text",
            text: `Branch pushed successfully to Magento Cloud.\n\n${output}`,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error pushing branch:\n${message}` }],
        isError: true,
      };
    }
  }
);

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
