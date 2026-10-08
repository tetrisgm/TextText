import { useEffect, useRef, useState } from "react";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument } from "./model";
import { folderForItem } from "./folders";

export type TrashItem = { itemId: string; relativePath: string; revision: string };
export type TrashRestore = TrashItem & { operationId: string; basePath: string; baseRevision: string };
type RecoveryEntry = { id: string; path: string; kind: "deleted" | "revision" | "conflict"; savedAt: string; hash: string };
type RecoveryPage = { entries: RecoveryEntry[]; truncated: boolean };
type RecoveryFile = VaultFile & { data: string };
const labels = { deleted: "Deleted file", revision: "Saved revision", conflict: "Conflict copy" };

export function RecoveryDialog({ path, onClose, onRestore, onRestoreDeleted }: {
  path?: string; onClose: () => void;
  onRestoreDeleted: (request: TrashRestore) => Promise<void>;
  onRestore: (file: RecoveryFile, folder: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [trash, setTrash] = useState<{ items: TrashItem[]; truncated: boolean } | null>(null);
  const [deleted, setDeleted] = useState<TrashRestore | null>(null);
  const [trashError, setTrashError] = useState("");
  const [page, setPage] = useState<RecoveryPage | null>(null);
  const [file, setFile] = useState<RecoveryFile | null>(null);
  const [chosen, setChosen] = useState<RecoveryEntry | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [folder, setFolder] = useState(path ? folderForItem(path) : "");
  const active = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element?.showModal();
    if (!path) void vaultRequest<{ items: TrashItem[]; truncated: boolean }>("trashList", {}).then(value => { if (active.current) setTrash(value); }).catch((error: Error) => { if (active.current) setTrashError(error.message); });
    void vaultRequest<RecoveryPage>("recoveryList", path ? { path } : {}).then((value) => { if (active.current) setPage(value); })
      .catch((error: Error) => { if (active.current) setError(error.message); });
    return () => { active.current = false; element?.close(); };
  }, [path]);
  useEffect(() => {
    const element = dialog.current;
    const cancel = (event: Event) => { if (restoring) event.preventDefault(); };
    element?.addEventListener("cancel", cancel);
    element?.addEventListener("close", onClose);
    return () => { element?.removeEventListener("cancel", cancel); element?.removeEventListener("close", onClose); };
  }, [onClose, restoring]);
  const dismiss = () => { dialog.current?.close(); onClose(); };
  const preview = async (entry: RecoveryEntry) => {
    const request = ++sequence.current;
    setDeleted(null); setFolder(folderForItem(entry.path)); setChosen(entry); setFile(null); setLoading(true); setError("");
    try {
      const recovered = await vaultRequest<RecoveryFile>("recoveryRead", { id: entry.id });
      if (recovered.hash !== entry.hash) throw new Error("This recovery copy changed. Close and reopen recovery before restoring it.");
      readDocument(recovered);
      if (!recovered.data) throw new Error("The complete recovery file is unavailable.");
      if (active.current && sequence.current === request) setFile(recovered);
    } catch (error) { if (active.current && sequence.current === request) setError(error instanceof Error ? error.message : "The recovery copy could not be opened."); }
    finally { if (active.current && sequence.current === request) setLoading(false); }
  };
  const restore = async () => {
    if ((!file && !deleted) || restoring) return;
    setRestoring(true); setError("");
    try { if (deleted) await onRestoreDeleted(deleted); else if (file) await onRestore(file, folder.trim()); dismiss(); }
    catch (error) { if (active.current) setError(error instanceof Error ? error.message : "The recovery copy could not be restored."); }
    finally { if (active.current) setRestoring(false); }
  };
  const document = file ? readDocument(file) : null;
  return <dialog ref={dialog} className="vault-recovery" aria-labelledby="vault-recovery-title">
    <header><h2 id="vault-recovery-title">{path ? "Version history" : "Trash and recovery"}</h2><button autoFocus disabled={restoring} onClick={dismiss}>Close recovery</button></header>
    <p>{path || "Deleted files and conflict copies retained in this workspace."}</p>
    <p>Restore deleted items to their original location. Saved versions and conflict copies can be restored as separate files.</p>
    {trashError && <p role="status">Trash needs a connection. {trashError}</p>}
    {error && <p role="alert">{error}</p>}
    {!page && !error && <p role="status">Loading recovery files…</p>}
    {page && !page.entries.length && !trash?.items.length && <p>No retained {path ? "versions for this file" : "deleted files or conflict copies"}.</p>}
    {page?.truncated && <p role="status">Recovery reached its scan limit. More copies may exist in the workspace’s .texttext folder.</p>}
    <div className="vault-recovery-columns">
      <nav aria-label="Recovery files">{trash?.items.map(item => <button key={`trash:${item.itemId}`} disabled={restoring} aria-pressed={deleted?.itemId === item.itemId} onClick={() => { ++sequence.current; setFile(null); setChosen(null); setLoading(false); setError(""); setDeleted(current => current?.itemId === item.itemId ? current : { ...item, operationId: crypto.randomUUID(), basePath: item.relativePath, baseRevision: item.revision }); }}><strong>{item.relativePath}</strong><span>Deleted item</span></button>)}{page?.entries.map((entry) => <button key={entry.id} disabled={restoring} aria-pressed={chosen?.id === entry.id} onClick={() => void preview(entry)}>
        <strong>{entry.path}</strong><span>{labels[entry.kind]}</span><time dateTime={entry.savedAt}>{Number.isNaN(Date.parse(entry.savedAt)) ? "Date unavailable" : new Date(entry.savedAt).toLocaleString()}</time>
      </button>)}</nav>
      <section aria-label="Recovery preview">
        {deleted && <><h3>{deleted.relativePath}</h3><p>Restore this item with its existing links and comments.</p><button disabled={restoring} onClick={() => void restore()}>{restoring ? "Restoring…" : "Restore item"}</button></>}
        {loading && <p role="status">Loading saved version…</p>}
        {document && file && <><h3>{document.content.title || "Untitled"}</h3>
          <pre className="vault-recovery-text">{document.content.body?.slice(0, 50_000) || "No body text in this version."}</pre>
          {document.content.body.length > 50_000 && <p>Showing the first 50,000 characters. Restore includes the complete file.</p>}
          <p>{file.assets?.length ?? 0} attachments retained. {file.templateJSON ? "Saved design included." : "Standard design."}</p>
          <label>Restore into folder<input aria-label="Restore into folder" value={folder} disabled={restoring} onChange={(event) => setFolder(event.target.value)} placeholder="Workspace root" /></label>
          <button disabled={restoring} onClick={() => void restore()}>{restoring ? "Restoring…" : "Restore as a new file"}</button>
        </>}
      </section>
    </div>
  </dialog>;
}
