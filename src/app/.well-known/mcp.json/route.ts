// Zero-config MCP discovery: tells any client that asks that this origin has
// an MCP server and where it lives. Same shape Notion serves at
// /.well-known/mcp.json ({name, description, icon, endpoint}).

import { publicOrigin as getPublicOrigin } from "@/lib/mcp/origin";
import { metadataOptionsResponse } from "@/lib/mcp/resource-metadata";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/protocol";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return Response.json(
    {
      name: "TextText",
      description:
        "Read and write the folders and markdown items in your TextText workspace.",
      icon: `${origin}/apple-icon`,
      endpoint: `${origin}/api/mcp`,
      protocolVersions: [MCP_PROTOCOL_VERSION],
    },
    {
      headers: {
        "Cache-Control": "no-store",
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
