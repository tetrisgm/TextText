import { useEffect, useRef, useState } from "react";
import { captureVaultRequest, vaultRequest } from "./bridge";
import type { FolderRenameEndpoint } from "./FolderRenameRecovery";

type Item = { itemId: string; relativePath: string; revision: string };
type Command = { operationId: string; source: string; destination: string; baseManifestRevision: string; folders: string[]; items: Item[] };
type Receipt = { operationId: string; status: "moved"; source: string; destination: string; folders: string[]; items: Item[]; manifestRevision: string };
export type FolderSyncMoveRecoveryEntry = {
  id: string; command: Command; state: "unavailable" | "review" | "completed" | "cancelled";
  requestHash: string | null; expectedIdentity: string; from: FolderRenameEndpoint; to: FolderRenameEndpoint;
  localInspection: string; inspection: string | null; manifestRevision: string | null;
  folders: string[] | null; items: Item[] | null; result: Receipt | null; resolutionBlocked: string | null;
};
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const relative = (v: unknown): v is string => text(v) && !v.includes("\\") && v.split("/").every(p => p !== "" && p !== "." && p !== "..");
function object(v: unknown, keys: string[]): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
}
function endpoint(v: unknown): v is FolderRenameEndpoint {
  return object(v, ["present", "identity"]) && typeof v.present === "boolean" && (v.present ? v.identity === null || text(v.identity, 256) : v.identity === null);
}
function folders(v: unknown): v is string[] { return Array.isArray(v) && v.length <= 20_000 && v.every(relative) && new Set(v).size === v.length; }
function items(v: unknown): v is Item[] {
  return Array.isArray(v) && v.length <= 40_000 && v.every(i => object(i, ["itemId", "relativePath", "revision"]) && text(i.itemId, 256) && relative(i.relativePath) && digest(i.revision)) && new Set(v.map(i => i.itemId)).size === v.length;
}
function command(v: unknown): v is Command {
  if (!object(v, ["operationId", "source", "destination", "baseManifestRevision", "folders", "items"]) || !text(v.operationId, 128) || !relative(v.source) || !relative(v.destination) || !digest(v.baseManifestRevision) || !folders(v.folders) || !items(v.items)) return false;
  const parent = (s: string) => s.includes("/") ? s.slice(0, s.lastIndexOf("/")) : "";
  return v.source !== v.destination && parent(v.source) === parent(v.destination) && v.source.normalize("NFC").toLowerCase() === v.destination.normalize("NFC").toLowerCase() && v.folders.includes(v.source) && v.folders.every(p => p === v.source || p.startsWith(v.source + "/")) && v.items.every(i => i.relativePath.startsWith(v.source + "/"));
}
const itemKey = (rows: Item[]) => rows.map(i => [i.itemId, i.relativePath, i.revision]).sort((a,b) => a[0].localeCompare(b[0]));
const commandKey = (c: Command) => JSON.stringify([c.operationId,c.source,c.destination,c.baseManifestRevision,[...c.folders].sort(),itemKey(c.items)]);
function receipt(v: unknown, c: Command): v is Receipt {
  if (!object(v, ["operationId", "status", "source", "destination", "folders", "items", "manifestRevision"]) || v.operationId !== c.operationId || v.status !== "moved" || v.source !== c.source || v.destination !== c.destination || !digest(v.manifestRevision) || !folders(v.folders) || !items(v.items)) return false;
  const rebase = (p: string) => c.destination + p.slice(c.source.length);
  return JSON.stringify([...v.folders].sort()) === JSON.stringify(c.folders.map(rebase).sort()) && JSON.stringify(itemKey(v.items)) === JSON.stringify(itemKey(c.items.map(i => ({itemId:i.itemId,relativePath:rebase(i.relativePath),revision:i.revision}))));
}
export function validateFolderSyncMoveRecovery(v: unknown): FolderSyncMoveRecoveryEntry {
  const fail = () => { throw Error("This saved folder change could not be verified. Reopen Recovery before continuing."); };
  if (!object(v, ["id", "command", "state", "requestHash", "expectedIdentity", "from", "to", "localInspection", "inspection", "manifestRevision", "folders", "items", "result", "resolutionBlocked"]) || !command(v.command) || v.id !== v.command.operationId || !text(v.expectedIdentity, 256) || !endpoint(v.from) || !endpoint(v.to) || !digest(v.localInspection) || (v.resolutionBlocked !== null && !text(v.resolutionBlocked)) || ((v.from.present && v.from.identity === null || v.to.present && v.to.identity === null) && !v.resolutionBlocked)) return fail();
  if (v.state === "unavailable") { if (v.requestHash !== null || v.inspection !== null || v.manifestRevision !== null || v.folders !== null || v.items !== null || v.result !== null || !v.resolutionBlocked) return fail(); }
  else {
    if (!digest(v.requestHash)) return fail();
    if (v.state === "review") { if (!digest(v.inspection) || !digest(v.manifestRevision) || !folders(v.folders) || !items(v.items) || v.result !== null) return fail(); }
    else if (v.state === "completed") { if (v.inspection !== null || v.manifestRevision !== null || v.folders !== null || v.items !== null || !receipt(v.result, v.command)) return fail(); }
    else if (v.state === "cancelled") { if (!digest(v.inspection) || !digest(v.manifestRevision) || v.folders !== null || v.items !== null || v.result !== null) return fail(); }
    else return fail();
  }
  return v as FolderSyncMoveRecoveryEntry;
}

