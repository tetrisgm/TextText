// Zero-config MCP discovery: tells any client that asks that this origin has
// an MCP server and where it lives. Same shape Notion serves at
// /.well-known/mcp.json ({name, description, icon, endpoint}).

import { getPublicOrigin } from "mcp-handler";
import { metadataOptionsResponse } from "@/lib/mcp/resource-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return Response.json(
    {
      name: "Write",
      description:
        "Read and write the folders and markdown items in your Write workspace.",
      icon: `${origin}/apple-icon`,
      endpoint: `${origin}/api/mcp`,
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
