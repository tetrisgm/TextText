"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { vaultRequest } from "./bridge";

export type VaultShareScope = {
  workspaceId: string;
  scopeType: "item" | "folder";
  scopeKey: string;
  label: string;
};

type Grant = { id: string; email: string; role: "viewer" | "commenter" | "editor"; createdAt: string };

async function requestGrants(scope: VaultShareScope, method: "GET" | "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>): Promise<Grant[]> {
  const operation = { GET: "shareList", POST: "shareInvite", PATCH: "shareRole", DELETE: "shareRevoke" }[method];
  const payload = await vaultRequest<{ grants?: Grant[] }>(operation, {
    scopeType: scope.scopeType, scopeKey: scope.scopeKey, ...body,
  });
  if (!Array.isArray(payload.grants)) throw new Error("The access list could not be read.");
  return payload.grants;
}

export function VaultShareDialog({ scope, onClose }: { scope: VaultShareScope; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Grant["role"]>("viewer");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  useDialogFocus(dialog, true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setGrants(await requestGrants(scope, "GET")); setLoaded(true); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read access."); }
    finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const mutate = async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { setGrants(await requestGrants(scope, method, body)); setLoaded(true); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update access."); return false; }
    finally { setBusy(false); }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    void mutate("POST", { email: email.trim(), role }).then((saved) => { if (saved) setEmail(""); });
  };
  return <div className="vault-sharing-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="vault-sharing-dialog" role="dialog" aria-modal="true" aria-label={`Share ${scope.label}`}>
      <header><div><p className="vault-eyebrow">{scope.scopeType === "folder" ? "Folder access" : "File access"}</p><h2>Share {scope.label}</h2></div><button type="button" aria-label="Close sharing" onClick={onClose}>Close</button></header>
      <p className="vault-sharing-intro">Add access by email. They can find this {scope.scopeType === "folder" ? "folder and its files" : "file"} in Shared with me after signing in. TextText does not send an invitation email.</p>
      <form onSubmit={invite} className="vault-sharing-invite">
        <label>Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <label>Access<select value={role} onChange={(event) => setRole(event.target.value as Grant["role"])}><option value="viewer">Can view</option><option value="commenter">Can comment</option><option value="editor">Can edit</option></select></label>
        <button type="submit" disabled={busy || !loaded || !email.trim()}>Add access</button>
      </form>
      <h3>People with access</h3>
      {loading ? <p role="status">Loading access…</p> : !loaded ? null : grants.length ? <ul className="vault-sharing-list">{grants.map((grant) => <li key={grant.id}>
        <span>{grant.email}</span>
        <select aria-label={`Access for ${grant.email}`} disabled={busy} value={grant.role} onChange={(event) => void mutate("PATCH", { grantId: grant.id, role: event.target.value })}><option value="viewer">Can view</option><option value="commenter">Can comment</option><option value="editor">Can edit</option></select>
        {confirmRemove === grant.id ? <span className="vault-sharing-remove"><button disabled={busy} onClick={() => { setConfirmRemove(null); void mutate("DELETE", { grantId: grant.id }); }}>Remove access</button><button onClick={() => setConfirmRemove(null)}>Cancel</button></span> : <button disabled={busy} onClick={() => setConfirmRemove(grant.id)}>Remove</button>}
      </li>)}</ul> : <p>No one has been invited to this {scope.scopeType}.</p>}
      {error && <p role="alert" className="vault-sharing-error">{error} <button onClick={() => void reload()}>Retry</button></p>}
    </section>
  </div>;
}
