// The one place an MCP route handler is assembled: tools + bearer auth on the
// streamable HTTP transport. Two routes share this factory because mcp-handler
// matches the request path EXACTLY against one configured endpoint:
// /api/mcp (the advertised URL) and /api/mcp/mcp (the package's [transport]
// convention) each get an instance bound to their own path.
//
// No Redis is configured, so the handler runs stateless streamable HTTP; the
// legacy SSE transport is disabled outright.

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { enforceMcpToolScope, verifyWriteApiToken } from "./auth";
import { registerAgentSurface } from "./agent-surface";
import { registerWriteTools } from "./tools";

export function buildMcpRouteHandler(
  endpoint: string,
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    (server) => {
      registerWriteTools(server);
      registerAgentSurface(server);
    },
    { serverInfo: { name: "write", version: "1.0.0" } },
    {
      streamableHttpEndpoint: endpoint,
      disableSse: true,
      maxDuration: 60,
    },
  );
  const scopeGuardedHandler = async (request: Request) => {
    const denied = await enforceMcpToolScope(request);
    return denied ?? handler(request);
  };
  // required: true makes a missing or invalid token answer with the
  // MCP-proper 401: WWW-Authenticate: Bearer plus an OAuth error body.
  return withMcpAuth(scopeGuardedHandler, verifyWriteApiToken, { required: true });
}
