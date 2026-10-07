import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";

type Connection = { connected: boolean; available: boolean; connecting?: boolean; onlineReady?: boolean; webURL?: string; message?: string; hasConflicts?: boolean };

/** The open folder is the workspace; account and connection status share one profile menu. */
export function NativeConnection({ root }: { root: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
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
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  const perform = async (method: "openWeb" | "signIn" | "signOut" | "settings" | "recovery") => {
    setBusy(true); setFailure("");
    try {
      await vaultRequest(method);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const signedIn = connection?.available === true;
  const workspaceStatus = connection?.onlineReady ? "Available online" : connection?.connecting || connection?.connected && !connection?.message ? "Connecting…" : "Available on this Mac";

  return <section ref={container} className="vault-connection" aria-label="TextText account">
    <button type="button" className="vault-account-toggle" aria-expanded={open} aria-controls="vault-account-menu"
      onClick={() => setOpen((value) => !value)}>
      <span className="vault-account-avatar" aria-hidden="true">T</span>
      <span className="vault-account-label"><strong>TextText account</strong><small>{connection ? signedIn ? "Signed in" : "Sign in" : "Checking…"}</small></span>
      <span className="vault-account-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div id="vault-account-menu" className="vault-account-menu">
      {signedIn ? <>
        <div className="vault-account-sync-state"><span>Workspace</span><span>{workspaceStatus}</span></div>
        {connection?.onlineReady && <button type="button" disabled={busy || !connection.webURL} onClick={() => void perform("openWeb")}>Open workspace on web</button>}
        <button type="button" disabled={busy} onClick={() => void perform("settings")}>Settings</button>
        <button type="button" disabled={busy} onClick={() => void perform("signOut")}>Log out</button>
      </> : <button type="button" disabled={busy || !connection} onClick={() => void perform("signIn")}>Sign in to TextText</button>}
      {connection?.hasConflicts && <button type="button" disabled={busy} onClick={() => void perform("recovery")}>View recovery copies</button>}
      {(failure || connection?.message) && <div className="vault-account-message" role="status"><p>{failure || connection?.message}</p></div>}
    </div>}
  </section>;
}
