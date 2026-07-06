// Bearer auth for the MCP server: the same wsk_ tokens as the sync API,
// verified through resolveApiToken and handed to mcp-handler's withMcpAuth.
// The token owner's OWNED blog is the workspace, so no tool below can ever
// cross tenants.

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { resolveApiToken } from "@/lib/api-tokens";
import type { Blog } from "@/lib/content";
import { getOwnedBlog } from "@/lib/store";

/**
 * verifyToken for withMcpAuth. Returning undefined makes the wrapper answer
 * with the MCP-proper 401 (WWW-Authenticate: Bearer + OAuth error body) for a
 * missing, malformed, unknown, or revoked token.
 */
export async function verifyWriteApiToken(
  request: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const identity = await resolveApiToken(request.headers.get("authorization"));
  if (!identity) return undefined;
  return {
    token: bearerToken ?? "",
    clientId: identity.userId,
    scopes: identity.scopes.split(/\s+/).filter(Boolean),
    extra: { userId: identity.userId, sub: identity.sub },
  };
}

/**
 * The workspace blog behind an authenticated MCP request, or null when the
 * token's user has no blog yet. Tool handlers turn null into a tool error.
 */
export async function workspaceBlog(
  authInfo: AuthInfo | undefined,
): Promise<Blog | null> {
  const sub = authInfo?.extra?.sub;
  if (typeof sub !== "string" || !sub) return null;
  return getOwnedBlog(sub);
}
