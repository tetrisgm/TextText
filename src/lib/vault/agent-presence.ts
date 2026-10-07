/** Native agents are attributed to the authenticated owner, never a supplied user. */
export type NativeAgentPresenceAccess = {
  actorUserId?: string; actorName?: string; canAttributeNativeEditor?: boolean; canEditContent?: boolean;
};
export function nativeAgentPresence(body: Record<string, unknown>, access: NativeAgentPresenceAccess): { principal: string; userName: string } | null {
  if (body.agent === undefined) return null;
  if (!access.canAttributeNativeEditor || !access.canEditContent || !access.actorUserId) {
    throw Response.json({ error: "A signed-in native editor is required for agent presence" }, { status: 403 });
  }
  if (!body.agent || typeof body.agent !== "object" || Array.isArray(body.agent)) throw Response.json({ error: "Invalid agent presence" }, { status: 400 });
  const agent = body.agent as Record<string, unknown>;
  if (Object.keys(agent).some(key => !["name", "taskId"].includes(key)) || ["actorUserId", "owner", "ownerName", "userId", "userName", "principal"].some(key => body[key] !== undefined) ||
      typeof agent.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(agent.name) ||
      typeof agent.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(agent.taskId)) {
    throw Response.json({ error: "Invalid agent identity" }, { status: 400 });
  }
  return {
    principal: `native-agent:${JSON.stringify([access.actorUserId, agent.name, agent.taskId])}`,
    userName: `${agent.name} (agent) · ${(access.actorName?.trim() || "Member").slice(0, 80)}`,
  };
}
