"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { VaultError, vaultRequest } from "./bridge";
import type { VaultFile } from "./bridge";
import { readDocument } from "./model";
import { stripMarkdown } from "@/lib/content";
import styles from "./VaultPublishDialog.module.css";

type Publication = {
  itemId: string;
  revision: string;
  published: boolean;
  publishedAt: string | null;
  publicPath: string;
  publicURL?: string;
  canPublish?: boolean;
};
type StoryPreview = { revision: string; title: string; subtitle: string; excerpt: string; topics: string[]; ready: boolean; cover?: { data: string; contentType: string } };

export function storyPreviewFromFile(file: VaultFile): StoryPreview {
  const document = readDocument(file);
  const firstImage = document.content.assets.find(asset => asset.kind === "image");
  const source = firstImage?.src;
  const cover = file.assets?.find(asset => source === `assets/${asset.filename}` || source === asset.remoteURL);
  return {
    revision: file.hash,
    title: document.content.title.trim() || "Untitled story",
    subtitle: document.content.subtitle?.trim() || "",
    excerpt: stripMarkdown(document.content.body).trim().slice(0, 240),
    topics: document.content.tags,
    ready: Boolean(document.content.title.trim() && stripMarkdown(document.content.body).trim()),
    ...(cover && ["image/jpeg", "image/png", "image/webp"].includes(cover.contentType) && cover.data.length <= 8 * 1024 * 1024
      ? { cover: { data: cover.data, contentType: cover.contentType } } : {}),
  };
}

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

