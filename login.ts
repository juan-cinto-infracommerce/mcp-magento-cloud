#!/usr/bin/env node
/**
 * mcp-magento-cloud login
 * Opens a browser for OAuth2 login and stores the refresh token locally
 */

import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { exec } from "child_process";

const AUTH_URL = "https://auth.magento.cloud/oauth2/authorize";
const TOKEN_URL = "https://auth.magento.cloud/oauth2/token";
const CLIENT_ID = "magento-cloud-cli";
const SCOPE = "offline_access";

/** Get the credentials file path */
export function getCredentialsPath(): string {
  const dir = join(homedir(), ".config", "mcp-magento-cloud");
  mkdirSync(dir, { recursive: true });
  return join(dir, "credentials.json");
}

/** Read stored credentials */
export function readCredentials(): { refreshToken: string; accessToken?: string; expiresAt?: number } | null {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Save credentials to disk */
export function saveCredentials(data: { refreshToken: string; accessToken?: string; expiresAt?: number }): void {
  const path = getCredentialsPath();
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Base64url encode */
function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate PKCE code verifier */
function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** Generate PKCE code challenge from verifier (S256) */
function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** Open URL in the default browser */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  exec(`${cmd} "${url}"`);
}

export async function login(): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = base64url(randomBytes(16));

  // Find an available port between 5000-5010
  const port = await new Promise<number>((resolve, reject) => {
    let attempt = 5000;
    const tryPort = () => {
      const server = createServer();
      server.listen(attempt, "127.0.0.1", () => {
        server.close(() => resolve(attempt));
      });
      server.on("error", () => {
        attempt++;
        if (attempt > 5010) reject(new Error("No available port found between 5000-5010"));
        else tryPort();
      });
    };
    tryPort();
  });

  // redirect_uri must be the root URL without path — Magento Cloud OAuth only allows this format
  const redirectUri = `http://127.0.0.1:${port}`;

  return new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      // OAuth error response
      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Login failed</h2><p>${error}: ${errorDescription || ""}</p><p>You can close this tab.</p></body></html>`);
        server.close();
        reject(new Error(`OAuth error: ${error} - ${errorDescription || ""}`));
        return;
      }

      // OAuth callback with authorization code
      if (code && returnedState) {
        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Invalid response</h2><p>State mismatch.</p></body></html>");
          server.close();
          reject(new Error("State mismatch in OAuth response"));
          return;
        }

        try {
          const tokenResponse = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              client_id: CLIENT_ID,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier,
            }),
          });

          if (!tokenResponse.ok) {
            const text = await tokenResponse.text();
            throw new Error(`Token exchange failed: ${text}`);
          }

          const tokens = await tokenResponse.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
            token_type: string;
          };

          if (!tokens.refresh_token) {
            throw new Error("No refresh token received. The OAuth server may be misconfigured.");
          }

          saveCredentials({
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          });

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body>
            <h2 style="color: green;">Login successful!</h2>
            <p>You are now authenticated with Magento Cloud.</p>
            <p>Credentials saved to <code>~/.config/mcp-magento-cloud/credentials.json</code></p>
            <p>You can close this tab.</p>
          </body></html>`);

          console.log("\nLogin successful!");
          console.log(`Credentials saved to ${getCredentialsPath()}`);
          console.log("\nYou can now use the MCP server without setting MAGENTO_CLOUD_CLI_TOKEN.");

          server.close();
          resolve();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Error</h2><p>${msg}</p></body></html>`);
          server.close();
          reject(err);
        }
      } else {
        // Initial request — redirect to OAuth authorize URL
        const authUrl = new URL(AUTH_URL);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", CLIENT_ID);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("scope", SCOPE);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("prompt", "consent");

        res.writeHead(302, { Location: authUrl.toString() });
        res.end();
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const localUrl = `http://127.0.0.1:${port}`;
      console.log("mcp-magento-cloud login");
      console.log("=======================");
      console.log("");
      console.log("Opening browser for authentication...");
      console.log(`If the browser doesn't open, visit: ${localUrl}`);
      console.log("");
      console.log("Waiting for login...");

      openBrowser(localUrl);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      console.error("\nLogin timed out after 5 minutes.");
      server.close();
      reject(new Error("Login timed out"));
    }, 300_000);
  });
}

// --- Exclusive (single-browser) login ---

/** How long a login lock is honoured before it is treated as abandoned. */
const LOGIN_LOCK_TTL = 320_000; // login() itself times out at 5 min
const LOGIN_LOCK_POLL = 500;

function loginLockPath(): string {
  return join(dirname(getCredentialsPath()), "login.lock");
}

/** True when the stored credentials contain a usable, unexpired access token. */
function credentialsAreUsable(): boolean {
  const c = readCredentials();
  return Boolean(c?.refreshToken && c.accessToken && c.expiresAt && Date.now() < c.expiresAt - 60_000);
}

/** Try to claim the lock atomically; takes over a lock left behind by a dead process. */
function claimLoginLock(): boolean {
  const path = loginLockPath();
  try {
    writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    // Lock exists — steal it only if it is older than a full login attempt,
    // which means the holder crashed without cleaning up.
    try {
      if (Date.now() - statSync(path).mtimeMs > LOGIN_LOCK_TTL) {
        writeFileSync(path, String(process.pid), { mode: 0o600 });
        return true;
      }
    } catch {
      // Lock vanished between the two calls — let the caller retry as a waiter.
    }
    return false;
  }
}

/**
 * Run an interactive login, but only ever one at a time across every process
 * sharing this credentials file.
 *
 * Without this, two tool calls that both need a token each spawn their own OAuth
 * server and browser tab: the user can only complete one, so the other blocks
 * until its 5-minute timeout — the MCP call just appears to hang.
 *
 * A caller that loses the race waits for the winner's credentials instead of
 * starting a competing flow.
 */
export async function loginExclusive(): Promise<void> {
  if (credentialsAreUsable()) return;

  if (claimLoginLock()) {
    return runLoginAndReleaseLock();
  }

  // Another process holds the lock. Wait for its credentials instead of opening
  // a competing browser tab.
  const deadline = Date.now() + LOGIN_LOCK_TTL;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LOGIN_LOCK_POLL));
    if (credentialsAreUsable()) return;
    // Holder released the lock without producing credentials (cancelled, crashed)
    // — take over and do the login ourselves.
    if (!existsSync(loginLockPath()) && claimLoginLock()) {
      return runLoginAndReleaseLock();
    }
  }

  throw new Error(
    "Another Magento Cloud login is already in progress and never completed. " +
      "Finish it in the browser, or run `npx mcp-magento-cloud-login` manually."
  );
}

async function runLoginAndReleaseLock(): Promise<void> {
  try {
    await login();
  } finally {
    rmSync(loginLockPath(), { force: true });
  }
}

// Only run CLI when this file is the entrypoint (not when imported as a module)
import { fileURLToPath } from "url";
import { resolve } from "path";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "login" || args.length === 0) {
    login().catch((err) => {
      console.error("Login failed:", err.message);
      process.exit(1);
    });
  } else if (args[0] === "logout") {
    const path = getCredentialsPath();
    if (existsSync(path)) {
      writeFileSync(path, "", { mode: 0o600 });
      console.log("Logged out. Credentials removed.");
    } else {
      console.log("Not logged in.");
    }
  } else {
    console.log("Usage: mcp-magento-cloud-login [login|logout]");
  }
}
