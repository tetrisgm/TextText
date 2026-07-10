import { oauthAuthorizationServerMetadata } from "@/lib/oauth";
import { metadataOptionsResponse } from "@/lib/mcp/resource-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const issuer = new URL(request.url).origin;
  return Response.json(
    {
      ...oauthAuthorizationServerMetadata(issuer),
      registration_endpoint: `${issuer}/oauth/register`,
      service_documentation: `${issuer}/docs/ai`,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        // Browser-based MCP clients read this cross-origin during connect.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
      },
    },
  );
}

export async function OPTIONS() {
  return metadataOptionsResponse();
}
