import { useState } from "react";
import { useEscapeLayer } from "./LocalKeyboard";

export function captureInput(text: string, title: string) {
  const body = text.trim();
  if (!body) throw new Error("Paste a link or write a note first.");
  let sourceURL: string | undefined;
  if (/^https?:\/\/\S+$/i.test(body)) {
    const url = new URL(body);
    if (url.username || url.password) throw new Error("Remove the username or password from this link before saving it.");
    sourceURL = url.href;
  }
  return { title: title.trim() || (sourceURL ? new URL(sourceURL).hostname : body.split("\n")[0].slice(0, 100)), body,
    kind: sourceURL ? "bookmark" : "note", ...(sourceURL ? { sourceURL } : {}) };
}

export function CaptureDialog({ onClose, onSave }: { onClose: () => void; onSave: (input: ReturnType<typeof captureInput>) => Promise<void> }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscapeLayer(!busy, "capture", onClose);
  return <section className="vault-template-dialog vault-capture" role="dialog" aria-modal="true" aria-label="Save a link or note">
    <header><h2>Save a link or note</h2><button disabled={busy} onClick={onClose}>Cancel</button></header>
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(""); void (async () => {
      try { await onSave(captureInput(text, title)); onClose(); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not save. Your text is still here."); }
      finally { setBusy(false); }
    })(); }}>
      <label>Link or note<textarea autoFocus aria-label="Link or note" disabled={busy} value={text} onChange={(event) => setText(event.target.value)} maxLength={1_000_000} /></label>
      <label>Title (optional)<input aria-label="Capture title" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !text.trim()} type="submit">{busy ? "Saving…" : "Save to folder"}</button>
    </form>
  </section>;
}
