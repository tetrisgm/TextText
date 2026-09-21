"use client";

import { useRef, useState } from "react";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import { writingKind } from "@/lib/workspace/writing";
import { sourceNoteMarkdown } from "@/lib/workspace/source-note";
import { StoryActions } from "@/components/workspace/home/StoryActions";

export function SourceNoteAction({ pool, sourceId, title, sourcePath, onOpenNote }: {
  pool: WorkspacePoolPayload; sourceId: string; title: string; sourcePath: string;
  onOpenNote: (id: string) => Promise<void>;
}) {
  const [passage, setPassage] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const operation = useRef<{ key: string; destination: string; body: string } | null>(null);
  const notes = pool.posts.filter((post) => writingKind(post) !== null && post.id !== sourceId);
  const save = async () => {
    if (busy || passage === null) return;
    const request = operation.current ?? {
      key: `source-note:${crypto.randomUUID()}`,
      destination,
      body: sourceNoteMarkdown(passage, title, new URL(sourcePath, window.location.origin).href, pool.posts.find((post) => post.id === sourceId)?.slug),
    };
    operation.current = request;
    setBusy(true); setError(null);
    try {
      const newArticle = request.destination === "new:article";
      const result = request.destination && !newArticle
        ? await executeWorkspaceToolRequest(pool.blog.handle, "append_to_item", { id: request.destination, markdown: request.body, idempotency_key: request.key })
        : await executeWorkspaceToolRequest(pool.blog.handle, "create_item", { kind: newArticle ? "article" : "note", title: `${newArticle ? "Draft" : "Notes"} on ${title || "this article"}`.slice(0, 300), body: request.body, template_id: newArticle ? "texttext.article" : "texttext.note", template_version: 1, idempotency_key: request.key });
      const item = result.item as { id?: unknown } | undefined;
      if (typeof item?.id !== "string") throw new Error(typeof result.error === "string" ? result.error : "The document could not be saved. Try again.");
      setSaved(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document could not be saved. Try again.");
    } finally { setBusy(false); }
  };
  return <>
    <button type="button" className="ac-btn ac-btn-gray" onMouseDown={(event) => event.preventDefault()} onClick={() => {
      const selection = window.getSelection();
      const element = selection?.anchorNode?.parentElement;
      const inReader = element?.closest(".tt-document");
      const endReader = selection?.focusNode?.parentElement?.closest(".tt-document");
      setPassage(inReader && inReader === endReader ? selection?.toString() ?? "" : "");
      setDestination(""); setSaved(null); setError(null); operation.current = null;
    }}>Add to document</button>
    {passage !== null && <StoryActions label="Add to document" onClose={() => { if (!busy) setPassage(null); }}>
      <div className="source-note-form">
        <h2>{saved ? "Added to your document" : "Add to document"}</h2>
        {saved ? <><p>{passage ? "The source link and passage are saved." : "The source link is saved."}</p>
          {error && <p role="alert">{error}</p>}
          <button className="ac-btn ac-btn-gray" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await onOpenNote(saved); setPassage(null); }
            catch { setError("Your document is saved, but could not be opened. Try opening it again."); }
            finally { setBusy(false); }
          }}>{busy ? "Opening…" : "Open document"}</button>
          <button className="ac-btn ac-btn-gray" disabled={busy} onClick={() => setPassage(null)}>Done</button></> : <>
          <p>Select a passage before opening this panel, or add the source link on its own.</p>
          {passage && <blockquote>{passage}</blockquote>}
          <label>Destination<select value={destination} disabled={busy || Boolean(error)} onChange={(event) => setDestination(event.target.value)}>
            <option value="">New note</option><option value="new:article">New article</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.title || "Untitled"}</option>)}
          </select></label>
          {error && <p role="alert">{error}</p>}
          <button className="ac-btn ac-btn-gray" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : error ? "Retry" : "Add to document"}</button>
        </>}
      </div>
    </StoryActions>}
  </>;
}
