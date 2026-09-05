// The inbound boundary only. Approved writes use the canonical executor without
// coming back through this gate, so approval cannot recursively stage a write.
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolName } from "@/lib/ai/tools";
import { getOwnedBlog } from "@/lib/store";
import { rootDomainUrl } from "@/lib/site-url";
import { resolveMcpScopeAccess, type ToolContext } from "./tools";
import type { CallToolResult } from "./types";

export function hostedToolNeedsProposal(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
): boolean {
  return WORKSPACE_TOOL_DEFINITIONS[name].confirmation !== "none" ||
    (name === "update_item" && (
      args.markdown !== undefined ||
      (args.body !== undefined && args.section === undefined)
    ));
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
  } catch {
    // In particular, never fall back to direct execution on validation or
    // persistence failure. Database/provider errors are not client receipts.
    return error("The change could not be staged. Check the tool arguments and try again; nothing was executed.");
  }
}
