import { useEffect, useRef, useState } from "react";
import { captureVaultRequest, vaultRequest } from "./bridge";

export type SavedFileMoveRecoveryEntry = {
  id: string; itemId: string; sourcePath: string; destinationPath: string;
  requestHash: string | null; state: "pending" | "terminal-rejected" | "stopped" | "review";
  localPath: string | null; remotePath: string | null; inspection: string | null;
  retryAllowed: boolean; keepNamesAllowed: boolean;
  blockedReason: null | "ownership" | "lifecycle" | "unavailable" | "permission" | "checkpoint" | "recovery" | "ambiguous" | "stale";
};
const reasons = {
  ownership: "Reconnect to the account and workspace that saved this move.",
  lifecycle: "This item changed or was deleted. Keep its recovery copies while reviewing its current state.",
  unavailable: "The current local or server file could not be checked. Try inspecting again when it is available.",
  permission: "Your current access does not allow this move.",
  checkpoint: "Wait for the current edits to finish saving, then inspect again.",
  recovery: "Another recovery step must finish before this move can continue.",
  ambiguous: "The outcome of this move is not yet confirmed. Its saved request and current files are retained.",
  stale: "The file changed during inspection. Inspect it again before continuing.",
} as const;
const hash = (v: unknown): v is string => typeof v === "string" && v.length === 64 && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const path = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(v) && v.split("/").every(p => p && p !== "." && p !== "..");
export function validateSavedFileMoveRecovery(v: unknown): SavedFileMoveRecoveryEntry {
  const keys = ["id", "itemId", "sourcePath", "destinationPath", "requestHash", "state", "localPath", "remotePath", "inspection", "retryAllowed", "keepNamesAllowed", "blockedReason"];
  const fail = () => { throw Error("This saved file move could not be verified. Reopen Recovery before continuing."); };
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const r = v as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || !keys.every(k => Object.hasOwn(r, k)) || !uuid(r.id) || !uuid(r.itemId) || !path(r.sourcePath) || !path(r.destinationPath) || r.sourcePath === r.destinationPath ||
      (r.requestHash !== null && !hash(r.requestHash)) || (r.inspection !== null && !hash(r.inspection)) ||
      (r.localPath !== null && !path(r.localPath)) || (r.remotePath !== null && !path(r.remotePath)) ||
      !["pending", "terminal-rejected", "stopped", "review"].includes(r.state as string) ||
      typeof r.retryAllowed !== "boolean" || typeof r.keepNamesAllowed !== "boolean" ||
      (r.blockedReason !== null && (typeof r.blockedReason !== "string" || !Object.hasOwn(reasons, r.blockedReason)))) return fail();
  if (r.state !== "review" && !hash(r.requestHash)) return fail();
  if ((r.retryAllowed && r.state !== "pending") || (r.keepNamesAllowed && r.state !== "terminal-rejected") || (r.retryAllowed && r.keepNamesAllowed)) return fail();
  if ((r.retryAllowed || r.keepNamesAllowed) && (!hash(r.inspection) || !hash(r.requestHash) || r.blockedReason !== null || r.localPath === null || r.remotePath === null)) return fail();
  return r as SavedFileMoveRecoveryEntry;
}
const sameRequest = (a: SavedFileMoveRecoveryEntry, b: SavedFileMoveRecoveryEntry) => a.id === b.id && a.itemId === b.itemId && a.sourcePath === b.sourcePath && a.destinationPath === b.destinationPath && a.requestHash === b.requestHash;

