// RFC 9728 protected-resource metadata for the MCP endpoint. This is the
// breadcrumb that turns a bare /api/mcp URL into a click-to-approve flow:
// the 401 from the MCP endpoint points here via resource_metadata, and here we
// point at the OAuth authorization server (this same origin), whose metadata
// advertises /oauth/register + /oauth/authorize + /oauth/token. ChatGPT and
// Claude walk that chain on their own; the user only clicks Approve.

import { OAUTH_SCOPES } from "@/lib/oauth";
import { publicOrigin } from "./origin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
} as const;

export function protectedResourceMetadataResponse(request: Request): Response {
  const origin = publicOrigin(request);
  // RFC 9728 section 2. Written out rather than generated, so the exact shape
  // this server advertises is visible here instead of inside a dependency.
  const metadata = {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    resource_name: "Texttext",
    resource_documentation: `${origin}/docs/ai`,
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
  return Response.json(metadata, {
    headers: { "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

export function metadataOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
