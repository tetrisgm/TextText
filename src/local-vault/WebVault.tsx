"use client";

import { useEffect, useState } from "react";
import { createWebAssistant } from "./web-assistant";
import { VaultApp } from "./VaultApp";
import { WebAccount } from "./WebAccount";
import { setVaultTransport } from "./bridge";
import { createWebVaultTransport } from "./web-transport";
import { watchWebWorkspace } from "./web-watch";
import { consumeTemplateIntent } from "./template-intent";
import { claimWebSession, renameWebSession } from "./web-session";

export function WebVault({ workspaceId, name, accountEmail, accountName, requestedTemplate, assistantHandle }: { workspaceId: string; name: string; accountEmail: string | null; accountName: string | null; requestedTemplate?: string; assistantHandle?: string }) {
  const [initial] = useState({ workspaceId, name });
  const [session, setSession] = useState<{ workspaceId: string; name: string; remounted?: boolean } | null>(null);
  const [templateIntent, setTemplateIntent] = useState<{ query: string } | null>(null);
  const [switchError, setSwitchError] = useState("");
  useEffect(() => {
    const owned = claimWebSession(initial.workspaceId, initial.name);
    if (owned.workspaceId !== initial.workspaceId) {
      // The previous editor is already gone. Do not mistake a fresh editor's
      // empty flush guard for acknowledgement of that editor's pending work.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession({ ...owned, remounted: true });
      return;
    }
    const transport = createWebVaultTransport(owned.workspaceId, owned.name);
    const assistant = assistantHandle ? createWebAssistant(assistantHandle, transport.request, fetch, undefined, true) : null;
    const release = setVaultTransport(async (method, params, signal) => {
      if (assistant && method.startsWith("agent")) return assistant.request(method, params);
      const result = await transport.request(method, params, signal);
      return (method === "list" || method === "open") && result && typeof result === "object" ? { ...result, name: owned.name } : result;
    });
    const watcher = watchWebWorkspace({
      visible: () => document.visibilityState === "visible" && navigator.onLine,
      wait: transport.wait, refresh: transport.refresh,
      changed: () => window.dispatchEvent(new Event("texttext:vault-changed")),
    });
    const visibility = watcher.visibilityChanged;
    setSession({ ...owned });
    window.addEventListener("focus", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      watcher.dispose(); assistant?.destroy(); release(); transport.destroy();
      window.removeEventListener("focus", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [initial, assistantHandle]);
  useEffect(() => {
    if (!session || session.remounted || session.workspaceId !== workspaceId || requestedTemplate === undefined) return;
    const intent = consumeTemplateIntent(window.location.href, session.workspaceId);
    if (intent) {
      window.history.replaceState(window.history.state, "", intent.url);
      setTemplateIntent({ query: intent.query });
    }
  }, [session, workspaceId, requestedTemplate]);
  useEffect(() => {
    if (!session || session.remounted || !renameWebSession(workspaceId, name)) return;
    window.dispatchEvent(new Event("texttext:vault-changed"));
  }, [session, workspaceId, name]);
  useEffect(() => {
    if (!session || session.remounted || session.workspaceId === workspaceId) return;
    let active = true;
    void (async () => {
      const flush = (window as Window & { texttextFlushForSignOut?: () => Promise<boolean> }).texttextFlushForSignOut;
      try {
        if (!flush || !await flush()) throw new Error("Finish saving your changes before opening another workspace.");
        if (active) {
          const path = `/vault/${encodeURIComponent(workspaceId)}`;
          // A router transition retains the global bridge realm and is unsafe here.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign(path + (window.location.pathname === path ? window.location.search : ""));
        }
      } catch {
        if (active) setSwitchError("Your current workspace is still open. Finish saving your changes, then open the other workspace again.");
      }
    })();
    return () => { active = false; };
  }, [session, workspaceId]);
  if (session?.remounted) return <section><p>Open this workspace in a new page.</p><a href={`/vault/${encodeURIComponent(workspaceId)}`}>Open workspace</a><p><a href={`/vault/${encodeURIComponent(session.workspaceId)}`}>Return to previous workspace</a></p></section>;
  return session ? <>{switchError && workspaceId !== session.workspaceId && <p role="status">{switchError}</p>}<VaultApp webAssistant={Boolean(assistantHandle)} templateIntent={templateIntent} allowFolderPicker={false} accountMenu={<WebAccount email={accountEmail} name={accountName} assistantHandle={assistantHandle} />} /></> : <p>Opening workspace…</p>;
}
