// The canonical MCP endpoint: {origin}/api/mcp, Streamable HTTP, protocol
// revision 2026-07-28. /api/mcp/mcp (the [transport] sibling) serves clients
// that still append a transport segment to the URL.
//
// GET and DELETE answer 405: this revision removed the standalone SSE stream
// and protocol-level sessions, so those verbs have no meaning here.

import { handleMcpRequest } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

export {
  handleMcpRequest as GET,
  handleMcpRequest as POST,
  handleMcpRequest as DELETE,
};
