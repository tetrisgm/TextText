// mcp-handler's conventional [transport] route: serves /api/mcp/mcp for
// clients that append the transport segment. The advertised endpoint is the
// bare /api/mcp (route.ts one level up); both share the same tools and auth.

import { buildMcpRouteHandler } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

const handler = buildMcpRouteHandler("/api/mcp/mcp");

export { handler as GET, handler as POST, handler as DELETE };
