import crypto from "node:crypto";

/**
 * The one GitHub App TextText owns, seen from the server.
 *
 * The same app signs people in (an OAuth provider like Apple and Google,
 * taking name, avatar, and verified email only) and reaches repositories
 * (an installation the person adds to their own account, whose short-lived
 * installation tokens back the workspace backup). There is no shared server
 * secret for repositories: every repository call is made with a token minted
 * for that installation from the app's private key, and it expires within
 * the hour.
 *
 * Configuration, all from the environment:
 *   AUTH_GITHUB_ID / AUTH_GITHUB_SECRET   the app's OAuth client id and secret
 *   GITHUB_APP_ID                         the numeric app id (signs app JWTs)
 *   GITHUB_APP_SLUG                       the app's URL name, for the install link
 *   GITHUB_APP_PRIVATE_KEY                the .pem contents (escaped newlines ok)
 */

export type GithubAppConfig = {
  clientId: string;
  clientSecret: string;
  appId: string;
  slug: string;
  privateKeyPem: string;
};

export type GithubInstallationInfo = {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  suspended: boolean;
};

export type GithubRepository = { fullName: string; private: boolean; defaultBranch: string; permissions: { push: boolean } };

const API = "https://api.github.com";
const API_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "TextText" };

function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function githubAppConfig(env: Record<string, string | undefined> = process.env): GithubAppConfig | null {
  const clientId = env.AUTH_GITHUB_ID?.trim();
  const clientSecret = env.AUTH_GITHUB_SECRET?.trim();
  const appId = env.GITHUB_APP_ID?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const privateKeyPem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!clientId || !clientSecret || !appId || !slug || !privateKeyPem) return null;
  return { clientId, clientSecret, appId, slug, privateKeyPem: normalizePrivateKey(privateKeyPem) };
}

/** Sign-in needs only the OAuth half; repositories need all of it. */
export function githubSignInConfig(env: Record<string, string | undefined> = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = env.AUTH_GITHUB_ID?.trim();
  const clientSecret = env.AUTH_GITHUB_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** A ten-minute app JWT (RS256), the credential that mints installation tokens. */
export function mintAppJwt(config: Pick<GithubAppConfig, "appId" | "privateKeyPem">, now: number = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: config.appId }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), crypto.createPrivateKey(config.privateKeyPem));
  return `${header}.${payload}.${b64url(signature)}`;
}

export type GithubFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class GithubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GithubApiError";
  }
}

async function apiJson<T>(fetcher: GithubFetch, url: string, init: RequestInit & { token: string }): Promise<T> {
  const { token, ...rest } = init;
  const response = await fetcher(url, { ...rest, headers: { ...API_HEADERS, Authorization: `Bearer ${token}`, ...(rest.headers ?? {}) } });
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { message?: string }).message ?? "";
    } catch {
      // Not JSON; the status is the message.
    }
    throw new GithubApiError(detail || `GitHub answered ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

function installationInfo(raw: {
  id: number;
  account?: { login?: string; type?: string } | null;
  repository_selection?: string;
  suspended_at?: string | null;
}): GithubInstallationInfo {
  return {
    id: raw.id,
    accountLogin: raw.account?.login ?? "",
    accountType: raw.account?.type === "Organization" ? "Organization" : "User",
    repositorySelection: raw.repository_selection === "all" ? "all" : "selected",
    suspended: Boolean(raw.suspended_at),
  };
}

/** What GitHub knows about one installation of the app, or null when it is gone. */
export async function getInstallation(config: GithubAppConfig, installationId: number, fetcher: GithubFetch = fetch): Promise<GithubInstallationInfo | null> {
  try {
    const raw = await apiJson<Parameters<typeof installationInfo>[0]>(fetcher, `${API}/app/installations/${installationId}`, { token: mintAppJwt(config) });
    return installationInfo(raw);
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) return null;
    throw error;
  }
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

/** A short-lived installation token, cached until a minute before it expires. */
export async function installationToken(config: GithubAppConfig, installationId: number, fetcher: GithubFetch = fetch, now: number = Date.now()): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;
  const raw = await apiJson<{ token: string; expires_at: string }>(fetcher, `${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    token: mintAppJwt(config, now),
  });
  tokenCache.set(installationId, { token: raw.token, expiresAt: new Date(raw.expires_at).getTime() });
  return raw.token;
}

export function forgetInstallationToken(installationId: number): void {
  tokenCache.delete(installationId);
}

/** The repositories the installation can reach, with whether we may push. */
export async function listInstallationRepositories(token: string, fetcher: GithubFetch = fetch): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const raw = await apiJson<{ repositories: Array<{ full_name: string; private: boolean; default_branch: string; permissions?: { push?: boolean } }> }>(
      fetcher,
      `${API}/installation/repositories?per_page=100&page=${page}`,
      { token },
    );
    for (const repository of raw.repositories) {
      repositories.push({ fullName: repository.full_name, private: repository.private, defaultBranch: repository.default_branch, permissions: { push: Boolean(repository.permissions?.push) } });
    }
    if (raw.repositories.length < 100) break;
  }
  return repositories;
}

/**
 * The OAuth half of the setup flow: the person who just installed the app
 * proves they can see that installation. The user token this yields is used
 * for exactly one call and never stored.
 */
export function userAuthorizeUrl(config: Pick<GithubAppConfig, "clientId">, redirectUri: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeUserCode(config: Pick<GithubAppConfig, "clientId" | "clientSecret">, code: string, redirectUri: string, fetcher: GithubFetch = fetch): Promise<string> {
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "TextText" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
  });
  const raw = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !raw.access_token) throw new GithubApiError(raw.error_description || raw.error || "GitHub did not return a token", response.status);
  return raw.access_token;
}

/** Whether the installation is among those the user token can see, and as whom. */
export async function userCanSeeInstallation(userToken: string, installationId: number, fetcher: GithubFetch = fetch): Promise<{ login: string } | null> {
  const me = await apiJson<{ login: string }>(fetcher, `${API}/user`, { token: userToken });
  for (let page = 1; page <= 5; page += 1) {
    const raw = await apiJson<{ installations: Array<{ id: number }> }>(fetcher, `${API}/user/installations?per_page=100&page=${page}`, { token: userToken });
    if (raw.installations.some((installation) => installation.id === installationId)) return { login: me.login };
    if (raw.installations.length < 100) break;
  }
  return null;
}

export function installUrl(config: Pick<GithubAppConfig, "slug">, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

export function manageInstallationUrl(installationId: number, accountType: "User" | "Organization", accountLogin: string): string {
  return accountType === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(accountLogin)}/settings/installations/${installationId}`
    : `https://github.com/settings/installations/${installationId}`;
}
