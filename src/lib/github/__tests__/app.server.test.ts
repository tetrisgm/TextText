import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  exchangeUserCode,
  forgetInstallationToken,
  getInstallation,
  githubAppConfig,
  installUrl,
  installationToken,
  listInstallationRepositories,
  manageInstallationUrl,
  mintAppJwt,
  userAuthorizeUrl,
  userCanSeeInstallation,
  type GithubFetch,
} from "../app.server";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const config = { clientId: "Iv1.abc", clientSecret: "shh", appId: "123456", slug: "texttext", privateKeyPem: pem };

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("github app config", () => {
  it("needs all five values for repositories and tolerates escaped newlines", () => {
    expect(githubAppConfig({})).toBeNull();
    expect(githubAppConfig({ AUTH_GITHUB_ID: "a", AUTH_GITHUB_SECRET: "b", GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "s" })).toBeNull();
    const escaped = pem.replace(/\n/g, "\\n");
    const loaded = githubAppConfig({ AUTH_GITHUB_ID: "a", AUTH_GITHUB_SECRET: "b", GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "s", GITHUB_APP_PRIVATE_KEY: escaped });
    expect(loaded?.privateKeyPem).toBe(pem);
  });
});

describe("app jwt", () => {
  it("is RS256, signed by the app key, and lives under ten minutes", () => {
    const now = Date.UTC(2026, 8, 17, 12, 0, 0);
    const jwt = mintAppJwt(config, now);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { iat: number; exp: number; iss: string };
    expect(claims.iss).toBe("123456");
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(crypto.verify("sha256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("installation tokens", () => {
  it("mints with the app jwt, caches until near expiry, and forgets on demand", async () => {
    const calls: string[] = [];
    const now = Date.UTC(2026, 8, 17, 12, 0, 0);
    const fetcher: GithubFetch = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const auth = (init?.headers as Record<string, string>).Authorization;
      expect(auth.startsWith("Bearer ")).toBe(true);
      expect(auth.split(".").length).toBe(3);
      return respond(201, { token: "ghs_abc", expires_at: new Date(now + 60 * 60_000).toISOString() });
    };
    forgetInstallationToken(99);
    expect(await installationToken(config, 99, fetcher, now)).toBe("ghs_abc");
    expect(await installationToken(config, 99, fetcher, now + 30 * 60_000)).toBe("ghs_abc");
    expect(calls).toHaveLength(1);
    await installationToken(config, 99, fetcher, now + 59.5 * 60_000);
    expect(calls).toHaveLength(2);
    forgetInstallationToken(99);
    await installationToken(config, 99, fetcher, now);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("POST https://api.github.com/app/installations/99/access_tokens");
  });

  it("surfaces GitHub's message on failure", async () => {
    forgetInstallationToken(5);
    const fetcher: GithubFetch = async () => respond(401, { message: "A JSON web token could not be decoded" });
    await expect(installationToken(config, 5, fetcher)).rejects.toThrow("A JSON web token could not be decoded");
  });
});

describe("installations and repositories", () => {
  it("reads an installation and treats 404 as gone", async () => {
    const fetcher: GithubFetch = async (url) =>
      url.endsWith("/app/installations/7")
        ? respond(200, { id: 7, account: { login: "octo", type: "Organization" }, repository_selection: "selected", suspended_at: null })
        : respond(404, { message: "Not Found" });
    expect(await getInstallation(config, 7, fetcher)).toEqual({ id: 7, accountLogin: "octo", accountType: "Organization", repositorySelection: "selected", suspended: false });
    expect(await getInstallation(config, 8, fetcher)).toBeNull();
  });

  it("lists repositories with push permission across pages", async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ full_name: `octo/r${i}`, private: true, default_branch: "main", permissions: { push: i % 2 === 0 } }));
    const fetcher: GithubFetch = async (url) => (url.endsWith("page=1") ? respond(200, { repositories: page(100) }) : respond(200, { repositories: page(3) }));
    const repositories = await listInstallationRepositories("ghs_x", fetcher);
    expect(repositories).toHaveLength(103);
    expect(repositories[1].permissions.push).toBe(false);
    expect(repositories[0]).toEqual({ fullName: "octo/r0", private: true, defaultBranch: "main", permissions: { push: true } });
  });
});

describe("the user half of setup", () => {
  it("builds the authorize url and exchanges a code for a token once", async () => {
    const url = new URL(userAuthorizeUrl(config, "https://texttext.app/api/github/setup/verify", "st"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(url.searchParams.get("state")).toBe("st");
    const fetcher = vi.fn<GithubFetch>(async () => respond(200, { access_token: "ghu_1" }));
    expect(await exchangeUserCode(config, "code", "https://texttext.app/api/github/setup/verify", fetcher)).toBe("ghu_1");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, string>;
    expect(body.client_secret).toBe("shh");
    const bad = vi.fn<GithubFetch>(async () => respond(200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }));
    await expect(exchangeUserCode(config, "code", "x", bad)).rejects.toThrow("incorrect or expired");
  });

  it("confirms an installation only when the user can see it", async () => {
    const fetcher: GithubFetch = async (url) =>
      url.endsWith("/user") ? respond(200, { login: "shokunin" }) : respond(200, { installations: [{ id: 1 }, { id: 42 }] });
    expect(await userCanSeeInstallation("ghu", 42, fetcher)).toEqual({ login: "shokunin" });
    expect(await userCanSeeInstallation("ghu", 43, fetcher)).toBeNull();
  });

  it("links point at the app and the installation settings", () => {
    expect(installUrl(config, "a b")).toBe("https://github.com/apps/texttext/installations/new?state=a%20b");
    expect(manageInstallationUrl(9, "User", "me")).toBe("https://github.com/settings/installations/9");
    expect(manageInstallationUrl(9, "Organization", "acme")).toBe("https://github.com/organizations/acme/settings/installations/9");
  });
});
