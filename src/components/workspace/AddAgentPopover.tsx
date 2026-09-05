"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { createItemAgentAction, prepareLocalItemAgentAction, removeItemAgentAction, type listItemAgentsAction } from "@/app/editor/agent-connect-actions";
import { AGENT_CLIENTS, OPEN_ADD_AGENT_EVENT, agentClientConfiguration, localAgentSupported, remoteAgentInstruction, type AgentClient } from "@/lib/agent-connect";
import type { ParticipantMark } from "./participants";
import styles from "./ParticipantsRow.module.css";

export type ItemAgentGrant = Awaited<ReturnType<typeof listItemAgentsAction>>[number];
export function RemoveItemAgent({ grant, handle, postId, onRemoved }: {
  grant: ItemAgentGrant; handle: string; postId: string; onRemoved: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div>
    {!confirm ? <button type="button" className={styles.action} onClick={() => setConfirm(true)}>Remove agent</button> : <>
      <p>Remove {grant.name} from this item? This revokes this connection. Changes already made remain.</p>
      <button type="button" className={styles.action} disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await removeItemAgentAction(handle, postId, grant.id); onRemoved(grant.id); }
        catch { setError("Could not confirm removal. Refresh connections before retrying."); }
        finally { setBusy(false); }
      }}>{busy ? "Removing…" : "Confirm removal"}</button>{" "}
      <button type="button" className={styles.action} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function AddAgentPopover({ handle, postId, marks, grants, loadError, reload, onRemoved }: {
  handle: string; postId: string; marks: ParticipantMark[]; grants: ItemAgentGrant[]; loadError: boolean;
  reload: () => void; onRemoved: (id: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEscapeLayer(open, "Add agent", () => popover.current?.hidePopover());
  useEffect(() => {
    const show = (event: Event) => {
      if ((event as CustomEvent<{ postId: string }>).detail?.postId !== postId) return;
      trigger.current?.focus(); popover.current?.showPopover();
    };
    window.addEventListener(OPEN_ADD_AGENT_EVENT, show);
    return () => window.removeEventListener(OPEN_ADD_AGENT_EVENT, show);
  }, [postId]);
  useEffect(() => {
    if (!open) return;
    const close = () => popover.current?.hidePopover();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={styles.trigger} popoverTarget={id}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label="Add agent" title="Add agent">
      <span className={styles.mark} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></span>
    </button>
    <div ref={popover} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`}
      className={`${styles.popover} ${styles.connect}`} style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 8}px)` }}
      onBeforeToggle={(event) => {
        if (event.newState !== "open") return;
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) setPosition({ top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 480)), left: Math.max(8, Math.min(rect.right - 352, window.innerWidth - 360)) });
        reload();
      }}
      onToggle={(event) => {
        const next = event.newState === "open"; setOpen(next);
        if (next) popover.current?.querySelector<HTMLButtonElement>("button")?.focus();
        else trigger.current?.focus();
      }}>
      <div className={styles.header}><strong id={`${id}-title`}>Add agent</strong>
        <button autoFocus type="button" className={styles.close} aria-label="Close add agent" onClick={() => popover.current?.hidePopover()}>×</button></div>
      {open && <ConnectionForm handle={handle} postId={postId} marks={marks} reload={reload} />}
      {loadError && <div><p role="alert">Item connections could not be loaded.</p><button type="button" className={styles.action} onClick={reload}>Refresh connections</button></div>}
      {grants.length > 0 && <div className={styles.history}><strong>Item connections</strong>
        {grants.map((grant) => <section key={grant.id}>
          <p>{grant.name} · {grant.role === "edit" ? "Read and edit" : "Read-only"}</p>
          <p>{grant.expiresAt && `Expiry: ${new Date(grant.expiresAt).toLocaleDateString()}`}</p>
          <RemoveItemAgent grant={grant} handle={handle} postId={postId} onRemoved={(removedId) => { onRemoved(removedId); popover.current?.hidePopover(); }} />
        </section>)}
      </div>}
    </div>
  </>;
}

