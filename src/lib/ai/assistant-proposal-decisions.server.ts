import {
  decideWorkspaceWriteProposal,
  type WorkspaceWriteProposalActor,
} from "@/lib/ai/write-proposals.server";
import { decideOutboundMcpProposal } from "@/lib/ai/outbound-proposals.server";

/** Dispatch one opaque proposal id without letting the client choose its kind. */
export async function decideAssistantProposal(input: {
  actor: WorkspaceWriteProposalActor;
  proposalId: string;
  decision: "approve" | "deny";
}) {
  const workspace = await decideWorkspaceWriteProposal(input);
  return workspace.status === "not_found"
    ? decideOutboundMcpProposal(input)
    : workspace;
}
