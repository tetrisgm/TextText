// Bearer auth for the MCP server: the same wsk_ tokens as the sync API,
// verified through resolveApiToken and applied by the Streamable HTTP handler.
// The token owner's OWNED blog is the workspace, so no tool below can ever
// cross tenants.

import type { AuthInfo } from "./types";
import {
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  isWorkspaceToolName,
} from "@/lib/ai/tools";
import { resolveApiToken } from "@/lib/api-tokens";
import type { Blog } from "@/lib/content";
import { getOwnedBlog } from "@/lib/store";
import { publicOrigin } from "./origin";

/**
 * Resolve the bearer token. Returning undefined makes the transport answer with
 * the MCP-proper 401 (WWW-Authenticate: Bearer plus an OAuth error body) for a
 * missing, malformed, unknown, or revoked token.
 */
export async function verifyTextTextApiToken(
  request: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const identity = await resolveApiToken(request.headers.get("authorization"));
  if (!identity) return undefined;
  const scopes = [...new Set(identity.scopes.split(/\s+/).filter(Boolean))];
  const connectionName =
    typeof identity.name === "string"
      ? identity.name.replace(/^OAuth:\s*/i, "").trim()
      : "";
  return {
    token: bearerToken ?? "",
    clientId: identity.userId,
    scopes,
    expiresAt: identity.expiresAt
      ? Math.floor(identity.expiresAt.getTime() / 1000)
      : undefined,
    extra: {
      userId: identity.userId,
      sub: identity.sub,
      ...(connectionName ? { connectionName } : {}),
    },
  };
}

type AuthenticatedRequest = Request & { auth?: AuthInfo };

function requestedToolNames(value: unknown): string[] {
  const messages = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.method !== "tools/call") continue;
    const params = record.params;
    if (!params || typeof params !== "object") continue;
    const name = (params as Record<string, unknown>).name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

function insufficientScopeResponse(request: Request): Response {
  // Points at the page that creates a token, not at authorization-server
  // metadata: there is no authorization server to walk.
  const docs = `${publicOrigin(request)}/docs/mcp`;
  return Response.json(
    {
      error: "insufficient_scope",
      error_description: "The sync scope is required for mutating tools",
    },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate":
          `Bearer error="insufficient_scope", ` +
          `error_description="The sync scope is required for mutating tools", ` +
          `scope="sync", resource_documentation="${docs}"`,
      },
    },
  );
}

export function enforceMcpToolScope(
  request: Request,
  payload: unknown,
): Response | null {
  const scopes = (request as AuthenticatedRequest).auth?.scopes ?? [];
  const hasReadOnlyScope = scopes.some((scope) =>
    WORKSPACE_SCOPE_CAPABILITIES.readOnly.includes(
      scope as (typeof WORKSPACE_SCOPE_CAPABILITIES.readOnly)[number],
    ),
  );
  if (scopes.includes(WORKSPACE_SCOPE_CAPABILITIES.fullAccess) && !hasReadOnlyScope) {
    return null;
  }

  const toolNames = requestedToolNames(payload);
  if (toolNames.length === 0) return null;
  if (
    hasReadOnlyScope &&
    toolNames.every(
      (name) =>
        isWorkspaceToolName(name) &&
        WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
    )
  ) {
    return null;
  }
  return insufficientScopeResponse(request);
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
