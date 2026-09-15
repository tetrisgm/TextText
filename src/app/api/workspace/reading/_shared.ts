import { getCurrentUser, type CurrentUser } from "@/lib/session";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";
import { readingFlags } from "@/lib/reading/flags";
import { FeedConnectionError } from "@/lib/reading/connections.server";


export function jsonError(message: string, status: number, code?: string) {
  return Response.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function handleFrom(request: Request, body?: Record<string, unknown>): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("handle")?.trim();
  const fromBody = typeof body?.handle === "string" ? body.handle.trim() : "";
  return fromQuery || fromBody || null;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The signed-in owner of a workspace, or a response saying why not. */
export async function requireOwner(
  handle: string,
): Promise<
  | { ok: true; user: CurrentUser; ownerId: string; blogId: string }
  | { ok: false; response: Response }
> {
  if (!readingFlags.connections) {
    return { ok: false, response: jsonError("Reading is not enabled", 404, "disabled") };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: jsonError("Sign in to manage feeds", 401) };
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.isOwner || !access.ownerId || !access.blogId) {
    return { ok: false, response: jsonError("Only the workspace owner can manage feeds", 403) };
  }
  return { ok: true, user, ownerId: access.ownerId, blogId: access.blogId };
}

/** Anyone with read access to the workspace, for reading views. */
export async function requireReader(
  handle: string,
): Promise<{ ok: true; user: AccessUser | null } | { ok: false; response: Response }> {
  const user = await getCurrentUser();
  const access = await resolveWorkspaceAccess({ handle, user });
  if (!access.role) return { ok: false, response: jsonError("Workspace not found", 404) };
  return { ok: true, user };
}

export function feedErrorResponse(error: unknown): Response {
  if (error instanceof FeedConnectionError) {
    const status =
      error.code === "not_found" ? 404 : error.code === "disabled" ? 404 : error.code === "conflict" ? 409 : 400;
    return jsonError(error.message, status, error.code);
  }
  return jsonError(error instanceof Error ? error.message : "Something went wrong", 500);
}
