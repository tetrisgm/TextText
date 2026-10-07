import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";

type Connection = { connected: boolean; available: boolean; webURL?: string; message?: string; hasConflicts?: boolean; requiresRebind?: boolean };

/** Account identity is always visible; optional sync controls stay in the profile menu. */
export function NativeConnection({ root }: { root: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [confirmRebind, setConfirmRebind] = useState(false);
  const container = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) { setOpen(false); setConfirmRebind(false); }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); setConfirmRebind(false); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  const perform = async (method: "connect" | "sync" | "openWeb" | "signIn" | "recovery", allowRebind = false) => {
    setBusy(true); setFailure("");
    try {
      const next = await vaultRequest<Connection>(method, allowRebind ? { allowRebind: true } : {});
      if (method !== "openWeb" && typeof next?.connected === "boolean") setConnection(next);
      if (method === "connect" && next?.connected) setConfirmRebind(false);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The web connection could not be opened."); }
    finally { setBusy(false); }
  };
  const signedIn = connection?.available === true;
  const message = failure || (!connection?.requiresRebind || connection?.connected ? connection?.message : "");

  return <section ref={container} className="vault-connection" aria-label="TextText account">
    <button type="button" className="vault-account-toggle" aria-expanded={open} aria-controls="vault-account-menu"
      onClick={() => setOpen((value) => !value)}>
      <span className="vault-account-avatar" aria-hidden="true">T</span>
      <span className="vault-account-label"><strong>TextText account</strong><small>{connection ? signedIn ? "Signed in" : "Sign in" : "Checking…"}</small></span>
      <span className="vault-account-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div id="vault-account-menu" className="vault-account-menu">
      {signedIn ? <>
        <div className="vault-account-sync-state"><span>Web sync</span><span>{connection?.connected ? "On" : "Off"}</span></div>
        {connection?.connected
          ? <button type="button" disabled={busy || !connection.webURL} onClick={() => void perform("openWeb")}>Open on web</button>
          : <button type="button" disabled={busy} onClick={() => connection?.requiresRebind ? setConfirmRebind(true) : void perform("connect")}>Set up web sync</button>}
        <button type="button" disabled={busy} onClick={() => void perform("signIn")}>Switch account</button>
      </> : <button type="button" disabled={busy || !connection} onClick={() => void perform("signIn")}>Sign in to TextText</button>}
      {connection?.hasConflicts && <button type="button" disabled={busy} onClick={() => void perform("recovery")}>View recovery copies</button>}
      {confirmRebind && <div className="vault-account-confirm" role="group" aria-label="Confirm web connection">
        <p>Connect this folder to your TextText account? Its previous sync history stays on this Mac, and your files stay in this folder.</p>
        <button type="button" disabled={busy} onClick={() => void perform("connect", true)}>Connect this folder</button>
        <button type="button" disabled={busy} onClick={() => setConfirmRebind(false)}>Cancel</button>
      </div>}
      {message && <div className="vault-account-message" role="status"><p>{message}</p>{connection?.connected && <button type="button" disabled={busy} onClick={() => void perform("sync")}>Retry connection</button>}</div>}
    </div>}
  </section>;
}
