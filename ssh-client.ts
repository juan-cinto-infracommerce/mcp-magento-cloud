/**
 * SSH client for Magento Cloud
 * Uses the system ssh binary with certificates obtained from the Magento Cloud certifier API
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { apiRequest } from "./api-client.js";
import { getEnvironmentInfo } from "./api-client.js";

const CERTIFIER_URL = "https://ssh.api.magento.cloud/ssh";

interface SshCertFiles {
  privateKey: string;
  certificate: string;
}

let cachedCert: SshCertFiles | null = null;

/**
 * Generate an Ed25519 key pair and get it signed by the Magento Cloud certifier API
 */
export async function getOrCreateSshCert(): Promise<SshCertFiles> {
  const sshDir = join(tmpdir(), "mcp-magento-cloud-ssh");
  mkdirSync(sshDir, { recursive: true });

  const keyPath = join(sshDir, "id_ed25519");
  const certPath = `${keyPath}-cert.pub`;
  const pubPath = `${keyPath}.pub`;

  // Generate Ed25519 key pair if not exists
  if (!existsSync(keyPath)) {
    execSync(
      `ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "mcp-magento-cloud-temp" -q`,
      { stdio: "ignore" }
    );
    chmodSync(keyPath, 0o600);
  }

  // Always refresh the certificate (they expire)
  const publicKey = readFileSync(pubPath, "utf-8").trim();

  const response = (await apiRequest(CERTIFIER_URL, {
    method: "POST",
    body: JSON.stringify({ key: publicKey }),
    headers: { "Content-Type": "application/json" },
  })) as { certificate: string };

  writeFileSync(certPath, response.certificate + "\n");

  cachedCert = { privateKey: keyPath, certificate: certPath };
  return cachedCert;
}

/**
 * Get SSH URL for an environment from the API _links
 */
async function getSshUrl(projectId: string, envId: string): Promise<string> {
  const env = await getEnvironmentInfo(projectId, envId) as unknown as {
    _links: Record<string, { href: string }>;
  };

  const links = env._links || {};

  // Try pf:ssh: links first (newer format)
  for (const [rel, link] of Object.entries(links)) {
    if (rel.startsWith("pf:ssh:") && link.href) {
      return link.href.replace(/^ssh:\/\//, "");
    }
  }

  // Fallback to legacy ssh link
  if (links.ssh?.href) {
    return links.ssh.href.replace(/^ssh:\/\//, "");
  }

  throw new Error("No SSH URL found for this environment.");
}

/**
 * Execute a command on a remote Magento Cloud environment via SSH
 * Uses the system ssh binary with a temporary certificate
 */
export async function sshExec(
  projectId: string,
  envId: string,
  command: string
): Promise<string> {
  const [sshUrl, cert] = await Promise.all([
    getSshUrl(projectId, envId),
    getOrCreateSshCert(),
  ]);

  const atIndex = sshUrl.indexOf("@");
  const username = sshUrl.substring(0, atIndex);
  const host = sshUrl.substring(atIndex + 1);

  const result = spawnSync("ssh", [
    "-i", cert.privateKey,
    "-o", "CertificateFile=" + cert.certificate,
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=30",
    `${username}@${host}`,
    command,
  ], {
    encoding: "utf-8",
    timeout: 60_000,
  });

  if (result.error) {
    throw new Error(`SSH error: ${result.error.message}`);
  }

  if (result.status !== 0 && result.stderr) {
    throw new Error(`SSH command failed: ${result.stderr}`);
  }

  return result.stdout || "";
}

/**
 * Get environment relationships via SSH
 */
export async function getRelationshipsViaSsh(
  projectId: string,
  envId: string
): Promise<Record<string, unknown>> {
  // The env var name differs between environment types:
  // Dedicated: MAGENTO_CLOUD_RELATIONSHIPS
  // Flex/Grid: PLATFORM_RELATIONSHIPS
  const candidates = ["PLATFORM_RELATIONSHIPS", "MAGENTO_CLOUD_RELATIONSHIPS", "RELATIONSHIPS"];

  for (const varName of candidates) {
    const output = await sshExec(projectId, envId, `echo -n "$${varName}"`);
    if (output && output.length > 0) {
      const decoded = Buffer.from(output, "base64").toString("utf-8");
      return JSON.parse(decoded);
    }
  }

  throw new Error("No relationships data found. Tried: " + candidates.join(", "));
}

/**
 * Get log content via SSH
 */
export async function getLogViaSsh(
  projectId: string,
  envId: string,
  logType: string,
  lines: number = 100
): Promise<string> {
  return sshExec(
    projectId,
    envId,
    `tail -n ${lines} /var/log/${logType}.log 2>/dev/null || tail -n ${lines} /var/log/platform/"$USER"/${logType}.log 2>/dev/null || echo "Log not found: ${logType}"`
  );
}

/**
 * Execute a SQL query via SSH
 */
export async function execSqlViaSsh(
  projectId: string,
  envId: string,
  query: string,
  relationship: string = "database-slave"
): Promise<string> {
  const relationships = await getRelationshipsViaSsh(projectId, envId);

  const dbRels = (relationships[relationship] || relationships["database"]) as Array<{
    host: string;
    port: number;
    username: string;
    password: string;
    path: string;
  }>;

  if (!dbRels || dbRels.length === 0) {
    throw new Error(`No database relationship found (tried "${relationship}" and "database").`);
  }

  const db = dbRels[0];
  const escapedQuery = query.replace(/'/g, "'\\''");

  return sshExec(
    projectId,
    envId,
    `mysql --no-auto-rehash --user='${db.username}' --password='${db.password}' --host='${db.host}' --port='${db.port}' '${db.path}' --execute '${escapedQuery}'`
  );
}

/**
 * Push a local branch to Magento Cloud using SSH certificate auth
 * @param repoPath  Local git repository path
 * @param gitRemoteUrl  Git remote URL, e.g. "yjh76o2xogaga@git.us-5.magento.cloud:yjh76o2xogaga.git"
 * @param localBranch  Local branch to push (e.g. "feature-xyz")
 * @param remoteBranch  Remote branch name (defaults to localBranch)
 */
export async function pushBranch(
  repoPath: string,
  gitRemoteUrl: string,
  localBranch: string,
  remoteBranch?: string
): Promise<string> {
  const cert = await getOrCreateSshCert();
  const remote = remoteBranch || localBranch;

  // Build GIT_SSH_COMMAND to use our certificate
  const gitSshCommand = [
    "ssh",
    `-i ${cert.privateKey}`,
    `-o CertificateFile=${cert.certificate}`,
    `-o StrictHostKeyChecking=no`,
    `-o BatchMode=yes`,
  ].join(" ");

  const result = spawnSync(
    "git",
    ["push", gitRemoteUrl, `${localBranch}:${remote}`],
    {
      encoding: "utf-8",
      timeout: 120_000,
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_SSH_COMMAND: gitSshCommand,
      },
    }
  );

  if (result.error) {
    throw new Error(`Git push error: ${result.error.message}`);
  }

  const output = (result.stdout || "") + (result.stderr || "");

  if (result.status !== 0) {
    throw new Error(`Git push failed:\n${output}`);
  }

  return output || `Pushed ${localBranch} → ${remote} successfully.`;
}
