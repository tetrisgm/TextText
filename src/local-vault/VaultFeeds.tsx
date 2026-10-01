import { useEffect, useRef, useState } from "react";
import type { NormalizedEntry } from "@/lib/reading/feed-parse";
import { createFeedSubscriptionPack, createKeptFeedEntryPack, type FeedSubscription } from "@/lib/vault/rss";
import { encodeBase64 } from "./image-import";
import { vaultRequest, type VaultFile } from "./bridge";
import { useEscapeLayer } from "./LocalKeyboard";
import styles from "./VaultFeeds.module.css";

type FeedCandidate = { url: string; title: string; format: FeedSubscription["format"]; entryCount: number; siteUrl: string | null; sampleTitles: string[] };
type Discovery = { pageTitle: string | null; candidates: FeedCandidate[]; detail: string | null };
type Preview = { externalKey: string; title: string; permalink: string | null; authors: string[]; publishedAt: string | null; availability: string; excerpt: string | null; bodyPreview: string };
type FeedPage = { feedURL: string; title: string; fetchedAt: string; entries: Preview[]; availableCount: number; truncated: boolean };
type FullEntry = { feedURL: string; feedTitle: string; entry: NormalizedEntry };

function message(error: unknown): string { return error instanceof Error ? error.message : "The feed request did not finish."; }
function folderLabel(folder: string): string { return folder || "Workspace root"; }
function readableDate(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleDateString();
}

