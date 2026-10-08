"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { vaultRequest } from "./bridge";
import styles from "./AccountMenu.module.css";
import { accountManagementURL } from "./account-management";

type WorkspaceList = { currentId: string; workspaces: { id: string; name: string; access: "owner" | "workspace" | "scoped" }[] };

type AccountProfile = { accountId?: string; email: string | null; name: string | null; identities: string[]; workspaceName: string };
const providerLabels: Record<string, string> = { apple: "Apple", google: "Google", github: "GitHub", email: "Email link", openai: "ChatGPT" };

/** Shared account identity and settings for all file-workspace clients. */
export function AccountMenu({ signedIn, initialIdentity, profileKey, accountSite, actions, aiSettings, logOut, signIn }: {
  signedIn: boolean | null;
  initialIdentity?: string | null;
  profileKey?: string;
  accountSite?: string;
  actions?: ReactNode;
  aiSettings?: ReactNode;
  logOut: () => Promise<void>;
  signIn?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceList | null>(null);
  const [workspaceFailure, setWorkspaceFailure] = useState(false);
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [profileFailure, setProfileFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const focusAi = useRef(false);
  const menuId = useId();
  const headingId = useId();
  const identity = profile?.email || profile?.name || initialIdentity || "TextText account";
  const manageURL = profile?.accountId && typeof window !== "undefined"
    ? accountManagementURL(accountSite ?? window.location.href, profile.accountId) : null;
  const initial = Array.from(identity).find(character => /\p{L}|\p{N}/u.test(character))?.toUpperCase() || "T";

  useEffect(() => {
    if (!signedIn) { setProfile(null); return; }
    const controller = new AbortController();
    setProfile(null);
    setProfileFailure(false);
    void vaultRequest<AccountProfile>("accountRead", {}, controller.signal).then(value => {
      if (!controller.signal.aborted) setProfile(value);
    }).catch(() => { if (!controller.signal.aborted) setProfileFailure(true); });
    return () => controller.abort();
  }, [signedIn, profileKey, attempt]);

  useEffect(() => {
    if (!open || !signedIn) return;
    const controller = new AbortController();
    setWorkspaces(null); setWorkspaceFailure(false);
    void vaultRequest<WorkspaceList>("workspacesList", {}, controller.signal).then(value => {
      if (!controller.signal.aborted) setWorkspaces(value);
    }).catch(() => { if (!controller.signal.aborted) setWorkspaceFailure(true); });
    return () => controller.abort();
  }, [open, signedIn, profileKey, workspaceAttempt]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  useEffect(() => {
    if (!settings) return;
    dialog.current?.showModal();
    if (focusAi.current) { dialog.current?.querySelector<HTMLElement>("[data-ai-settings] h3")?.focus(); focusAi.current = false; }
    return () => { dialog.current?.close(); toggle.current?.focus(); };
  }, [settings]);

  useEffect(() => {
    if (!aiSettings || !signedIn) return;
    const showAi = () => { focusAi.current = true; setOpen(false); setSettings(true); };
    window.addEventListener("texttext:open-ai-settings", showAi);
    return () => window.removeEventListener("texttext:open-ai-settings", showAi);
  }, [aiSettings, signedIn]);

  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setFailure("");
    try { await action(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };

  return <section ref={container} className="vault-connection" aria-label="TextText account">
    <button ref={toggle} type="button" className="vault-account-toggle" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}>
      <span className="vault-account-avatar" aria-hidden="true">{initial}</span>
      <span className="vault-account-label"><strong title={identity}>{identity}</strong><small>{signedIn === null ? "Checking…" : signedIn ? "Signed in" : "Sign in"}</small></span>
      <span className="vault-account-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div id={menuId} className="vault-account-menu">
      {signedIn ? <>
        <div className={styles.workspaces} role="group" aria-label="Workspaces">
          <span className={styles.muted}>Workspaces</span>
          {workspaces?.workspaces.map(workspace => <button key={workspace.id} type="button" disabled={busy || workspace.id === workspaces.currentId}
            aria-current={workspace.id === workspaces.currentId ? "true" : undefined}
            onClick={() => void perform(async () => {
              const flush = (window as Window & { texttextFlushForSignOut?: () => Promise<boolean> }).texttextFlushForSignOut;
              if (!flush || !await flush()) throw new Error("Finish saving your changes before opening another workspace.");
              await vaultRequest("workspaceOpen", { workspaceId: workspace.id });
            })}><span>{workspace.name}</span>{workspace.id === workspaces.currentId && <span aria-label="Current workspace">✓</span>}</button>)}
          {!workspaces && !workspaceFailure && <span role="status" className={styles.muted}>Loading workspaces…</span>}
          {workspaceFailure && <button type="button" onClick={() => setWorkspaceAttempt(value => value + 1)}>Try loading workspaces again</button>}
        </div>
        {actions}
        <button type="button" onClick={() => { setOpen(false); setSettings(true); if (profileFailure) setAttempt(value => value + 1); }}>Settings</button>
        <button type="button" disabled={busy} onClick={() => void perform(logOut)}>Log out</button>
      </> : signIn && <button type="button" disabled={busy || signedIn === null} onClick={() => void perform(signIn)}>Sign in to TextText</button>}
      {failure && <div className="vault-account-message" role="alert"><p>{failure}</p></div>}
    </div>}
    {settings && <dialog ref={dialog} className={styles.dialog} aria-labelledby={headingId}
      onCancel={event => { event.preventDefault(); setSettings(false); }}
      onClick={event => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setSettings(false); } }}>
      <header className={styles.header}><h2 id={headingId}>Settings</h2><button type="button" aria-label="Close settings" onClick={() => setSettings(false)}>Close</button></header>
      <section><h3>Account</h3><p>{identity}</p>{profile?.email && profile.name && profile.name !== profile.email && <p className={styles.muted}>{profile.name}</p>}</section>
      {profile ? <>
        <section><h3>Workspace</h3><p>{profile.workspaceName}</p></section>
        <section><h3>Ways to sign in</h3><ul className={styles.providers}>{profile.identities.filter(provider => providerLabels[provider]).map(provider => <li key={provider}><span>{providerLabels[provider]}</span><span className={styles.muted}>Connected</span></li>)}</ul>{profile.identities.length === 0 && <p className={styles.muted}>No sign-in methods to show.</p>}</section>
      </> : <p className={styles.muted} role="status">{profileFailure ? "Account details are unavailable right now." : "Loading account details…"}</p>}
      {aiSettings}
      {manageURL && <p><a href={manageURL} target="_blank" rel="noopener noreferrer">Manage sign-in methods</a></p>}
    </dialog>}
  </section>;
}