function ConnectionForm({ handle, postId, marks, reload }: { handle: string; postId: string; marks: ParticipantMark[]; reload: () => void }) {
  const id = useId();
  const active = useRef(true);
  const [client, setClient] = useState<AgentClient>("Claude Code");
  const [path, setPath] = useState<"local" | "remote">("local");
  const [role, setRole] = useState<"edit" | "read">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setup, setSetup] = useState<{ presenceId: string; instruction: string; token?: string; id?: string; expiresAt?: string } | null>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const present = Boolean(setup && marks.some((mark) => mark.agent && mark.id === setup.presenceId));
  useEffect(() => { if (present) queueMicrotask(() => { if (active.current) setVerified(true); }); }, [present]);
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setNotice(`${label} copied`); }
    catch { setError("Clipboard unavailable. Select the text and copy it manually."); }
  };
  const config = setup?.id ? agentClientConfiguration(client, setup.id, window.location.origin) : null;
  const unsupported = client === "Claude Desktop" || (path === "local" && !localAgentSupported(client));
  return <>
    <label className={styles.field} htmlFor={`${id}-client`}>Client
      <select id={`${id}-client`} value={client} disabled={busy || !!setup} onChange={(event) => { const next = event.target.value as AgentClient; setClient(next); if (!localAgentSupported(next)) setPath("remote"); }}>
        {AGENT_CLIENTS.map((name) => <option key={name}>{name}</option>)}
      </select>
    </label>
    <label className={styles.field} htmlFor={`${id}-path`}>Connection
      <select id={`${id}-path`} value={path} disabled={busy || !!setup} onChange={(event) => setPath(event.target.value as "local" | "remote")}>
        <option value="local" disabled={!localAgentSupported(client)}>On this Mac</option><option value="remote">Hosted MCP</option>
      </select>
    </label>
    {unsupported ? <p>Claude Desktop remote connectors require OAuth and cannot use this item token. Choose Claude Code on this Mac, Codex, Cursor, or a client with protected bearer credentials.</p> : <>
      {path === "local" ? <p>The agent will read this item through the signed-in standalone Mac app, then wait for your instructions. The app credential keeps its existing workspace access.</p> : <>
        <p>Give this connection access to this item for seven days. Edits are limited to text. Other items, sharing, publishing, and deletion are unavailable.</p>
        <label className={styles.field} htmlFor={`${id}-role`}>Permission
          <select id={`${id}-role`} value={role} disabled={busy || !!setup} onChange={(event) => setRole(event.target.value as "read" | "edit")}>
            <option value="edit">Read and edit this item</option><option value="read">Read this item only</option>
          </select>
        </label>
      </>}
      {!setup && <button type="button" className={styles.action} disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try {
          if (path === "local") {
            const result = await prepareLocalItemAgentAction(handle, postId, client);
            if (active.current) setSetup(result);
          } else {
            const result = await createItemAgentAction(handle, postId, client, role);
            reload();
            if (active.current) setSetup({ ...result, instruction: remoteAgentInstruction(postId, role) });
          }
        } catch { if (active.current) setError("Could not prepare the connection. Check existing item connections before retrying."); }
        finally { if (active.current) setBusy(false); }
      }}>{busy ? "Preparing…" : path === "local" ? "Prepare instruction" : "Approve and create token"}</button>}
      {setup && <>
        {setup.token && <div className={styles.history}>
          <strong>Copy your token once</strong><p>Shown only until you close this sheet. Store it in the client’s protected credential field or environment manager. Never paste it into an agent conversation.</p>
          <label className={styles.field} htmlFor={`${id}-token`}>Token<input id={`${id}-token`} type="password" autoComplete="off" spellCheck={false} readOnly value={setup.token} /></label>
          <button type="button" className={styles.action} onClick={() => void copy(setup.token!, "Token")}>Copy token</button>{" "}
          <button type="button" className={styles.action} onClick={() => setSetup({ ...setup, token: undefined })}>I saved the token</button>
        </div>}
        {config && <div className={styles.history}><strong>Configure {client}</strong><p>{config.help}</p><pre className={styles.copyText}>{config.text}</pre>
          <button type="button" className={styles.action} onClick={() => void copy(config.text, "Configuration")}>Copy configuration</button></div>}
        <div className={styles.history}><strong>Ask the agent to connect</strong><pre className={styles.copyText}>{setup.instruction}</pre>
          <button type="button" className={styles.action} onClick={() => void copy(setup.instruction, "Instruction")}>Copy instruction</button></div>
        <p role="status">{present ? `${client} is connected to this item` : verified ? `${client} connected successfully. No current presence.` : "Waiting for this agent to read the item. Keep this sheet open, then paste the instruction into your agent."}</p>
        {path === "local" && <p>Local agents share the app credential. Stop the agent in its client to end the session. Removing one label cannot revoke that shared access. The TestFlight app does not include the CLI.</p>}
      </>}
    </>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </>;
}