export function FeedSubscribeDialog({ folder, folders, onClose, onSaved }: {
  folder: string; folders: string[]; onClose: () => void; onSaved: (file: VaultFile) => void;
}) {
  const [address, setAddress] = useState("");
  const [targetFolder, setTargetFolder] = useState(folder || "Feeds");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController | null>(null);
  useEscapeLayer(!busy, "subscribe-feed", onClose);
  useEffect(() => () => inFlight.current?.abort(), []);

  const discover = async () => {
    if (busy) return;
    const controller = new AbortController(); inFlight.current?.abort(); inFlight.current = controller;
    setBusy(true); setError(""); setDiscovery(null);
    try {
      const found = await vaultRequest<Discovery>("feedDiscover", { address: address.trim() }, controller.signal);
      if (!controller.signal.aborted) setDiscovery(found);
    } catch (reason) { if (!controller.signal.aborted) setError(message(reason)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const subscribe = async (candidate: FeedCandidate) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const pack = createFeedSubscriptionPack({ feedURL: candidate.url, title: candidate.title,
        description: null, siteUrl: candidate.siteUrl, format: candidate.format });
      const file = await vaultRequest<VaultFile>("importPack", { title: pack.title, data: encodeBase64(pack.bytes), folder: targetFolder.trim() });
      onSaved(file); onClose();
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  };
  return <section className={`vault-template-dialog ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="Subscribe to a feed">
    <header className={styles.header}><div><h2>Subscribe to a feed</h2><p>Save the subscription as a TextPack in a folder.</p></div><button disabled={busy} onClick={onClose}>Close</button></header>
    <form onSubmit={event => { event.preventDefault(); void discover(); }}>
      <label htmlFor="feed-folder">Folder</label>
      <input className={styles.folderInput} id="feed-folder" list="feed-folders" value={targetFolder} onChange={event => setTargetFolder(event.target.value)} placeholder="Workspace root" maxLength={500} disabled={busy} />
      <datalist id="feed-folders">{folders.map(path => <option key={path} value={path} />)}</datalist>
      <label htmlFor="feed-address">Website or feed address</label>
      <div className={styles.formRow}><input id="feed-address" autoFocus type="text" inputMode="url" value={address} onChange={event => { setAddress(event.target.value); setDiscovery(null); }} placeholder="https://example.com" maxLength={4096} disabled={busy} required />
        <button type="submit" disabled={busy || !address.trim()}>{busy && !discovery ? "Finding…" : "Find feeds"}</button></div>
    </form>
    {error && <p className={styles.notice} role="alert">{error}</p>}
    {discovery && <div className={styles.candidates}>
      <h3>{discovery.candidates.length ? "Choose a source" : "No feeds found"}</h3>
      {discovery.detail && <p>{discovery.detail}</p>}
      {discovery.candidates.map(candidate => <div className={styles.candidate} key={candidate.url}>
        <div><strong>{candidate.title || new URL(candidate.url).hostname}</strong><span>{candidate.url}</span>
          <small>{candidate.format?.toUpperCase()} · {candidate.entryCount} {candidate.entryCount === 1 ? "entry" : "entries"}</small></div>
        <button type="button" disabled={busy} onClick={() => void subscribe(candidate)}>Subscribe</button>
      </div>)}
    </div>}
  </section>;
}

export function FeedSubscriptionReader({ subscription, folder, canRead, canKeep, onKept }: {
  subscription: FeedSubscription; folder: string; canRead: boolean; canKeep: boolean; onKept: (file: VaultFile) => void;
}) {
  const [page, setPage] = useState<FeedPage | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(canRead);
  const [keeping, setKeeping] = useState<string | null>(null);
  const [keptKeys, setKeptKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readController = useRef<AbortController | null>(null);
  const keepController = useRef<AbortController | null>(null);
  useEffect(() => () => { readController.current?.abort(); keepController.current?.abort(); }, []);
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    readController.current = controller;
    // An open or explicit refresh reads a bounded, transient list. There is no timer.
    void vaultRequest<FeedPage>("feedRead", { feedURL: subscription.feedURL }, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setPage(value); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(message(reason)); })
      .finally(() => { if (readController.current === controller) readController.current = null; if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (readController.current === controller) readController.current = null; };
  }, [canRead, subscription.feedURL, version]);
  const refresh = () => { if (loading || readController.current || keeping) return; setPage(null); setError(""); setNotice(""); setLoading(true); setVersion(value => value + 1); };
  const keep = async (preview: Preview) => {
    if (keeping || !canKeep || keptKeys.has(preview.externalKey)) return;
    const controller = new AbortController(); keepController.current = controller;
    setKeeping(preview.externalKey); setError(""); setNotice("");
    try {
      // Fetch the complete entry at the moment of Keep. Preview text is never saved.
      const full = await vaultRequest<FullEntry>("feedEntry", { feedURL: subscription.feedURL, externalKey: preview.externalKey }, controller.signal);
      if (controller.signal.aborted) return;
      const pack = await createKeptFeedEntryPack(full);
      if (controller.signal.aborted) return;
      const file = await vaultRequest<VaultFile>("importPack", { title: pack.title, data: encodeBase64(pack.bytes), folder }, controller.signal);
      if (controller.signal.aborted) return;
      onKept(file); setKeptKeys(keys => new Set(keys).add(preview.externalKey)); setNotice(`Kept “${pack.title}” in ${folderLabel(folder)}.`);
    } catch (reason) { if (!controller.signal.aborted) setError(message(reason)); }
    finally { if (!controller.signal.aborted) setKeeping(null); }
  };
  return <section className={styles.reader} aria-label={`${subscription.title} feed`}>
    <header className={styles.readerHeader}>
      <div><span className={styles.eyebrow}>Feed subscription</span><h2>{subscription.title}</h2>
        <a href={subscription.feedURL} target="_blank" rel="noopener noreferrer">{subscription.feedURL}</a></div>
      <button type="button" disabled={!canRead || loading || !!keeping} onClick={refresh}>Refresh</button>
    </header>
    {!canRead && <p className={styles.notice} role="status">Connect this folder to your TextText workspace to read this feed.</p>}
    {canRead && !page && !error && <p className={styles.notice} role="status">Reading the feed…</p>}
    {error && <p className={styles.notice} role="alert">{error} <button type="button" disabled={loading} onClick={refresh}>Retry</button></p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {canRead && page && <><p className={styles.summary}>Latest entries from {page.title || subscription.title}. Read {readableDate(page.fetchedAt) || "just now"}. Keep saves an article to {folderLabel(folder)}.</p>
      {!page.entries.length && <p className={styles.notice}>This feed has no entries to show.</p>}
      <ol className={styles.entries}>{page.entries.map(preview => <li key={preview.externalKey}>
        <div className={styles.entryHeading}><h3>{preview.title || "Untitled article"}</h3><button type="button" disabled={!canKeep || !!keeping || keptKeys.has(preview.externalKey)} onClick={() => void keep(preview)}>{keeping === preview.externalKey ? "Keeping…" : keptKeys.has(preview.externalKey) ? "Kept" : "Keep"}</button></div>
        <p className={styles.meta}>{[preview.authors.join(", "), readableDate(preview.publishedAt), preview.availability === "full" ? null : preview.availability === "excerpt" ? "Excerpt" : "Details only"].filter(Boolean).join(" · ")}</p>
        {(preview.excerpt || preview.bodyPreview) && <p className={styles.excerpt}>{preview.excerpt || preview.bodyPreview}</p>}
        {preview.permalink && <a href={preview.permalink} target="_blank" rel="noopener noreferrer">Open original</a>}
      </li>)}</ol>
      {page.truncated && <p className={styles.summary}>Showing {page.entries.length} of {page.availableCount} entries. Refresh later to see the latest list.</p>}
    </>}
  </section>;
}
