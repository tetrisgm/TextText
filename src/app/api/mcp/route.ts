// The MCP endpoint: {origin}/api/mcp, Streamable HTTP, protocol revision
// 2026-07-28. This revision specifies a single endpoint path, so there is no
// /api/mcp/mcp sibling any more; that existed only for the old library's
// [transport] path convention.
//
// GET and DELETE answer 405: the standalone SSE stream and protocol-level
// sessions are both gone.

import { handleMcpRequest } from "@/lib/mcp/streamable-http";

export const dynamic = "force-dynamic";

export {
  handleMcpRequest as GET,
  handleMcpRequest as POST,
  handleMcpRequest as DELETE,
};
