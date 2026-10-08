import { useEffect, useState } from "react";
import { vaultRequest } from "./bridge";
import { AccountMenu } from "./AccountMenu";

type Connection = { workspaceId?: string; connected: boolean; available: boolean; connecting?: boolean; onlineReady?: boolean; webURL?: string; message?: string; hasConflicts?: boolean };

/** Account actions for the open workspace. Sync runs automatically. */
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

  const perform = async (method: "openWeb" | "signIn" | "signOut" | "settings" | "recovery") => {
    setBusy(true); setFailure("");
    try {
      await vaultRequest(method);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const signedIn = connection?.available === true;

  return <AccountMenu profileKey={`${root}:${connection?.workspaceId ?? ""}`} signedIn={connection ? signedIn : null}
    logOut={() => vaultRequest<void>("signOut")} signIn={() => vaultRequest<void>("signIn")}
    actions={<>
      {connection?.onlineReady && <button type="button" disabled={busy || !connection.webURL} onClick={() => void perform("openWeb")}>Open workspace on web</button>}
      {connection?.hasConflicts && <button type="button" disabled={busy} onClick={() => void perform("recovery")}>View recovery copies</button>}
      {failure && <div className="vault-account-message" role="alert"><p>{failure}</p></div>}
    </>} />;
}