export function FolderSyncMoveRecovery({ entries, workspaceRoot, disabled, onResolved }: { entries: FolderSyncMoveRecoveryEntry[]; workspaceRoot: string; disabled: boolean; onResolved: () => void }) {
  const [request] = useState(() => (window as unknown as { webkit?: { messageHandlers?: { localVault?: unknown } } }).webkit?.messageHandlers?.localVault ? vaultRequest : captureVaultRequest());
  const [chosen, setChosen] = useState<FolderSyncMoveRecoveryEntry | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [resolved, setResolved] = useState(false);
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setChosen(null); setResolved(false); setBusy(false); setError("");
    return () => { ++generation.current; controller.current?.abort(); };
  }, [workspaceRoot]);
  let visible: FolderSyncMoveRecoveryEntry[] = [], invalid = false;
  try { if (!Array.isArray(entries) || entries.length > 100) throw Error(); visible = entries.map(validateFolderSyncMoveRecovery); if (new Set(visible.map(e => e.id)).size !== visible.length) throw Error(); } catch { invalid = true; visible = []; }
  const inspect = async (entry: FolderSyncMoveRecoveryEntry) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const captured = ++generation.current;
    setChosen(null); setResolved(false); setBusy(true); setError("");
    try {
      const next = validateFolderSyncMoveRecovery(await request("folderSyncMoveRead", {workspaceRoot,id:entry.id}, abort.signal));
      if (next.id !== entry.id || commandKey(next.command) !== commandKey(entry.command) || next.expectedIdentity !== entry.expectedIdentity) throw Error("This is a different folder change. Reopen Recovery to continue.");
      if (generation.current === captured && !abort.signal.aborted) setChosen(next);
    } catch (cause) { if (generation.current === captured && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "The saved folder change could not be inspected."); }
    finally { if (generation.current === captured && !abort.signal.aborted) setBusy(false); }
  };
  const resolve = async () => {
    if (!chosen || chosen.state === "unavailable" || chosen.resolutionBlocked || busy || disabled || resolved) return;
    const entry = chosen, captured = generation.current, abort = controller.current!; setBusy(true); setError("");
    try {
      const result = await request<{resolved:boolean}>("resolveFolderSyncMove", {workspaceRoot,id:entry.id,requestHash:entry.requestHash,inspection:entry.inspection,localInspection:entry.localInspection,consent:true}, abort.signal);
      if (generation.current !== captured || abort.signal.aborted) return;
      if (result.resolved !== true) throw Error("The folder change needs another inspection.");
      setResolved(true); onResolved();
    } catch (cause) { if (generation.current === captured && !abort.signal.aborted) { setChosen(null); setError(cause instanceof Error ? cause.message : "The saved folder change could not be resolved."); } }
    finally { if (generation.current === captured && !abort.signal.aborted) setBusy(false); }
  };
  return <section className="vault-replacement-recovery" aria-label="Saved folder changes"><h3>Saved folder changes</h3>
    <p>A folder name changed before synchronization finished. Inspect its local paths and the server result before continuing.</p>
    <nav aria-label="Saved folder changes">{visible.map(e => <button key={e.id} disabled={busy || disabled} onClick={() => void inspect(e)}>{e.command.source} → {e.command.destination}</button>)}</nav>
    {invalid && <p role="alert">These saved folder changes could not be verified. Update TextText or reopen Recovery.</p>}{busy && <p role="status">Checking the saved folder change…</p>}{error && <p role="alert">{error}</p>}
    {chosen && <div><dl>{([["Original path", chosen.command.source, chosen.from],["Requested path",chosen.command.destination,chosen.to]] as const).map(([label,path,location]) => <div key={label}><dt>{label}</dt><dd>{path}: {location.present ? location.identity === null ? "This path could not be verified." : location.identity === chosen.expectedIdentity ? "Original folder is here." : "A different item is here." : "No item at this path."}</dd></div>)}</dl>
      {chosen.state === "review" && <><p>The server has not applied this folder change. Cancelling it keeps all current files. Restore the original local folder spelling before resuming synchronization.</p><p>Current server catalog: {chosen.folders!.length} {chosen.folders!.length === 1 ? "folder" : "folders"} and {chosen.items!.length} {chosen.items!.length === 1 ? "file" : "files"}.</p><details><summary>Inspect current server paths</summary><pre className="vault-recovery-text">{[...chosen.folders!,...chosen.items!.map(i => i.relativePath)].slice(0,200).join("\n")}</pre>{chosen.folders!.length + chosen.items!.length > 200 && <p>Showing the first 200 paths. Confirmation also checks the complete catalog.</p>}</details></>}
      {chosen.state === "completed" && <p>The server finished this folder change. Finish applying its saved result locally.</p>}
      {chosen.state === "cancelled" && <p>This pending folder change was cancelled. Keep the cancellation receipt locally, then restore the original local folder spelling before resuming synchronization.</p>}
      {chosen.resolutionBlocked && <p role="status">{chosen.resolutionBlocked}</p>}
      {resolved ? <p role="status">Folder recovery finished. All current files were kept.</p> : chosen.state !== "unavailable" && <button disabled={busy || disabled || Boolean(chosen.resolutionBlocked)} onClick={() => void resolve()}>{chosen.state === "review" ? "Cancel pending folder change" : chosen.state === "completed" ? "Finish saved folder change" : "Keep cancellation receipt"}</button>}
    </div>}
  </section>;
}
