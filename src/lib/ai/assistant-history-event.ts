export const ASSISTANT_HISTORY_CHANGED = "texttext:assistant-history-changed";

export function publishAssistantHistoryChanged(handle: string): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_HISTORY_CHANGED, { detail: { handle } }));
}
