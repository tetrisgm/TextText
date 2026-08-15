"use server";

// Owner-only management of the workspace's outbound MCP connections.
//
// Every action re-derives ownership from the session rather than trusting the
// handle the client sent, and none of them ever returns a token: the views come
// from outbound.server.ts, which has no token field in its shape.

import { recordAction } from "@/lib/audit";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import {
  addMcpConnection,
  listMcpConnections,
  refreshMcpConnection,
  removeMcpConnection,
  setMcpConnectionEnabled,
  type McpConnectionView,
} from "@/lib/mcp/outbound.server";

export type McpConnectionsState = {
  allowed: boolean;
  connections: McpConnectionView[];
};

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new Error("That connection could not be found.");
  return id;
}

async function ownerAccess(handleInput: unknown) {
  const access = await getBlogEditAccess(cleanHandle(handleInput));
  if (!access.isOwner || !access.blogId || !access.ownerId) {
    throw new Error("Only the workspace owner can manage connections.");
  }
  return { blogId: access.blogId, ownerId: access.ownerId };
}

export async function getMcpConnectionsAction(
  handleInput: unknown,
): Promise<McpConnectionsState> {
  try {
    const access = await ownerAccess(handleInput);
    return { allowed: true, connections: await listMcpConnections(access.blogId) };
  } catch {
    return { allowed: false, connections: [] };
  }
}

export async function addMcpConnectionAction(
  handleInput: unknown,
  nameInput: unknown,
  urlInput: unknown,
  tokenInput: unknown,
): Promise<McpConnectionsState> {
  const access = await ownerAccess(handleInput);
  const saved = await addMcpConnection(access.blogId, {
    name: typeof nameInput === "string" ? nameInput : "",
    url: typeof urlInput === "string" ? urlInput : "",
    token: typeof tokenInput === "string" ? tokenInput : null,
  });
  await recordAction({
    actorUserId: access.ownerId,
    actorType: "human",
    actionName: "mcp.connection_added",
    targetType: "workspace",
    targetId: saved.id,
    inputSummary: saved.name,
    outputSummary: `${saved.toolNames.length} tools`,
  });
  return { allowed: true, connections: await listMcpConnections(access.blogId) };
}

export async function setMcpConnectionEnabledAction(
  handleInput: unknown,
  idInput: unknown,
  enabledInput: unknown,
): Promise<McpConnectionsState> {
  const access = await ownerAccess(handleInput);
  const enabled = enabledInput === true;
  const updated = await setMcpConnectionEnabled(
    access.blogId,
    cleanId(idInput),
    enabled,
  );
  if (updated) {
    await recordAction({
      actorUserId: access.ownerId,
      actorType: "human",
      actionName: enabled ? "mcp.connection_enabled" : "mcp.connection_disabled",
      targetType: "workspace",
      targetId: updated.id,
      inputSummary: updated.name,
    });
  }
  return { allowed: true, connections: await listMcpConnections(access.blogId) };
}

export async function refreshMcpConnectionAction(
  handleInput: unknown,
  idInput: unknown,
): Promise<McpConnectionsState> {
  const access = await ownerAccess(handleInput);
  await refreshMcpConnection(access.blogId, cleanId(idInput));
  return { allowed: true, connections: await listMcpConnections(access.blogId) };
}

export async function removeMcpConnectionAction(
  handleInput: unknown,
  idInput: unknown,
): Promise<McpConnectionsState> {
  const access = await ownerAccess(handleInput);
  const id = cleanId(idInput);
  const removed = await removeMcpConnection(access.blogId, id);
  if (removed) {
    await recordAction({
      actorUserId: access.ownerId,
      actorType: "human",
      actionName: "mcp.connection_removed",
      targetType: "workspace",
      targetId: id,
    });
  }
  return { allowed: true, connections: await listMcpConnections(access.blogId) };
}
