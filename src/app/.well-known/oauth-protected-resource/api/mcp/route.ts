// Path-suffixed RFC 9728 form: clients that build the metadata URL from the
// resource identifier (https://host/api/mcp) fetch
// /.well-known/oauth-protected-resource/api/mcp. Same document as the root form.

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
