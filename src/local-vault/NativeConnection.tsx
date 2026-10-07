import { useEffect, useState } from "react";
import { vaultRequest } from "./bridge";

type Connection = { connected: boolean; available: boolean; webURL?: string; message?: string; hasConflicts?: boolean; requiresRebind?: boolean };

/** Connection chrome is event driven. Successful background saves stay quiet. */
export function NativeConnection({ root }: { root: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [confirmRebind, setConfirmRebind] = useState(false);
  useEffect(() => {
    let active = true;
    const update = (event: Event) => {
      const next = (event as CustomEvent<Connection>).detail;
      if (next && typeof next.connected === "boolean" && typeof next.available === "boolean") {
        setConnection(next); setFailure("");
      }
    };
    window.addEventListener("texttext:vault-sync-status", update);
    void vaultRequest<Connection>("connection").then((next) => {
      if (active) setConnection(next);
    }).catch((error: Error) => { if (active) setFailure(error.message); });
    return () => { active = false; window.removeEventListener("texttext:vault-sync-status", update); };
  }, [root]);
  const perform = async (method: "connect" | "sync" | "openWeb" | "signIn" | "recovery", allowRebind = false) => {
    setBusy(true); setFailure("");
    try {
      const next = await vaultRequest<Connection>(method, allowRebind ? { allowRebind: true } : {});
      if (method !== "openWeb" && typeof next?.connected === "boolean") setConnection(next);
      if (method === "connect" && next?.connected) setConfirmRebind(false);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The web connection could not be opened."); }
    finally { setBusy(false); }
  };
  const message = failure || connection?.message;
  return <section className="vault-connection" aria-label="Web connection">
    {connection?.available && <p role="status">Signed in to TextText</p>}
    {connection?.connected ? <button disabled={busy || !connection.webURL} onClick={() => void perform("openWeb")}>Open on web</button>
      : connection && !connection.available
        ? <button disabled={busy} onClick={() => void perform("signIn")}>Sign in</button>
        : <button disabled={busy || !connection} onClick={() => connection?.requiresRebind ? setConfirmRebind(true) : void perform("connect")}>{busy ? "Connecting…" : "Connect to web"}</button>}
    {connection && !connection.connected && connection.available &&
      <button disabled={busy} onClick={() => void perform("signIn")}>Switch account</button>}
    {!connection?.connected && connection && !connection.available && !message && <p>Sign in to TextText to connect this folder.</p>}
    {connection?.hasConflicts && <button disabled={busy} onClick={() => void perform("recovery")}>View recovery copies</button>}
    {confirmRebind && <div role="group" aria-label="Confirm web connection">
      <p>This folder has history from another server. Connecting it to this account saves that history for recovery and keeps your files here.</p>
      <button disabled={busy} onClick={() => void perform("connect", true)}>Connect this folder</button>
      <button disabled={busy} onClick={() => setConfirmRebind(false)}>Cancel</button>
    </div>}
    {message && <div role="status"><p>{message}</p>{connection?.connected && <button disabled={busy} onClick={() => void perform("sync")}>Retry connection</button>}</div>}
  </section>;
}
