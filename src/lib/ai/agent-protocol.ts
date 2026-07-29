/**
 * Who is calling a workspace tool, when the caller is an external agent rather
 * than the person at the keyboard.
 *
 * The native loopback MCP server learns this from `initialize.params.clientInfo`
 * (falling back to the HTTP user agent) and forwards it through the page bridge,
 * so a local Codex or Claude session appears as itself in the collaborator list
 * instead of as an anonymous local caller.
 */
export type WorkspaceAgentActor = {
  /** Canonical connection label; agentIdentity() maps this to a provider. */
  connectionName: string;
  /** Raw MCP clientInfo.name, when the client supplied one. */
  clientName?: string;
  /** Raw MCP clientInfo.version, when the client supplied one. */
  clientVersion?: string;
};

/** Which document field an agent is about to touch, for the cursor position. */
export type WorkspaceAgentActivityField = "title" | "subtitle" | "body";

/**
 * What the agent is doing right now. `open` publishes presence as the app
 * navigates to the item; `edit` publishes presence just before a mutation so
 * the cursor lands with the change rather than after it.
 */
export type WorkspaceAgentActivity = {
  kind: "open" | "edit";
  field?: WorkspaceAgentActivityField;
};

export type WorkspaceAgentToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  requestTag?: string,
  actor?: WorkspaceAgentActor,
) => Promise<unknown>;
