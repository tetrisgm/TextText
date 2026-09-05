// The inbound boundary only. Approved writes use the canonical executor without
// coming back through this gate, so approval cannot recursively stage a write.
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolName } from "@/lib/ai/tools";
import { getOwnedBlog } from "@/lib/store";
import { rootDomainUrl } from "@/lib/site-url";
import { resolveMcpScopeAccess, type ToolContext } from "./tools";
import type { CallToolResult } from "./types";

/**
 * Which inbound hosted calls wait for the owner. Deleting, emptying the Trash,
 * removing an asset, retiring a look and publishing widen the blast radius or
 * the audience and cannot be undone by the agent's own history, so they are
 * staged. Restores undo a deletion, named access grants are the owner acting
 * through their own token, and whole-body rewrites are recorded in
 * agent_changes and revertable, so those run directly, audited.
 */
const HOSTED_STAGED_TOOLS: ReadonlySet<WorkspaceToolName> = new Set<WorkspaceToolName>([
  "delete_item",
  "delete_items",
  "delete_folder",
  "empty_trash",
  "remove_item_asset",
  "retire_document_template",
]);

export function hostedToolNeedsProposal(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
): boolean {
  if (HOSTED_STAGED_TOOLS.has(name)) return true;
  if (name === "set_item_status") return args.status === "published";
  return false;
}

export async function stageHostedToolProposal(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<CallToolResult> {
  const error = (text: string): CallToolResult => ({
    isError: true, content: [{ type: "text", text }],
  });
  // Scope checks must precede staging: approval is not a scope escalation.
  if (resolveMcpScopeAccess(context.authInfo?.scopes) !== "full") {
    return error("A full sync connection is required to stage changes.");
  }
  const { sub, userId, connectionName } = context.authInfo?.extra ?? {};
  if (typeof sub !== "string" || !sub || typeof userId !== "string" || !userId) {
    return error("An authenticated workspace owner is required to stage changes.");
  }
  try {
    const blog = await getOwnedBlog(sub);
    if (!blog) return error("Workspace not found.");
    const { createWorkspaceWriteProposal } = await import("@/lib/ai/write-proposals.server");
    const proposal = await createWorkspaceWriteProposal({
      actor: { sub, userId, handle: blog.handle },
      tool: name,
      arguments: args,
      origin: { surface: "hosted_mcp", connectionName: typeof connectionName === "string" ? connectionName : "Connected agent" },
    });
    const result = {
      approvalRequired: true,
      proposalId: proposal.id,
      reviewUrl: new URL(`/proposals/${proposal.id}`, rootDomainUrl()).href,
      proposal,
      message: "Staged for owner review in TextText. Nothing has been changed. Open the review link to approve or dismiss this proposal.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (cause) {
    // In particular, never fall back to direct execution on validation or
    // persistence failure. Database/provider errors are not client receipts.
    // The cause goes to the server log so a failed staging can be diagnosed.
    console.error("[mcp] staging failed", name, cause instanceof Error ? cause.message : cause);
    return error("The change could not be staged. Check the tool arguments and try again; nothing was executed.");
  }
}
