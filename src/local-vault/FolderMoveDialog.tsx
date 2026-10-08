import { useState } from "react";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest } from "./bridge";

export function folderMoveDestination(source: string, destination: string): string {
  const path = destination.trim();
  if (!path || path.length > 256 || path.startsWith("/") || path.split("/").some(part =>
    !part || part.startsWith(".") || /[\\\x00-\x1f:]/.test(part))) throw new Error("Enter a folder path such as Archive/Notes.");
  if (path === source) throw new Error("Choose a different folder path.");
  if (path.startsWith(source + "/")) throw new Error("A folder cannot move inside itself.");
  return path;
}
export async function prepareFolderMoveReview(source: string, destination: string, native: boolean): Promise<string> {
  const path = folderMoveDestination(source, destination);
  const result = await vaultRequest<{ reviewPath: string }>("folderMoveReview", { source, destination: path });
  if (!/^\/proposals\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.reviewPath)) throw new Error("The folder review could not be opened.");
  if (!native) return result.reviewPath;
  const connection = await vaultRequest<{ webURL?: string }>("connection");
  if (!connection.webURL) throw new Error("The workspace web address is unavailable.");
  const origin = new URL(connection.webURL);
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("The workspace web address is invalid.");
  return new URL(result.reviewPath, origin.origin).href;
}

export function FolderMoveDialog({ source, native, onClose }: { source: string; native: boolean; onClose: () => void }) {
  const [destination, setDestination] = useState(source);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<string | null>(null);
  useEscapeLayer(!busy, "folder-move", onClose);
  return <section className="vault-template-dialog vault-folder-move" role="dialog" aria-modal="true" aria-label="Move folder">
    <header><h2>Move folder</h2><button type="button" disabled={busy} onClick={onClose}>Close</button></header>
    <p>{source}</p>
    {review ? <><p>The move is ready to review. Your files stay where they are until you approve.</p>
      <a href={review} target="_blank" rel="noopener noreferrer">Review folder move</a></> :
      <form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError("");
        void prepareFolderMoveReview(source, destination, native).then(setReview)
          .catch(reason => setError(reason instanceof Error ? reason.message : "The folder review could not be prepared."))
          .finally(() => setBusy(false)); }}>
        <label>New folder path<input autoFocus value={destination} disabled={busy} onChange={event => setDestination(event.target.value)} /></label>
        <p>All files and subfolders move together. Review any access changes before applying.</p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Preparing review…" : "Prepare move"}</button>
      </form>}
  </section>;
}
