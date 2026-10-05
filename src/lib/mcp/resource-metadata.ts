// RFC 9728 discovery for OAuth-capable MCP clients. Manual bearer tokens keep
// working; clients that need browser authorization can follow this metadata.

import { OAUTH_SCOPES } from "@/lib/oauth";
import { publicOrigin } from "./origin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
} as const;

export function metadataOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function protectedResourceMetadataResponse(request: Request): Response {
  const origin = publicOrigin(request);
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    resource_name: "TextText",
    resource_documentation: `${origin}/docs/mcp`,
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  }, { headers: { "Cache-Control": "no-store", ...CORS_HEADERS } });
}

export { CORS_HEADERS };
