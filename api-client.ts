/**
 * Magento Cloud REST API client
 * Handles authentication and API calls directly without the PHP CLI
 *
 * Auth priority:
 * 1. MAGENTO_CLOUD_CLI_ACCESS_TOKEN env var (direct access token)
 * 2. MAGENTO_CLOUD_CLI_TOKEN env var (API token → exchanged for access token)
 * 3. Stored credentials from `npx mcp-magento-cloud-login` (refresh token → access token)
 */

import { readCredentials, saveCredentials, login } from "./login.js";

const API_BASE = "https://api.magento.cloud";
const TOKEN_URL = "https://auth.magento.cloud/oauth2/token";
const CLIENT_ID = "magento-cloud-cli";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Exchange an API token for a short-lived OAuth2 access token
 */
async function exchangeApiToken(apiToken: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "api_token",
      api_token: apiToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Exchange a refresh token for a new access token
 */
async function exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Refresh token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Get a valid access token using the best available auth method.
 *
 * When `forceRefresh` is true, every cache short-circuit is skipped — both the
 * in-memory `cachedToken` and the `credentials.accessToken` stored on disk — so
 * a token that the API has already revoked is never handed back. This is what an
 * authenticated request calls after it sees a 401.
 */
async function getAccessToken(forceRefresh = false): Promise<string> {
  // 1. Direct access token from env (nothing we can refresh here)
  const directToken = process.env.MAGENTO_CLOUD_CLI_ACCESS_TOKEN;
  if (directToken) {
    return directToken;
  }

  // Return cached token if still valid (with 60s buffer)
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }
  // Drop the (possibly revoked) cached token before re-deriving one
  if (forceRefresh) cachedToken = null;

  // 2. API token from env
  const apiToken = process.env.MAGENTO_CLOUD_CLI_TOKEN || process.env.MAGENTO_CLOUD_API_TOKEN;
  if (apiToken) {
    const data = await exchangeApiToken(apiToken);
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  // 3. Stored credentials from browser login
  const credentials = readCredentials();
  if (credentials?.refreshToken) {
    // Reuse the stored access token only when we're NOT forcing a refresh —
    // otherwise we'd hand back the same revoked token that triggered the 401.
    if (
      !forceRefresh &&
      credentials.accessToken &&
      credentials.expiresAt &&
      Date.now() < credentials.expiresAt - 60_000
    ) {
      cachedToken = {
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
      };
      return credentials.accessToken;
    }

    // Exchange refresh token for new access token
    try {
      const data = await exchangeRefreshToken(credentials.refreshToken);
      const expiresAt = Date.now() + data.expires_in * 1000;
      cachedToken = { accessToken: data.access_token, expiresAt };
      // Persist the new access token (and a rotated refresh token, if Adobe
      // returned one) so a process restart picks up fresh credentials too.
      saveCredentials({
        refreshToken: data.refresh_token || credentials.refreshToken,
        accessToken: data.access_token,
        expiresAt,
      });
      return data.access_token;
    } catch {
      // Refresh token expired — trigger browser login
      console.error("[mcp-magento-cloud] Session expired. Opening browser for login...");
      await login();
      return getAccessToken(true);
    }
  }

  // 4. No credentials at all — trigger browser login automatically
  console.error("[mcp-magento-cloud] Not authenticated. Opening browser for login...");
  await login();
  return getAccessToken(true);
}

/**
 * Perform an authenticated fetch, transparently recovering from a revoked token.
 *
 * If the first attempt returns 401, the cached token is dropped, a fresh one is
 * obtained with forceRefresh=true, and the request is retried exactly once. This
 * is what lets the server recover from a poisoned token without an MCP reconnect.
 */
async function authedFetch(url: string, init: RequestInit, headers: Record<string, string>): Promise<Response> {
  let token = await getAccessToken();
  let res = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    cachedToken = null;
    token = await getAccessToken(true);
    res = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${token}` } });
  }

  return res;
}

/**
 * Make an authenticated API request
 */
export async function apiRequest(
  path: string,
  options: { method?: string; params?: Record<string, string>; body?: string; headers?: Record<string, string> } = {}
): Promise<unknown> {
  let url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const response = await authedFetch(
    url,
    {
      method: options.method || "GET",
      ...(options.body ? { body: options.body } : {}),
    },
    {
      Accept: "application/json",
      "User-Agent": "mcp-magento-cloud/2.0.0",
      ...(options.headers || {}),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status} ${response.statusText}): ${text}`);
  }

  return response.json();
}

/**
 * Make an authenticated API request and return raw text (for NDJSON streams)
 */
