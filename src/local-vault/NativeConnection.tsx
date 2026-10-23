import { useEffect, useState } from "react";
import { vaultRequest } from "./bridge";
import { AccountMenu } from "./AccountMenu";
import { nativeSyncNotice } from "./native-sync-notice";

type Connection = { workspaceId?: string; connected: boolean; available: boolean; connecting?: boolean; onlineReady?: boolean; authenticationRequired?: boolean; webURL?: string; message?: string; hasConflicts?: boolean };

/** Account actions for the open workspace. Sync runs automatically. */
export function NativeConnection({ root }: { root: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [connectionFailure, setConnectionFailure] = useState("");
  const [startupFailure, setStartupFailure] = useState("");

  useEffect(() => {
    let active = true, receivedStatus = false;
    setConnection(null); setFailure(""); setConnectionFailure(""); setStartupFailure("");
    const update = (event: Event) => {
      const next = (event as CustomEvent<Connection>).detail;
      if (active && next && typeof next.connected === "boolean" && typeof next.available === "boolean") {
        receivedStatus = true; setConnection(next); setConnectionFailure("");
      }
    };
    window.addEventListener("texttext:vault-sync-status", update);
    const startupFailed = () => { if (active) setStartupFailure("Initial sync could not start. Reopen the workspace to retry."); };
    window.addEventListener("texttext:initial-view-failed", startupFailed);
    void vaultRequest<Connection>("connection").then((next) => {
      if (active && !receivedStatus) { setConnection(next); setConnectionFailure(""); }
    }).catch((error: Error) => { if (active && !receivedStatus) setConnectionFailure(error.message); });
    return () => { active = false; window.removeEventListener("texttext:vault-sync-status", update); window.removeEventListener("texttext:initial-view-failed", startupFailed); };
  }, [root]);

  const perform = async (method: "openWeb" | "signIn" | "signOut" | "settings" | "recovery") => {
    setBusy(true); setFailure("");
    try {
      await vaultRequest(method);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const signedIn = connection?.available === true;
  const notice = nativeSyncNotice(connection);

  return <AccountMenu profileKey={`${root}:${connection?.workspaceId ?? ""}`} signedIn={connection ? signedIn : null}
    accountSite={connection?.webURL}
    logOut={() => vaultRequest<void>("signOut")} signIn={() => vaultRequest<void>("signIn")}
    actions={<>
      {notice && <div className="vault-account-message" role="status">
        <p>{notice.message}</p>
        {notice.folders && <ul>{notice.folders.map((folder, index) => <li key={index}>{folder}</li>)}</ul>}
        {notice.kind === "authentication" && <button type="button" disabled={busy} onClick={() => void perform("signIn")}>Sign in again</button>}
      </div>}
      {connection?.onlineReady && <button type="button" disabled={busy || !connection.webURL} onClick={() => void perform("openWeb")}>Open workspace on web</button>}
      {connection?.hasConflicts && <button type="button" disabled={busy} onClick={() => void perform("recovery")}>View recovery copies</button>}
      {connectionFailure && <div className="vault-account-message" role="alert"><p>{connectionFailure}</p></div>}
      {startupFailure && <div className="vault-account-message" role="alert"><p>{startupFailure}</p></div>}
      {failure && <div className="vault-account-message" role="alert"><p>{failure}</p></div>}
    </>} />;
}
