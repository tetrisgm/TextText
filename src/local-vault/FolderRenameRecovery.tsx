import { useEffect, useRef, useState } from "react";
import { captureVaultRequest, vaultRequest } from "./bridge";

export type FolderRenameEndpoint = { present: boolean; identity: string | null };
export type FolderRenameRecoveryEntry = {
  id: string; fromPath: string; toPath: string; expectedIdentity: string;
  from: FolderRenameEndpoint; to: FolderRenameEndpoint; inspection: string;
  summary: string; resolutionBlocked: string | null; resolved: boolean;
};
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const relative = (value: unknown): value is string => text(value, 4096) && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
function endpoint(value: unknown): value is FolderRenameEndpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as FolderRenameEndpoint;
  return Object.keys(v).length === 2 && Object.hasOwn(v, "present") && Object.hasOwn(v, "identity") && typeof v.present === "boolean" && (v.present ? v.identity === null || text(v.identity, 256) : v.identity === null);
}
export function validateFolderRenameRecovery(value: unknown): FolderRenameRecoveryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("This folder recovery record needs a newer TextText version.");
  const v = value as FolderRenameRecoveryEntry;
  const keys = ["id", "fromPath", "toPath", "expectedIdentity", "from", "to", "inspection", "summary", "resolutionBlocked", "resolved"];
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key)) || !text(v.id, 128) || !relative(v.fromPath) || !relative(v.toPath) || v.fromPath === v.toPath ||
      !text(v.expectedIdentity, 256) || !endpoint(v.from) || !endpoint(v.to) || typeof v.inspection !== "string" || !/^[a-f0-9]{64}$/.test(v.inspection) ||
      ((v.from.present && v.from.identity === null || v.to.present && v.to.identity === null) && !v.resolutionBlocked) ||
      typeof v.summary !== "string" || v.summary.length > 65_536 || (v.resolutionBlocked !== null && !text(v.resolutionBlocked, 4096)) || typeof v.resolved !== "boolean") {
    throw Error("This folder recovery record could not be verified. Reopen Recovery before continuing.");
  }
  return v;
}

/** Only metadata consent. This view never moves, restores or deletes files. */
export function FolderRenameRecovery({ entries, workspaceRoot, disabled, onResolved }: {
  entries: FolderRenameRecoveryEntry[]; workspaceRoot: string; disabled: boolean; onResolved?: () => void;
}) {
  const [request] = useState(() => (window as unknown as { webkit?: { messageHandlers?: { localVault?: unknown } } }).webkit?.messageHandlers?.localVault ? vaultRequest : captureVaultRequest());
  const [chosen, setChosen] = useState<FolderRenameRecoveryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { ++generation.current; controller.current?.abort(); }, []);
  let visible: FolderRenameRecoveryEntry[] = [], invalidList = false;
  try {
    if (!Array.isArray(entries) || entries.length > 40_000) throw Error("Invalid recovery inventory");
    visible = entries.map(validateFolderRenameRecovery);
    if (new Set(visible.map(entry => entry.id)).size !== visible.length) throw Error("Ambiguous recovery inventory");
  } catch { invalidList = true; visible = []; }
  const inspect = async (entry: FolderRenameRecoveryEntry) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const captured = ++generation.current;
    setChosen(null); setBusy(true); setError("");
    try {
      validateFolderRenameRecovery(entry);
      const next = validateFolderRenameRecovery(await request<unknown>("folderRenameRead", { workspaceRoot, id: entry.id }, abort.signal));
      if (next.id !== entry.id || next.fromPath !== entry.fromPath || next.toPath !== entry.toPath || next.expectedIdentity !== entry.expectedIdentity) throw Error("This folder change no longer matches the inspected operation. Reopen Recovery to continue.");
      if (generation.current === captured && !abort.signal.aborted) setChosen(next);
    } catch (cause) { if (generation.current === captured && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "The folders could not be inspected."); }
    finally { if (generation.current === captured && !abort.signal.aborted) setBusy(false); }
  };
  const keep = async () => {
    if (!chosen || chosen.resolved || chosen.resolutionBlocked || busy || disabled) return;
    const captured = generation.current, entry = chosen, abort = controller.current!;
    setBusy(true); setError("");
    try {
      const result = await request<{ resolved: boolean }>("resolveFolderRename", { workspaceRoot, id: entry.id, fromPath: entry.fromPath, toPath: entry.toPath, inspection: entry.inspection }, abort.signal);
      if (generation.current !== captured || abort.signal.aborted) return;
      if (result.resolved !== true) throw Error("The folders changed. Inspect them again before continuing.");
      setChosen({ ...entry, resolved: true }); onResolved?.();
    } catch (cause) { if (generation.current === captured && !abort.signal.aborted) { setChosen(null); setError(cause instanceof Error ? cause.message : "The folder change could not be confirmed."); } }
    finally { if (generation.current === captured && !abort.signal.aborted) setBusy(false); }
  };
  return <section className="vault-replacement-recovery" aria-label="Interrupted folder names">
    <h3>Interrupted folder names</h3>
    <p>A folder changed while its name was being updated. Check both paths before continuing. Keeping the current paths will not move or delete their files.</p>
    <nav aria-label="Folder name changes">{visible.map(entry => <button key={entry.id} disabled={busy || disabled} aria-pressed={chosen?.id === entry.id} onClick={() => void inspect(entry)}>{entry.fromPath} → {entry.toPath}</button>)}</nav>
    {busy && <p role="status">Checking folder paths…</p>}
    {invalidList && <p role="alert">These folder recovery records could not be verified. Update TextText or reopen Recovery before continuing.</p>}
    {error && <p role="alert">{error}</p>}
    {chosen && <div>
      <dl>{([['Original path', chosen.fromPath, chosen.from], ['Requested path', chosen.toPath, chosen.to]] as const).map(([label, path, location]) => <div key={label}><dt>{label}</dt><dd>{path}: {location.present ? location.identity === null ? "This path could not be verified." : location.identity === chosen.expectedIdentity ? "Original folder is here." : "A different item is here." : "No item at this path."}</dd></div>)}</dl>
      <pre className="vault-recovery-text">{chosen.summary || "No entries at either path."}</pre>
      {chosen.resolutionBlocked && <p role="status">{chosen.resolutionBlocked}</p>}
      {chosen.resolved ? <p role="status">Folder recovery finished. Retained details remain available.</p> : <button disabled={busy || disabled || Boolean(chosen.resolutionBlocked)} onClick={() => void keep()}>Keep current folder paths</button>}
    </div>}
  </section>;
}
