import { useEffect, useRef, useState } from "react";
import { captureVaultRequest, vaultRequest } from "./bridge";
export type RecoveryAssetEntry = { id: string; filename: string; byteLength: number; hash: string; savedAt: string; entryPath?: string; itemPath?: string; provenanceError?: string };
export function RecoveryAssets({ entries, truncated, workspaceRoot }: { entries: RecoveryAssetEntry[]; truncated?: boolean; workspaceRoot: string }) {
  const [request] = useState(() => (window as unknown as { webkit?: { messageHandlers?: { localVault?: unknown } } }).webkit?.messageHandlers?.localVault ? vaultRequest : captureVaultRequest());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lifetime = useRef(new AbortController());
  useEffect(() => { const controller = lifetime.current; return () => controller.abort(); }, []);
  const download = async (entry: RecoveryAssetEntry) => {
    if (busy) return;
    const signal = lifetime.current.signal; setBusy(entry.id); setError("");
    try {
      const file = await request<{ data: string; hash: string; byteLength: number }>("recoveryAssetRead", { workspaceRoot, id: entry.id, hash: entry.hash }, signal);
      if (signal.aborted) return;
      if (typeof file.data !== "string" || file.data.length > Math.ceil(16 * 1024 * 1024 / 3) * 4) throw new Error("This retained attachment exceeds the recovery size limit.");
      const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
      if (bytes.byteLength > 16 * 1024 * 1024 || bytes.byteLength !== entry.byteLength || file.byteLength !== entry.byteLength || file.hash !== entry.hash) throw new Error("This retained attachment changed. Close and reopen recovery before downloading it.");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
      if (digest !== entry.hash) throw new Error("The retained attachment could not be verified. Its original bytes remain in recovery.");
      if (signal.aborted) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a"); link.href = url; link.download = "texttext-submitted-attachment.bin";
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : "The retained attachment could not be downloaded."); }
    finally { if (!signal.aborted) setBusy(null); }
  };
  return <section className="vault-replacement-recovery" aria-label="Retained attachments">
    <h3>Retained attachments</h3><p>These are submitted attachment bytes kept separately during a conflict. A later document may contain a different version. Downloading leaves all originals intact.</p>
    {error && <p role="alert">{error}</p>}
    {truncated && <p role="status">The attachment scan reached its limit. More retained files may exist in this workspace.</p>}
    <ul>{entries.map(entry => <li key={entry.id}><strong>Submitted attachment</strong> · {entry.byteLength.toLocaleString()} bytes
      {entry.entryPath ? <p>{entry.entryPath}{entry.itemPath ? ` in ${entry.itemPath}` : ""}</p> : <p>{entry.provenanceError || "Original document details are unavailable for this retained copy."}</p>}
      <code>SHA-256: {entry.hash}</code><br /><button disabled={busy !== null} onClick={() => void download(entry)}>{busy === entry.id ? "Checking attachment…" : "Download attachment"}</button></li>)}</ul>
  </section>;
}
