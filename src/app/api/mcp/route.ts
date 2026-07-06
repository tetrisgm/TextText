// The canonical MCP endpoint: {origin}/api/mcp, streamable HTTP. This is the
// URL /connect hands out; /api/mcp/mcp (the [transport] sibling) serves
// clients that follow mcp-handler's path convention.

import { buildMcpRouteHandler } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

const handler = buildMcpRouteHandler("/api/mcp");

export { handler as GET, handler as POST, handler as DELETE };
