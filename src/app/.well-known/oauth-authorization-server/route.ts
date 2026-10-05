import { oauthAuthorizationServerMetadata } from "@/lib/oauth";
import { metadataOptionsResponse } from "@/lib/mcp/resource-metadata";
import { publicOrigin } from "@/lib/mcp/origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const issuer = publicOrigin(request);
  return Response.json(
    {
      ...oauthAuthorizationServerMetadata(issuer),
      service_documentation: `${issuer}/docs/mcp`,
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
