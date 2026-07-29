// Serves /api/mcp/mcp for clients that append a transport segment to the URL.
// The advertised endpoint is the bare /api/mcp one level up; both are the same
// stateless handler, because MCP 2026-07-28 keeps no per-endpoint state.

import { handleMcpRequest } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

export {
  handleMcpRequest as GET,
  handleMcpRequest as POST,
  handleMcpRequest as DELETE,
};
