"use client";

type SaveState = "local" | "saving" | "saved" | "offline" | "error" | "unconfirmed";

export function editorSaveLabel(state: SaveState, networkEnabled: boolean, ready = true, error?: string | null): string {
  switch (state) {
    case "local": return networkEnabled ? ready ? "Waiting to save" : "Connecting" : "On this device";
    case "offline": return "Offline";
    case "unconfirmed": return "Connection not confirmed";
    case "error": return error ?? "Save not confirmed";
    case "saving": return "Saving";
    case "saved": return "Saved";
  }
}

export function EditorSaveNotice({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state !== "error" && state !== "offline" && state !== "unconfirmed") return null;
  return <div className="workspace-post-body-status applecms">
    <p>{state === "offline" ? "You are offline. Changes on this device may not have reached the server." : state === "unconfirmed" ? "The connection has not been confirmed. Changes on this device may not have reached the server." : "The connection or save failed. Changes on this device may not have reached the server."}</p>
    <p>Your text is still in this editor. Keep this page open or copy your text before leaving. {state === "offline" ? "Reconnect, then retry saving." : "Retry saving when you are ready."}</p>
    <button type="button" className="ac-btn ac-btn-gray" onClick={onRetry}>Retry saving</button>
  </div>;
}
