// Root-form RFC 9728 metadata: this exact path is what the MCP 401's
// resource_metadata header advertises.

import {
  metadataOptionsResponse,
  protectedResourceMetadataResponse,
} from "@/lib/mcp/resource-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return protectedResourceMetadataResponse(request);
}

export async function OPTIONS() {
  return metadataOptionsResponse();
}
