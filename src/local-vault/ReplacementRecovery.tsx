import { useEffect, useRef, useState } from "react";
import { captureVaultRequest, vaultRequest, type VaultFile } from "./bridge";
import { readDocument } from "./model";
import { packIdentity } from "./pack";

export type ReplacementRecoveryEntry = {
  id: string; path: string; itemId: string; currentHash: string;
  preparedHash: string; displacedHash: string; savedAt: string; resolved?: boolean;
};
type Version = "current" | "prepared" | "displaced";
type ParsedSnapshot = VaultFile & { opaque?: false; data: string; assetDetails?: { filename: string; contentType: string; length: number; digest: string }[] };
type Snapshot = ParsedSnapshot | { opaque: true; path: string; hash: string; data: string; parseError: string };
function decode(data: string) { return Uint8Array.from(atob(data), character => character.charCodeAt(0)); }
const versions: Version[] = ["current", "prepared", "displaced"];
const labels: Record<Version, string> = { current: "Current file", prepared: "Save attempt", displaced: "Other retained version" };

/** The request and inspected hashes belong to one dialog, never a replacement account transport. */
export function ReplacementRecovery({ entries, workspaceRoot, disabled, onRestore }: {
  entries: ReplacementRecoveryEntry[]; workspaceRoot: string; disabled: boolean;
  onRestore?: (file: ParsedSnapshot) => Promise<void>;
}) {
  const [request] = useState(() => {
    const native = (window as unknown as { webkit?: { messageHandlers?: { localVault?: unknown } } }).webkit?.messageHandlers?.localVault;
    return native ? vaultRequest : captureVaultRequest();
  });
  const [chosen, setChosen] = useState<ReplacementRecoveryEntry | null>(null);
  const [snapshots, setSnapshots] = useState<Partial<Record<Version, Snapshot>>>({});
  const [version, setVersion] = useState<Version>("current");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<string[]>([]);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  const inspect = async (entry: ReplacementRecoveryEntry) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const captured = ++generation.current;
    setChosen(entry); setSnapshots({}); setVersion("current"); setBusy(true); setError("");
    try {
      const values = await Promise.all(versions.map(async version => {
        const file = await request<Snapshot>("replacementRead", { workspaceRoot, id: entry.id, version }, abort.signal);
        const expected = entry[`${version}Hash` as "currentHash" | "preparedHash" | "displacedHash"];
        if (file.path !== entry.path || file.hash !== expected || !file.data || (file.opaque && version !== "displaced")) throw new Error("These recovery versions changed. Close and reopen recovery to inspect them again.");
        if (file.opaque) return [version, file] as const;
        if (version !== "displaced" && packIdentity(file.markdown) !== entry.itemId) throw new Error("This retained version belongs to another document. Reopen recovery to continue.");
        packIdentity(file.markdown);
        readDocument(file);
        if ((file.assets?.length ?? 0) > 256) throw new Error("This version has too many attachments to inspect safely.");
        file.assetDetails = await Promise.all((file.assets ?? []).map(async asset => {
          const bytes = decode(asset.data);
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          return { filename: asset.filename, contentType: asset.contentType, length: bytes.byteLength, digest: [...digest].map(value => value.toString(16).padStart(2, "0")).join("") };
        }));
        return [version, file] as const;
      }));
      if (generation.current === captured && !abort.signal.aborted) setSnapshots(Object.fromEntries(values));
    } catch (cause) { if (generation.current === captured && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "The retained versions could not be opened."); }
    finally { if (generation.current === captured && !abort.signal.aborted) setBusy(false); }
  };
  const keepCurrent = async () => {
    if (!chosen || chosen.resolved || resolved.includes(chosen.id) || busy || disabled || versions.some(version => !snapshots[version])) return;
    const captured = generation.current; const entry = chosen; const abort = controller.current!;
    setBusy(true); setError("");
    try {
      const result = await request<{ resolved: boolean }>("resolveReplacement", { workspaceRoot, ...entry }, abort.signal);
      if (generation.current !== captured || abort.signal.aborted) return;
      if (result.resolved !== true) throw new Error("The file changed. Close and reopen recovery before choosing a version.");
      setResolved(current => [...current, entry.id]); setChosen({ ...entry, resolved: true });
    } catch (cause) { if (generation.current === captured && !abort.signal.aborted) { setSnapshots({}); setError(cause instanceof Error ? cause.message : "The recovery could not be finished."); } }
    finally { if (generation.current === captured && !abort.signal.aborted) setBusy(false); }
  };
  const download = (snapshot: Snapshot) => {
    try {
      const url = URL.createObjectURL(new Blob([decode(snapshot.data)], { type: "application/octet-stream" }));
      const link = window.document.createElement("a"); link.href = url; link.download = `texttext-recovery-${version}.${snapshot.opaque ? "bin" : "textpack"}`;
      window.document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("This complete recovery file could not be downloaded. Inspect it again before retrying."); }
  };
  const restoreCopy = async (snapshot: ParsedSnapshot) => {
    if (!onRestore || busy || disabled) return;
    const captured = generation.current; setBusy(true); setError("");
    try { await onRestore(snapshot); }
    catch (cause) { if (generation.current === captured) setError(cause instanceof Error ? cause.message : "The version could not be restored as a new file."); }
    finally { if (generation.current === captured) setBusy(false); }
  };
  const snapshot = snapshots[version]; const document = snapshot && !snapshot.opaque ? readDocument(snapshot) : null;
  const remaining = entries;
  const chosenResolved = Boolean(chosen && (chosen.resolved || resolved.includes(chosen.id)));
  return <section aria-label="Interrupted saves" className="vault-replacement-recovery">
    <h3>Interrupted saves</h3>
    <p>A file changed during saving. Inspect the retained versions before keeping the current file. Your editor draft stays open.</p>
    {chosenResolved && <p role="status">Recovery finished. Retained versions remain available to inspect and download. You can retry saving your editor draft.</p>}
    <nav aria-label="Interrupted files">{remaining.map(entry => <button key={entry.id} disabled={busy || disabled} aria-pressed={chosen?.id === entry.id} onClick={() => void inspect(entry)}>{entry.path}{entry.resolved || resolved.includes(entry.id) ? " (resolved)" : ""}</button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Checking retained versions…</p>}
    {chosen && <div>
      <div role="group" aria-label="Versions to inspect">{versions.map(value => <button key={value} disabled={!snapshots[value] || busy} aria-pressed={version === value} onClick={() => setVersion(value)}>{labels[value]}</button>)}</div>
      {version === "displaced" && snapshot && !snapshot.opaque && packIdentity(snapshot.markdown) !== chosen.itemId && <p role="status">This retained version belongs to another document. Keeping the current file preserves this complete copy in recovery.</p>}
      {snapshot?.opaque && <><p role="status">This retained file cannot be opened as a TextPack. Its complete bytes are retained and can be downloaded.</p><p><code>SHA-256: {snapshot.hash}</code></p><button disabled={busy} onClick={() => download(snapshot)}>Download retained file</button></>}
      {document && snapshot && !snapshot.opaque && <><h4>{document.content.title || "Untitled"}</h4><pre className="vault-recovery-text">{document.content.body.slice(0, 50_000) || "No body text in this version."}</pre><p>{snapshot.assets?.length ?? 0} {snapshot.assets?.length === 1 ? "attachment" : "attachments"} retained. {document.content.body.length > 50_000 ? "Preview limited to 50,000 characters. The complete file is retained." : ""}</p>
        <details><summary>File and attachment details</summary><p>TextPack SHA-256: <code>{snapshot.hash}</code></p><ul>{snapshot.assetDetails?.map(asset => <li key={asset.filename}><strong>{asset.filename}</strong> · {asset.contentType} · {asset.length.toLocaleString()} bytes<br /><code>SHA-256: {asset.digest}</code></li>)}</ul></details>
        <button disabled={busy} onClick={() => download(snapshot)}>Download TextPack</button>
        {onRestore && <button disabled={busy || disabled} onClick={() => void restoreCopy(snapshot)}>Restore this version as a new file</button>}
      </>}
      {!chosenResolved && <><p>Keep the current file at {chosen.path}. Both other versions will remain available in recovery. This does not save or discard your editor draft.</p>
      <button disabled={busy || disabled || versions.some(value => !snapshots[value])} onClick={() => void keepCurrent()}>Keep current file</button></>}
    </div>}
  </section>;
}
