"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { VaultError, vaultRequest } from "./bridge";
import styles from "./VaultPublishDialog.module.css";

type Publication = {
  itemId: string;
  revision: string;
  published: boolean;
  publishedAt: string | null;
  publicPath: string;
  publicURL?: string;
};

function publicLink(state: Publication, workspaceId: string): string {
  const expected = `/v/${encodeURIComponent(workspaceId)}/${encodeURIComponent(state.itemId)}`;
  if (state.publicPath !== expected) return "";
  if (state.publicURL) {
    try {
      const url = new URL(state.publicURL);
      if (["https:", "http:"].includes(url.protocol) && url.pathname === expected && !url.username && !url.password && !url.search && !url.hash) return url.href;
    } catch { /* A malformed native response must not become a shared link. */ }
    return "";
  }
  return ["https:", "http:"].includes(window.location.protocol) ? new URL(expected, window.location.origin).href : "";
}

export function VaultPublishDialog({ workspaceId, itemId, label, beforeChange, onClose }: {
  workspaceId: string; itemId: string; label: string; beforeChange: () => Promise<boolean>; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useDialogFocus(dialog, true);
  const reload = useCallback(async () => {
    const result = await vaultRequest<Publication>("publicationRead", { itemId });
    if (result.itemId !== itemId || !/^[a-f0-9]{64}$/.test(result.revision) || typeof result.published !== "boolean") {
      throw new Error("The publication state could not be verified.");
    }
    setState(result);
    return result;
  }, [itemId]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      void reload().catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Could not load publication status."); })
        .finally(() => { if (live) setLoading(false); });
    });
    return () => { live = false; };
  }, [reload]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const change = async (published: boolean) => {
    if (busy) return;
    setBusy(true); setError(""); setCopied(false);
    try {
      if (!await beforeChange()) throw new Error("Save or resolve this file before changing its public access.");
      const latest = await reload();
      if (latest.published === published) return;
      const result = await vaultRequest<Publication>("publicationSet", {
        itemId, operationId: crypto.randomUUID(), baseRevision: latest.revision, published,
      });
      if (result.itemId !== itemId || result.published !== published || !/^[a-f0-9]{64}$/.test(result.revision)) {
        throw new Error("The publication change was not confirmed.");
      }
      setState(result);
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (cause) {
      if (cause instanceof VaultError && cause.code === "409") {
        await reload().catch(() => {});
        setError("This file changed while you were publishing. Review it, then try again.");
      } else setError(cause instanceof Error ? cause.message : "Publication could not be changed.");
    } finally { setBusy(false); }
  };
  const link = state?.published ? publicLink(state, workspaceId) : "";
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { linkInput.current?.select(); setError("Select and copy the link from this field."); }
  };
  return <div className="vault-sharing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="vault-sharing-dialog" role="dialog" aria-modal="true" aria-label={`Publish ${label}`}>
      <header><div><p className="vault-eyebrow">Public page</p><h2>Publish {label}</h2></div><button type="button" aria-label="Close publishing" onClick={onClose}>Close</button></header>
      {loading ? <p role="status">Checking publication status…</p> : state ? <>
        <p className={styles.status}>{state.published ? "This file is public." : "This file is private."}</p>
        <p className="vault-sharing-intro">Anyone with the link can read the current saved file. Changes you save later appear on the same page. Comments and workspace access stay private.</p>
        {state.published && link && <div className={styles.link}>
          <label htmlFor="vault-public-link">Public link</label>
          <input id="vault-public-link" ref={linkInput} readOnly value={link} onFocus={event => event.currentTarget.select()} />
          <div><button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
            <a href={link} target="_blank" rel="noopener noreferrer">Open page</a></div>
        </div>}
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void change(!state.published)}>
          {busy ? "Saving…" : state.published ? "Unpublish" : "Publish file"}
        </button></div>
      </> : null}
      {error && <p role="alert" className="vault-sharing-error">{error} {!state && <button onClick={() => void reload().then(() => setError("")).catch(() => {})}>Retry</button>}</p>}
    </section>
  </div>;
}
