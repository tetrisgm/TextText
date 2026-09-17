import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { githubAppConfig, type GithubAppConfig } from "@/lib/github/app.server";
import { INSTALL_STATE_COOKIE, INSTALL_STATE_MAX_AGE_SECONDS } from "@/lib/github/install-state";
import { isLoopbackHost } from "@/lib/loopback-host";
import { rootDomainUrl } from "@/lib/site-url";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE });
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: PRIVATE });
}

export function authSecret(): string | null {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? null;
}

/** The signed-in owner of a workspace, with the app configured, or why not. */
export async function requireOwnerWithApp(handle: string): Promise<
  { ok: true; userId: string; blogId: string; config: GithubAppConfig } | { ok: false; response: Response }
> {
  const config = githubAppConfig();
  if (!config) return { ok: false, response: jsonError("GitHub is not set up on this deployment", 404) };
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: jsonError("Sign in first", 401) };
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.isOwner || !access.ownerId || !access.blogId) {
    return { ok: false, response: jsonError("Only the workspace owner can connect GitHub", 403) };
  }
  return { ok: true, userId: access.ownerId, blogId: access.blogId, config };
}

export async function setInstallStateCookie(value: string): Promise<void> {
  const jar = await cookies();
  jar.set({ name: INSTALL_STATE_COOKIE, value, httpOnly: true, secure: true, sameSite: "lax", path: "/api/github", maxAge: INSTALL_STATE_MAX_AGE_SECONDS });
}

export async function readInstallStateCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(INSTALL_STATE_COOKIE)?.value;
}

export async function clearInstallStateCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: INSTALL_STATE_COOKIE, path: "/api/github" });
}

/**
 * The origin to send the browser back to. On the developer's own machine it
 * is the loopback origin the request arrived on; anywhere else it is the
 * configured root domain, so a forged Host header can never turn the
 * settings redirect or the OAuth redirect_uri toward another site.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (isLoopbackHost(host)) return `http://${host}`;
  return rootDomainUrl().toString().replace(/\/$/, "");
}

/** Where the OAuth half of setup returns; registered on the GitHub App as a callback URL. */
export function verifyRedirectUri(request: Request): string {
  return `${requestOrigin(request)}/api/github/setup/verify`;
}

/** Back to Settings with one word about how it went. */
export async function settingsRedirect(request: Request, outcome: string): Promise<Response> {
  const { resolveWorkspaceHomePath } = await import("@/app/editor/actions");
  let home = "/start?to=home";
  try {
    home = await resolveWorkspaceHomePath();
  } catch {
    // Signed out mid-flow; /start asks them to sign in again.
  }
  const target = new URL(home, requestOrigin(request));
  target.searchParams.set("view", "settings");
  target.searchParams.set("github", outcome);
  target.hash = "settings-github";
  return Response.redirect(target.toString(), 303);
}
