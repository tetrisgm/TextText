import { REQUEST_ADD_ITEM_AGENT_EVENT } from "./agent-task";

export function ParticipantsRow({ postId }: { postId?: string | null; handle?: string; canReviewChanges?: boolean }) {
  if (!postId) return null;
  return <div className="vault-local-participants" role="group" aria-label="People and agents on this item">
    <span className="vault-local-person" title="You are editing" aria-label="You are editing">Y</span>
    <button type="button" className="vault-local-add-agent" aria-label="Add agent" title="Add agent"
      onClick={() => window.dispatchEvent(new CustomEvent(REQUEST_ADD_ITEM_AGENT_EVENT))}>
      <span aria-hidden="true">+</span><span>Add agent</span>
    </button>
  </div>;
}
