// Storage for the workspace's outbound MCP connections.
//
// Server-only. The bearer token is encrypted at rest and never leaves this
// module in plaintext except into the client that is about to use it, so no
// route, action, or component can accidentally serialize one to a browser:
// listConnections returns a shape with no token field at all.

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import {
  listRemoteTools,
  OutboundMcpError,
  type OutboundConnection,
} from "@/lib/mcp/outbound-client";

/** What a browser may see: no token, ever. */
export type McpConnectionView = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasToken: boolean;
  toolNames: string[];
  lastCheckedAt: string | null;
  lastError: string | null;
};

const MAX_CONNECTIONS = 8;

/** Loopback, and therefore only reachable by the Mac app. */
function isLoopbackAddress(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9 _-]{0,31}$/;

export function cleanConnectionName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!NAME_RE.test(name)) {
    throw new OutboundMcpError(
      "Give the connection a short name: letters, numbers, spaces, dashes.",
    );
  }
  return name;
}

export { connectionSlug } from "@/lib/mcp/outbound-protocol";

function view(row: typeof mcpConnections.$inferSelect): McpConnectionView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    hasToken: Boolean(row.tokenCiphertext),
    toolNames: row.toolNames ?? [],
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

export async function listMcpConnections(
  blogId: string,
): Promise<McpConnectionView[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.blogId, blogId))
    .orderBy(asc(mcpConnections.createdAt));
  return rows.map(view);
}

/** Only the enabled ones, with tokens, for the assistant's tool loop. */
export async function enabledMcpConnections(
  blogId: string,
): Promise<OutboundConnection[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.blogId, blogId), eq(mcpConnections.enabled, true)))
    .orderBy(asc(mcpConnections.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    token: row.tokenCiphertext ? decryptSecret(row.tokenCiphertext) : null,
  }));
}

/**
 * Save a connection and immediately ask the server what it offers. A connection
 * that cannot be reached is not saved: discovering that at the moment the
 * assistant needs it is how a person concludes the assistant is broken.
 */
export async function addMcpConnection(
  blogId: string,
  input: { name: string; url: string; token?: string | null },
): Promise<McpConnectionView> {
  if (!db) throw new OutboundMcpError("Connections need a database.");
  const name = cleanConnectionName(input.name);
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const token = input.token?.trim() ? input.token.trim() : null;

  // A loopback connection is run by the Mac app, which sends the request from
  // the web view through Swift. The token would have to be handed to the
  // browser to get there, and no token ever reaches a browser: listMcpConnections
  // has no token field at all, deliberately. Storing one and never using it is
  // worse than refusing, because the row would then say "access token saved"
  // about a value nothing reads.
  if (token && isLoopbackAddress(url)) {
    throw new OutboundMcpError(
      "A server on this Mac is reached without a token. Remove the token, or connect it over https instead.",
    );
  }

  const existing = await listMcpConnections(blogId);
  if (existing.length >= MAX_CONNECTIONS) {
    throw new OutboundMcpError(`A workspace can connect ${MAX_CONNECTIONS} servers.`);
  }
  if (existing.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
    throw new OutboundMcpError("A connection with that name already exists.");
  }

  const { tools } = await listRemoteTools({ id: "new", name, url, token });

  const [row] = await db
    .insert(mcpConnections)
    .values({
      blogId,
      name,
      url,
      tokenCiphertext: token ? encryptSecret(token) : null,
      enabled: false,
      toolNames: tools.map((tool) => tool.name),
      lastCheckedAt: new Date(),
      lastError: null,
    })
    .returning();
  if (!row) throw new OutboundMcpError("The connection could not be saved.");
  return view(row);
}

export async function setMcpConnectionEnabled(
  blogId: string,
  id: string,
  enabled: boolean,
): Promise<McpConnectionView | null> {
  if (!db) return null;
  const [row] = await db
    .update(mcpConnections)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.blogId, blogId)))
    .returning();
  return row ? view(row) : null;
}

export async function removeMcpConnection(
  blogId: string,
  id: string,
): Promise<boolean> {
  if (!db) return false;
  const rows = await db
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.blogId, blogId)))
    .returning({ id: mcpConnections.id });
  return rows.length > 0;
}

/** Re-ask a saved connection what it offers, and record what happened. */
export async function refreshMcpConnection(
  blogId: string,
  id: string,
): Promise<McpConnectionView | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.blogId, blogId)));
  if (!row) return null;

  try {
    const { tools } = await listRemoteTools({
      id: row.id,
      name: row.name,
      url: row.url,
      token: row.tokenCiphertext ? decryptSecret(row.tokenCiphertext) : null,
    });
    const [updated] = await db
      .update(mcpConnections)
      .set({
        toolNames: tools.map((tool) => tool.name),
        lastCheckedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpConnections.id, row.id))
      .returning();
    return updated ? view(updated) : null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 300) : "Could not reach it.";
    const [updated] = await db
      .update(mcpConnections)
      .set({ lastCheckedAt: new Date(), lastError: message, updatedAt: new Date() })
      .where(eq(mcpConnections.id, row.id))
      .returning();
    return updated ? view(updated) : null;
  }
}