export function VaultPublishDialog({ workspaceId, itemId, label, beforeChange, readStoryFile, onSaveTopics, onClose }: {
  workspaceId: string; itemId: string; label: string; beforeChange: () => Promise<string | false>; readStoryFile?: () => Promise<VaultFile>; onSaveTopics?: (topics: string[]) => Promise<string | false>; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [story, setStory] = useState<StoryPreview | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState("");
  const [coverURL, setCoverURL] = useState("");
  const initialStoryReader = useRef(readStoryFile);
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
      void (async () => {
        const preview = initialStoryReader.current ? storyPreviewFromFile(await initialStoryReader.current()) : null;
        const publication = await reload();
        if (preview && preview.revision !== publication.revision) throw new Error("This story changed before its preview loaded. Close and reopen Publish to review it.");
        if (live) { setStory(preview); setTopics(preview?.topics ?? []); }
      })().catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Could not load publication status."); })
        .finally(() => { if (live) setLoading(false); });
    });
    return () => { live = false; };
  }, [reload]);
  useEffect(() => {
    if (!story?.cover) return;
    let live = true;
    try {
      const bytes = Uint8Array.from(atob(story.cover.data), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: story.cover.contentType }));
      queueMicrotask(() => { if (live) setCoverURL(url); });
      return () => { live = false; URL.revokeObjectURL(url); };
    } catch { return; }
  }, [story?.cover]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const change = async (published: boolean) => {
    if (busy) return;
    setBusy(true); setError(""); setCopied(false);
    try {
      const observedRevision = await beforeChange();
      if (!observedRevision) throw new Error("Save or resolve this file before changing its public access.");
      if (readStoryFile && (!story || story.revision !== observedRevision)) throw new Error("This story changed since its preview. Close and reopen Publish to review it.");
      const latest = await reload();
      if (latest.revision !== observedRevision) throw new Error("This file changed while you were publishing. Review it, then try again.");
      if (latest.canPublish === false) throw new Error("Only the workspace owner can change public access.");
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
  const topicsChanged = Boolean(story && JSON.stringify(topics) !== JSON.stringify(story.topics));
  const addTopic = () => {
    const topic = topicInput.trim().replace(/^#/, "").slice(0, 40);
    if (!topic || topics.length >= 5 || topics.some(value => value.toLocaleLowerCase() === topic.toLocaleLowerCase())) return;
    setTopics(previous => [...previous, topic]); setTopicInput("");
  };
  const saveTopics = async () => {
    if (!story || !readStoryFile || !onSaveTopics || !topicsChanged || busy) return;
    setBusy(true); setError("");
    try {
      const observed = await beforeChange();
      if (!observed || observed !== story.revision) throw new Error("This story changed since its preview. Close and reopen Publish to review it.");
      const revision = await onSaveTopics(topics);
      if (!revision) throw new Error("Topics could not be saved. Your changes are still shown here.");
      const file = await readStoryFile();
      const next = await reload();
      if (file.hash !== revision || next.revision !== revision) throw new Error("The story changed while saving topics. Close and reopen Publish to review it.");
      const preview = storyPreviewFromFile(file);
      setStory(preview); setTopics(preview.topics);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Topics could not be saved."); }
    finally { setBusy(false); }
  };
  const link = state?.published ? publicLink(state, workspaceId) : "";
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { linkInput.current?.select(); setError("Select and copy the link from this field."); }
  };
  return <div className="vault-sharing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`vault-sharing-dialog ${readStoryFile ? styles.storyDialog : ""}`} role="dialog" aria-modal="true" aria-label={`Publish ${label}`}>
      <header><div><p className="vault-eyebrow">Public page</p><h2>Publish {label}</h2></div><button type="button" aria-label="Close publishing" onClick={onClose}>Close</button></header>
      {loading ? <p role="status">Preparing story preview…</p> : state ? <>
        {story && <div className={styles.storyReview}><div className={styles.storyCard}>
          {coverURL && /* eslint-disable-next-line @next/next/no-img-element */ <img src={coverURL} alt="" />}
          <div><small>Story preview</small><h3>{story.title}</h3>{story.subtitle && <p>{story.subtitle}</p>}{story.excerpt && <p>{story.excerpt}</p>}</div>
        </div><div className={styles.storyDetails}><h3>Before publishing</h3><p>Review the saved story. Its title, text, and image come from this TextPack.</p><h4>Topics</h4>{topics.length ? <div className={styles.topics}>{topics.map(topic => <span key={topic}>{topic}{onSaveTopics && <button type="button" aria-label={`Remove ${topic} topic`} disabled={busy} onClick={() => setTopics(values => values.filter(value => value !== topic))}>×</button>}</span>)}</div> : <p>No topics yet.</p>}{onSaveTopics && <><form className={styles.topicForm} onSubmit={event => { event.preventDefault(); addTopic(); }}><input aria-label="Add story topic" placeholder={topics.length >= 5 ? "Five topics maximum" : "Add a topic"} value={topicInput} maxLength={41} disabled={busy || topics.length >= 5} onChange={event => setTopicInput(event.target.value)} /><button type="submit" disabled={busy || topics.length >= 5 || !topicInput.trim()}>Add</button></form>{topicsChanged && <button type="button" className={styles.saveTopics} disabled={busy} onClick={() => void saveTopics()}>{busy ? "Saving…" : "Save topics"}</button>}</>}</div></div>}
        {story && !story.ready && !state.published && <p role="status" className={styles.draftNotice}>Add a title and some story text before publishing. Your draft is saved in Blog.</p>}
        <p className={styles.status}>{state.published ? "This file is public." : "This file is private."}</p>
        <p className="vault-sharing-intro">Anyone with the link can read the current saved file. Changes you save later appear on the same page. Comments and workspace access stay private.</p>
        {state.published && link && <div className={styles.link}>
          <label htmlFor="vault-public-link">Public link</label>
          <input id="vault-public-link" ref={linkInput} readOnly value={link} onFocus={event => event.currentTarget.select()} />
          <div><button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
            <a href={link} target="_blank" rel="noopener noreferrer">Open page</a></div>
        </div>}
        {state.canPublish === false ? <p>Only the workspace owner can change public access.</p> :
          <div className={styles.actions}><button type="button" disabled={busy || topicsChanged || (Boolean(readStoryFile) && (!story || (!state.published && !story.ready)))} onClick={() => void change(!state.published)}>
            {busy ? "Saving…" : state.published ? "Unpublish" : story ? "Publish story" : "Publish file"}
          </button></div>}
      </> : null}
      {error && <p role="alert" className="vault-sharing-error">{error} {!state && <button onClick={() => void reload().then(() => setError("")).catch(() => {})}>Retry</button>}</p>}
    </section>
  </div>;
}