export function SavedFileMoveRecovery({ entries, truncated, workspaceRoot, disabled, onResolved }: {
  entries: SavedFileMoveRecoveryEntry[]; truncated?: boolean; workspaceRoot: string; disabled: boolean; onResolved: () => void;
}) {
  const [request] = useState(() => (window as unknown as { webkit?: { messageHandlers?: { localVault?: unknown } } }).webkit?.messageHandlers?.localVault ? vaultRequest : captureVaultRequest());
  const [chosen, setChosen] = useState<SavedFileMoveRecoveryEntry | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [finished, setFinished] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setChosen(null); setBusy(false); setError(""); setFinished(false);
    return () => { ++sequence.current; controller.current?.abort(); };
  }, [workspaceRoot]);
  let rows: SavedFileMoveRecoveryEntry[] = [], invalid = false;
  try {
    if (!Array.isArray(entries) || entries.length > 100) throw Error();
    rows = entries.map(validateSavedFileMoveRecovery);
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error();
  } catch { rows = []; invalid = true; }
  const inspect = async (row: SavedFileMoveRecoveryEntry) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const captured = ++sequence.current;
    setChosen(null); setBusy(true); setError(""); setFinished(false);
    try {
      const result = validateSavedFileMoveRecovery(await request("savedFileMoveRead", {workspaceRoot,id:row.id}, abort.signal));
      if (!sameRequest(row, result)) throw Error("This saved move changed. Reopen Recovery before continuing.");
      if (captured === sequence.current && !abort.signal.aborted) setChosen(result);
    } catch { if (captured === sequence.current && !abort.signal.aborted) setError("The saved move could not be inspected. Reopen Recovery or try again."); }
    finally { if (captured === sequence.current && !abort.signal.aborted) setBusy(false); }
  };
  const resolve = async (keepNames: boolean) => {
    if (!chosen || busy || disabled || finished || !(keepNames ? chosen.keepNamesAllowed : chosen.retryAllowed)) return;
    const row = chosen, captured = sequence.current, abort = controller.current;
    if (!abort || abort.signal.aborted) return;
    setBusy(true); setError("");
    try {
      const result = await request<{resolved: boolean}>(keepNames ? "keepSavedFileMoveNames" : "retrySavedFileMove", {workspaceRoot,id:row.id,requestHash:row.requestHash,inspection:row.inspection,consent:true}, abort.signal);
      if (captured !== sequence.current || abort.signal.aborted) return;
      if (!result || result.resolved !== true) throw Error();
      setFinished(true); onResolved();
    } catch { if (captured === sequence.current && !abort.signal.aborted) { setChosen(null); setError("The file may have changed. Inspect the saved move again before continuing."); } }
    finally { if (captured === sequence.current && !abort.signal.aborted) setBusy(false); }
  };
  return <section className="vault-replacement-recovery" aria-label="Saved file moves"><h3>Saved file moves</h3>
    <p>A file name changed before synchronization finished. Inspect the saved move and the current local and server names.</p>
    <nav aria-label="Saved file moves">{rows.map(row => <button key={row.id} disabled={busy || disabled} onClick={() => void inspect(row)}>{row.sourcePath} → {row.destinationPath}</button>)}</nav>
    {invalid && <p role="alert">These saved moves could not be verified. Update TextText or reopen Recovery.</p>}
    {truncated && <p role="status">Showing the first 100 saved moves. Open an individual file’s history to narrow the list.</p>}
    {busy && <p role="status">Checking the saved move…</p>}{error && <p role="alert">{error}</p>}
    {chosen && <div><dl>{[["Original name",chosen.sourcePath],["Requested name",chosen.destinationPath],["Current local name",chosen.localPath ?? "Unavailable"],["Current server name",chosen.remotePath ?? "Unavailable"]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {chosen.blockedReason && <p role="status">{reasons[chosen.blockedReason]}</p>}
      {chosen.state === "stopped" && <p>Automatic retries of this saved move have stopped. Current files and names are retained.</p>}
      {chosen.state === "review" && !chosen.blockedReason && <p>This move needs review. Current files and the saved request are retained.</p>}
      {finished ? <p role="status">Recovery updated. Current files were kept.</p> : <>
        {chosen.retryAllowed && <><p>Retry the original saved move with the same request. Current text remains separate from this name change.</p><button disabled={busy || disabled} onClick={() => void resolve(false)}>Retry saved move</button></>}
        {chosen.keepNamesAllowed && <><p>The server rejected this saved move. Keep the current names and stop automatic retries of this request. Further recovery may still be needed.</p><button disabled={busy || disabled} onClick={() => void resolve(true)}>Keep current names</button></>}
      </>}
    </div>}
  </section>;
}
