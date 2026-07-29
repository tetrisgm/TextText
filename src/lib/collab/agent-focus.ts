export type AgentFocusEvent = {
  eventId: string;
  targetUserId: string;
  workspaceHandle: string;
  folderPath: string;
  postId: string;
  path: string;
  mode: "read" | "edit";
  requestedAt: string;
};

export function isAgentFocusEvent(value: unknown): value is AgentFocusEvent {
  if (!value || typeof value !== "object") return false;
  const focus = value as Partial<AgentFocusEvent>;
  return (
    typeof focus.eventId === "string" &&
    focus.eventId.length > 0 &&
    typeof focus.targetUserId === "string" &&
    focus.targetUserId.length > 0 &&
    typeof focus.workspaceHandle === "string" &&
    focus.workspaceHandle.length > 0 &&
    typeof focus.folderPath === "string" &&
    focus.folderPath.length > 0 &&
    typeof focus.postId === "string" &&
    focus.postId.length > 0 &&
    typeof focus.path === "string" &&
    focus.path.startsWith("/") &&
    (focus.mode === "read" || focus.mode === "edit") &&
    typeof focus.requestedAt === "string" &&
    Number.isFinite(Date.parse(focus.requestedAt))
  );
}
