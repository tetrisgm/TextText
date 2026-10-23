import { useEffect, useRef, useState } from "react";
import { captureVaultRequest, vaultRequest } from "./bridge";

export type PathCollisionEntry = {
  localItemId: string; remoteItemId: string; sourcePath: string;
  localOperationId: string; remoteOperationId: string; state: string; resolutionId: string | null;
};
type PathCollisionReview = {
  inspection: string; localItemId: string; remoteItemId: string; sourcePath: string;
  destinationPath: string; localHash: string; remoteRevision: string;
  localOperationId: string; remoteOperationId: string;
};
type Reviewed = { review: PathCollisionReview; operationId: string };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const path = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value) && value.split("/").every(part => !!part && part !== "." && part !== "..");
function entry(value: unknown): PathCollisionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
  const row = value as Record<string, unknown>;
  if (!uuid(row.localItemId) || !uuid(row.remoteItemId) || row.localItemId === row.remoteItemId || !path(row.sourcePath) ||
      !uuid(row.localOperationId) || !uuid(row.remoteOperationId) || !["review", "prepared"].includes(row.state as string) ||
      (row.state === "review" && row.resolutionId !== null) || (row.state === "prepared" && !uuid(row.resolutionId))) throw Error();
  return row as PathCollisionEntry;
}
function review(value: unknown, expected: PathCollisionEntry): PathCollisionReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
  const row = value as Record<string, unknown>;
  if (!hash(row.inspection) || !hash(row.localHash) || typeof row.remoteRevision !== "string" || row.remoteRevision.length < 1 || row.remoteRevision.length > 256 || !path(row.destinationPath) ||
      row.destinationPath === expected.sourcePath || row.localItemId !== expected.localItemId ||
      row.remoteItemId !== expected.remoteItemId || row.sourcePath !== expected.sourcePath ||
      row.localOperationId !== expected.localOperationId || row.remoteOperationId !== expected.remoteOperationId) throw Error();
  return row as PathCollisionReview;
}

export function PathCollisionRecovery({ entries, workspaceRoot, disabled, onResolved }: {
  entries: PathCollisionEntry[]; workspaceRoot: string; disabled: boolean; onResolved: () => void;
}) {
  const [request] = useState(() => (window as unknown as { webkit?: { messageHandlers?: { localVault?: unknown } } }).webkit?.messageHandlers?.localVault ? vaultRequest : captureVaultRequest());
  const [chosen, setChosen] = useState<Reviewed | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [finished, setFinished] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => { setChosen(null); setError(""); setFinished(false); return () => { ++sequence.current; controller.current?.abort(); }; }, [workspaceRoot]);
  let rows: PathCollisionEntry[] = [], invalid = false;
  try {
    if (!Array.isArray(entries) || entries.length > 100) throw Error();
    rows = entries.map(entry);
    if (new Set(rows.map(row => `${row.localItemId}:${row.remoteItemId}`)).size !== rows.length) throw Error();
  } catch { invalid = true; }
  const inspect = async (row: PathCollisionEntry) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const captured = ++sequence.current;
    setChosen(null); setBusy(true); setError(""); setFinished(false);
    try {
      const result = review(await request("pathCollisionInspect", { workspaceRoot, localItemId: row.localItemId, remoteItemId: row.remoteItemId }, abort.signal), row);
      if (captured === sequence.current && !abort.signal.aborted) setChosen({ review: result, operationId: row.resolutionId ?? crypto.randomUUID() });
    } catch { if (captured === sequence.current && !abort.signal.aborted) setError("The two notes could not be inspected. Reopen Recovery and try again."); }
    finally { if (captured === sequence.current && !abort.signal.aborted) setBusy(false); }
  };
  const keepBoth = async () => {
    if (!chosen || busy || disabled || finished) return;
    const captured = sequence.current, abort = controller.current;
    if (!abort || abort.signal.aborted) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ operationId: string; state: string; localItemId: string; remoteItemId: string; localPath: string; remotePath: string }>(
        "pathCollisionKeepBoth", { workspaceRoot, ...chosen.review, operationId: chosen.operationId, consent: true }, abort.signal);
      if (captured !== sequence.current || abort.signal.aborted) return;
      if (!result || result.state !== "completed" || result.operationId !== chosen.operationId || result.localItemId !== chosen.review.localItemId ||
          result.remoteItemId !== chosen.review.remoteItemId || result.localPath !== chosen.review.destinationPath ||
          result.remotePath !== chosen.review.sourcePath) throw Error();
      setFinished(true); onResolved();
    } catch { if (captured === sequence.current && !abort.signal.aborted) setError("The notes may have changed. Retry this saved action or inspect them again."); }
    finally { if (captured === sequence.current && !abort.signal.aborted) setBusy(false); }
  };
  return <section className="vault-replacement-recovery" aria-label="Notes at the same path"><h3>Notes at the same path</h3>
    <p>Two different notes claim the same file name. Their saved content is retained. Inspect both identities, then keep the local note under a unique name so the shared note can open.</p>
    {invalid && <p role="alert">These path collisions could not be verified. Reopen Recovery.</p>}
    <nav aria-label="Path collisions">{rows.map(row => <button key={`${row.localItemId}:${row.remoteItemId}`} disabled={busy || disabled} onClick={() => void inspect(row)}>{row.sourcePath}</button>)}</nav>
    {busy && <p role="status">Checking both notes…</p>}{error && <p role="alert">{error}</p>}
    {chosen && <div><dl>
      <div><dt>Current file name</dt><dd>{chosen.review.sourcePath}</dd></div>
      <div><dt>Unique local file name</dt><dd>{chosen.review.destinationPath}</dd></div>
      <div><dt>Local note identity</dt><dd>{chosen.review.localItemId}</dd></div>
      <div><dt>Shared note identity</dt><dd>{chosen.review.remoteItemId}</dd></div>
    </dl><p>The local note keeps its content and identity at the unique name. The shared note keeps its original name and identity. Sync will resume after the recovery is saved.</p>
      {finished ? <p role="status">The local recovery was saved. Sync is queued for both notes.</p> : <button disabled={busy || disabled} onClick={() => void keepBoth()}>Keep both notes</button>}
    </div>}
  </section>;
}
