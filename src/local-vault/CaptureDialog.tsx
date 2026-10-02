import { useState } from "react";
import { useEscapeLayer } from "./LocalKeyboard";

export function captureInput(text: string, title: string) {
  const body = text.trim();
  if (!body) throw new Error("Paste a link or write a note first.");
  let sourceURL: string | undefined;
  const bareAddress = /^(?:localhost(?::\d+)?|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+(?::\d+)?)(?:[/?#]\S*)?$/iu.test(body);
  if (/^https?:\/\/\S+$/i.test(body) || bareAddress) {
    const url = new URL(bareAddress ? `https://${body}` : body);
    if (url.username || url.password) throw new Error("Remove the username or password from this link before saving it.");
    sourceURL = url.href;
  }
  return { title: title.trim() || (sourceURL ? new URL(sourceURL).hostname : body.split("\n")[0].slice(0, 100)), body: sourceURL ?? body,
    kind: sourceURL ? "bookmark" : "note", ...(sourceURL ? { sourceURL } : {}) };
}

export function CaptureDialog({ onClose, onSave, bookmarkOnly = false }: { onClose: () => void; onSave: (input: ReturnType<typeof captureInput>) => Promise<void>; bookmarkOnly?: boolean }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pasteLink = async () => {
    try {
      const copied = (await navigator.clipboard.readText()).trim();
      if (!copied) throw new Error("Copy a web address first.");
      if (copied.length > 4096) throw new Error("The copied web address is too long.");
      if (!captureInput(copied, "").sourceURL) throw new Error("The copied text is not a web address.");
      setText(copied); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read the clipboard. Paste the link into the field."); }
  };
  useEscapeLayer(!busy, "capture", onClose);
  return <section className="vault-template-dialog vault-capture" role="dialog" aria-modal="true" aria-label={bookmarkOnly ? "Save bookmark" : "Save a link or note"}>
    <header><h2>{bookmarkOnly ? "Save bookmark" : "Save a link or note"}</h2><button disabled={busy} onClick={onClose}>Cancel</button></header>
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(""); void (async () => {
      try { const input = captureInput(text, title); if (bookmarkOnly && !input.sourceURL) throw new Error("Enter the web address of the page to save."); await onSave(input); onClose(); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not save. Your text is still here."); }
      finally { setBusy(false); }
    })(); }}>
      {bookmarkOnly ? <><label>Web address<input autoFocus type="text" inputMode="url" autoCapitalize="none" spellCheck={false} aria-label="Web address" placeholder="Paste a link or enter example.com" disabled={busy} value={text} onChange={(event) => setText(event.target.value)} maxLength={4096} /></label><button className="vault-capture-paste" type="button" disabled={busy} onClick={() => void pasteLink()}>Paste copied link</button></> : <label>Link or note<textarea autoFocus aria-label="Link or note" disabled={busy} value={text} onChange={(event) => setText(event.target.value)} maxLength={1_000_000} /></label>}
      {bookmarkOnly ? <details><summary>Set a title</summary><label>Title (optional)<input aria-label="Capture title" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></label></details>
        : <label>Title (optional)<input aria-label="Capture title" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></label>}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !text.trim()} type="submit">{busy ? "Saving…" : bookmarkOnly ? "Save bookmark" : "Save to folder"}</button>
    </form>
  </section>;
}
