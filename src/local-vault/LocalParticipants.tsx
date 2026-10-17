import { REQUEST_ADD_ITEM_AGENT_EVENT } from "./agent-task";

export function ParticipantsRow({ postId }: { postId?: string | null; handle?: string; canReviewChanges?: boolean }) {
  if (!postId) return null;
  // Actual people/presence are owned by CollaborativeVaultEditor. An available
  // agent action does not establish an editing session or an active agent.
  return <div className="vault-local-participants" role="group" aria-label="Item agent">
    <button type="button" className="vault-local-add-agent" aria-label="Add agent" title="Add agent"
      onClick={() => window.dispatchEvent(new CustomEvent(REQUEST_ADD_ITEM_AGENT_EVENT))}>
      <span aria-hidden="true">+</span><span>Add agent</span>
    </button>
  </div>;
}
