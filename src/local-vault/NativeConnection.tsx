import { useEffect, useState } from "react";
import { vaultRequest } from "./bridge";

type Connection = { connected: boolean; available: boolean; webURL?: string; message?: string; hasConflicts?: boolean };

/** Connection chrome is event driven. Successful background saves stay quiet. */
export function NativeConnection({ root }: { root: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
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
  const perform = async (method: "connect" | "sync" | "openWeb" | "signIn" | "recovery") => {
    setBusy(true); setFailure("");
    try {
      const next = await vaultRequest<Connection>(method);
      if (method !== "openWeb" && typeof next?.connected === "boolean") setConnection(next);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The web connection could not be opened."); }
    finally { setBusy(false); }
  };
  const message = failure || connection?.message;
  return <section className="vault-connection" aria-label="Web connection">
    {connection?.connected ? <button disabled={busy || !connection.webURL} onClick={() => void perform("openWeb")}>Open on web</button>
      : connection && !connection.available
        ? <button disabled={busy} onClick={() => void perform("signIn")}>Sign in</button>
        : <button disabled={busy || !connection} onClick={() => void perform("connect")}>{busy ? "Connecting…" : "Connect to web"}</button>}
    {connection && !connection.connected && connection.available &&
      <button disabled={busy} onClick={() => void perform("signIn")}>Sign in again</button>}
    {!connection?.connected && connection && !connection.available && !message && <p>Sign in to TextText to connect this folder.</p>}
    {connection?.hasConflicts && <button disabled={busy} onClick={() => void perform("recovery")}>View recovery copies</button>}
    {message && <div role="status"><p>{message}</p>{connection?.connected && <button disabled={busy} onClick={() => void perform("sync")}>Retry connection</button>}</div>}
  </section>;
}
