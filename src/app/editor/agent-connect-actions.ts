"use server";

import { randomUUID } from "node:crypto";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog, getPostById, getUserIdBySub } from "@/lib/store";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/api-tokens";
import { agentPresenceClientId } from "@/lib/collab/agent-presence.server";
import { removePresence } from "@/lib/collab";
import { agentClient, localAgentInstruction, localAgentSupported } from "@/lib/agent-connect";
import { ITEM_ID_RE, itemAgentAccess, itemAgentScope } from "@/lib/item-agent-access";

async function owner(handle: string, itemId: string) {
  if (!isAuthConfigured) throw new Error("Sign in to add an agent");
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in to add an agent");
  if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId)) throw new Error("Item not found");
  const blog = await getOwnedBlog(user.sub);
  if (!blog || blog.handle !== handle) throw new Error("Only the workspace owner can connect agents");
  const post = await getPostById(handle, itemId);
  const userId = await getUserIdBySub(user.sub);
  if (!post || !userId) throw new Error("Item not found");
  return userId;
}

export async function prepareLocalItemAgentAction(handle: string, itemId: string, client: unknown) {
  const userId = await owner(handle, itemId);
  const name = agentClient(client);
  if (!localAgentSupported(name)) throw new Error("This client needs a supported hosted MCP connection");
  const label = `${name} ${randomUUID()}`;
  return { presenceId: agentPresenceClientId(userId, label), instruction: localAgentInstruction(itemId, label) };
}

export async function createItemAgentAction(handle: string, itemId: string, client: unknown, role: unknown) {
  const userId = await owner(handle, itemId);
  const name = agentClient(client);
  if (name === "Claude Desktop") throw new Error("Claude Desktop requires OAuth; item bearer tokens are not supported");
  if (role !== "read" && role !== "edit") throw new Error("Choose read-only or read and edit");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { raw, record } = await createApiToken(userId, name, {
    kind: "mcp", scopes: itemAgentScope(itemId, role), expiresAt,
    audit: { actorUserId: userId, actorType: "human", actionName: "agent.item.connect", targetType: "item", targetId: itemId, inputSummary: `${name}; ${role}; expires ${expiresAt.toISOString()}` },
  });
  return { id: record.id, token: raw, expiresAt: expiresAt.toISOString(), presenceId: agentPresenceClientId(userId, record.id) };
}

export async function listItemAgentsAction(handle: string, itemId: string) {
  const userId = await owner(handle, itemId);
  return (await listApiTokens(userId)).flatMap((token) => {
    const access = itemAgentAccess(token.scopes?.split(/\s+/));
    return access?.itemId === itemId ? [{ id: token.id, name: token.name, role: access.role,
      expiresAt: token.expiresAt ?? null, presenceId: agentPresenceClientId(userId, token.id) }] : [];
  });
}

export async function removeItemAgentAction(handle: string, itemId: string, tokenId: string) {
  const userId = await owner(handle, itemId);
  if (typeof tokenId !== "string" || !ITEM_ID_RE.test(tokenId)) throw new Error("Connection not found");
  const token = (await listApiTokens(userId)).find((entry) => entry.id === tokenId);
  if (!token || itemAgentAccess(token.scopes?.split(/\s+/))?.itemId !== itemId) throw new Error("Connection not found");
  const audit = { actorUserId: userId, actorType: "human" as const, actionName: "agent.item.disconnect", targetType: "item" as const, targetId: itemId, inputSummary: tokenId };
  if (!await revokeApiToken(userId, tokenId, audit)) throw new Error("Connection already removed");
  // Revocation is authoritative even if cleaning up display-grade presence fails.
  await removePresence(itemId, agentPresenceClientId(userId, tokenId)).catch(() => {});
}