export async function apiRequestText(
  path: string,
  options: { method?: string; params?: Record<string, string> } = {}
): Promise<string> {
  let url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const response = await authedFetch(
    url,
    { method: options.method || "GET" },
    { "User-Agent": "mcp-magento-cloud/2.0.0" }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status} ${response.statusText}): ${text}`);
  }

  return response.text();
}

// --- Typed API helpers ---

interface Project {
  id: string;
  title: string;
  region: string;
  [key: string]: unknown;
}

interface Environment {
  id: string;
  title: string;
  status: string;
  type: string;
  name: string;
  machine_name: string;
  parent: string | null;
  [key: string]: unknown;
}

interface Activity {
  id: string;
  created_at: string;
  description: string;
  progress: number;
  state: string;
  result: string;
  type: string;
  _links: Record<string, { href: string }>;
  [key: string]: unknown;
}

interface Variable {
  name: string;
  level: string;
  value: string;
  is_enabled: boolean;
  is_sensitive: boolean;
  [key: string]: unknown;
}

interface Deployment {
  routes: Record<string, { type: string; primary?: boolean; upstream?: string; original_url?: string; to?: string }>;
  services: Record<string, { type: string; disk: number | null; size: string; configuration?: unknown }>;
  webapps: Record<string, unknown>;
  workers: Record<string, unknown>;
  [key: string]: unknown;
}

interface UserAccess {
  resource_id: string;
  resource_type: string;
  project_id: string;
  project_title: string;
  project_region: string;
  [key: string]: unknown;
}

// Cache of project endpoint URLs: projectId -> base API URL for that project
const projectEndpointCache = new Map<string, string>();

/**
 * Get the base API endpoint for a project.
 * Projects live on regional servers (e.g. https://us-3.magento.cloud/api/projects/xxx)
 * so we must use the per-project endpoint, not the global api.magento.cloud.
 */
async function projectUrl(projectId: string, path: string = ""): Promise<string> {
  if (!projectEndpointCache.has(projectId)) {
    await listProjects(); // populate cache
  }
  const endpoint = projectEndpointCache.get(projectId);
  if (!endpoint) {
    throw new Error(`Unknown project: ${projectId}. Use list_projects to verify the ID.`);
  }
  return path ? `${endpoint}${path}` : endpoint;
}

/** List all projects the current user has access to */
export async function listProjects(): Promise<Project[]> {
  const me = (await apiRequest("/me")) as {
    id: string;
    projects: Array<{ id: string; title: string; region: string; endpoint: string }>;
  };

  for (const p of me.projects) {
    projectEndpointCache.set(p.id, p.endpoint);
  }

  return me.projects.map((p) => ({
    id: p.id,
    title: p.title,
    region: p.region,
  }));
}

/** List environments for a project */
export async function listEnvironments(projectId: string): Promise<Environment[]> {
  const url = await projectUrl(projectId, "/environments");
  return (await apiRequest(url)) as Environment[];
}

/** Get environment details */
export async function getEnvironmentInfo(projectId: string, envId: string): Promise<Environment> {
  const url = await projectUrl(projectId, `/environments/${envId}`);
  return (await apiRequest(url)) as Environment;
}

/** Get current deployment (routes, services, etc.) */
export async function getDeployment(projectId: string, envId: string): Promise<Deployment> {
  const url = await projectUrl(projectId, `/environments/${envId}/deployments/current`);
  return (await apiRequest(url)) as Deployment;
}

/** List activities for an environment */
export async function listActivities(
  projectId: string,
  envId: string,
  options: {
    type?: string;
    exclude_type?: string;
    state?: string;
    result?: string;
    limit?: number;
    start?: string;
  } = {}
): Promise<Activity[]> {
  const params: Record<string, string> = {};
  if (options.type) params["type"] = options.type;
  if (options.state) params["state"] = options.state;
  if (options.result) params["result"] = options.result;
  if (options.limit) params["count"] = String(options.limit);
  if (options.start) params["starts_at"] = options.start;

  const url = await projectUrl(projectId, `/environments/${envId}/activities`);
  return (await apiRequest(url, { params })) as Activity[];
}

/** Get activity log (NDJSON) */
export async function getActivityLog(
  projectId: string,
  envId: string,
  activityId?: string
): Promise<string> {
  // If no ID, get the most recent activity
  if (!activityId) {
    const activities = await listActivities(projectId, envId, { limit: 1 });
    if (activities.length === 0) {
      throw new Error("No activities found for this environment.");
    }
    activityId = activities[0].id;
  }

  const actUrl = await projectUrl(projectId, `/environments/${envId}/activities/${activityId}`);
  const activity = (await apiRequest(actUrl)) as Activity;

  const logUrl = activity._links?.log?.href;
  if (!logUrl) {
    throw new Error("No log link found for this activity.");
  }

  // Fetch the log as NDJSON text
  const rawLog = await apiRequestText(logUrl, {
    params: { start_at: "0", max_items: "0", max_delay: "0" },
  });

  // Parse NDJSON and extract messages
  const lines = rawLog
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as { data?: { message?: string }; seal?: boolean };
        if (parsed.seal) return null;
        return parsed.data?.message ?? "";
      } catch {
        return line;
      }
    })
    .filter((line): line is string => line !== null);

  return lines.join("");
}

/** List variables for an environment */
export async function listVariablesEnv(projectId: string, envId: string): Promise<Variable[]> {
  const url = await projectUrl(projectId, `/environments/${envId}/variables`);
  return (await apiRequest(url)) as Variable[];
}

/** List variables for a project */
export async function listVariablesProject(projectId: string): Promise<Variable[]> {
  const url = await projectUrl(projectId, `/variables`);
  return (await apiRequest(url)) as Variable[];
}

/** Create a new branch from the integration environment */
export async function createBranch(
  projectId: string,
  branchId: string,
  title: string
): Promise<unknown> {
  // Get the integration environment to find the #branch link
  const url = await projectUrl(projectId, `/environments/integration`);
  const env = (await apiRequest(url)) as { _links: Record<string, { href: string }> };

  const branchLink = env._links?.["#branch"]?.href;
  if (!branchLink) {
    throw new Error("Branch operation not available on the integration environment.");
  }

  return apiRequest(branchLink, {
    method: "POST",
    body: JSON.stringify({ name: branchId, title }),
    headers: { "Content-Type": "application/json" },
  });
}

/** Get the git remote URL for a project */
export async function getProjectGitUrl(projectId: string): Promise<string> {
  const url = await projectUrl(projectId);
  const project = (await apiRequest(url)) as {
    repository?: { url?: string };
  };

  const gitUrl = project.repository?.url;
  if (!gitUrl) {
    throw new Error(`No git URL found for project ${projectId}.`);
  }

  return gitUrl;
}
