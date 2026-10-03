"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { VaultError, vaultRequest } from "./bridge";
import type { VaultFile } from "./bridge";
import type { StoryDetails } from "./story-details";
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
type PreviewImage = { src: string; data: string; contentType: string };
type StoryPreview = { revision: string; title: string; subtitle: string; previewTitle: string; previewSubtitle: string; excerpt: string; topics: string[]; ready: boolean; featuredImage: string; images: PreviewImage[] };

export function storyPreviewFromFile(file: VaultFile): StoryPreview {
  const document = readDocument(file);
  const images = document.content.assets.filter(asset => asset.kind === "image" &&
    (document.content.body.includes(asset.src) || document.content.fields.cover === asset.src)).slice(0, 12).flatMap(asset => {
    const saved = file.assets?.find(candidate => asset.src === `assets/${candidate.filename}` || asset.src === candidate.remoteURL);
    return saved && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(saved.contentType) && saved.data.length <= 8 * 1024 * 1024
      ? [{ src: asset.src, data: saved.data, contentType: saved.contentType }] : [];
  });
  const selected = document.content.fields.texttextFeaturedImage;
  const featuredImage = typeof selected === "string" && images.some(image => image.src === selected) ? selected : images[0]?.src ?? "";
  const title = document.content.title.trim();
  const subtitle = document.content.subtitle?.trim() || "";
  const customTitle = document.content.fields.texttextPreviewTitle;
  const customSubtitle = document.content.fields.texttextPreviewSubtitle;
  return {
    revision: file.hash,
    title, subtitle,
    previewTitle: typeof customTitle === "string" && customTitle.trim() ? customTitle.trim() : title,
    previewSubtitle: typeof customSubtitle === "string" ? customSubtitle.trim() : subtitle,
    excerpt: stripMarkdown(document.content.body).trim().slice(0, 240),
    topics: document.content.tags,
    ready: Boolean(document.content.title.trim() && stripMarkdown(document.content.body).trim()),
    featuredImage, images,
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

export function VaultPublishDialog({ workspaceId, itemId, label, beforeChange, readStoryFile, onSaveStoryDetails, onClose }: {
  workspaceId: string; itemId: string; label: string; beforeChange: () => Promise<string | false>; readStoryFile?: () => Promise<VaultFile>; onSaveStoryDetails?: (details: StoryDetails) => Promise<string | false>; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [story, setStory] = useState<StoryPreview | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState("");
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
        if (live) { setStory(preview); setTitle(preview?.previewTitle ?? ""); setSubtitle(preview?.previewSubtitle ?? ""); setTopics(preview?.topics ?? []); setFeaturedImage(preview?.featuredImage ?? ""); }
      })().catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Could not load publication status."); })
        .finally(() => { if (live) setLoading(false); });
    });
    return () => { live = false; };
  }, [reload]);
  useEffect(() => {
    const selected = story?.images.find(image => image.src === featuredImage);
    if (!selected) { queueMicrotask(() => setCoverURL("")); return; }
    let live = true;
    try {
      const bytes = Uint8Array.from(atob(selected.data), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: selected.contentType }));
      queueMicrotask(() => { if (live) setCoverURL(url); });
      return () => { live = false; URL.revokeObjectURL(url); };
    } catch { return; }
  }, [story, featuredImage]);
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
  const detailsChanged = Boolean(story && (title.trim() !== story.previewTitle || subtitle.trim() !== story.previewSubtitle || featuredImage !== story.featuredImage || JSON.stringify(topics) !== JSON.stringify(story.topics)));
  const addTopic = () => {
    const topic = topicInput.trim().replace(/^#/, "").slice(0, 40);
    if (!topic || topics.length >= 5 || topics.some(value => value.toLocaleLowerCase() === topic.toLocaleLowerCase())) return;
    setTopics(previous => [...previous, topic]); setTopicInput("");
  };
  const saveStoryDetails = async () => {
    if (!story || !readStoryFile || !onSaveStoryDetails || !detailsChanged || busy || !title.trim()) return;
    setBusy(true); setError("");
    try {
      const observed = await beforeChange();
      if (!observed || observed !== story.revision) throw new Error("This story changed since its preview. Close and reopen Publish to review it.");
      const revision = await onSaveStoryDetails({
        topics,
        ...(title.trim() !== story.previewTitle ? { previewTitle: title.trim() === story.title ? null : title.trim() } : {}),
        ...(subtitle.trim() !== story.previewSubtitle ? { previewSubtitle: subtitle.trim() === story.subtitle ? null : subtitle.trim() } : {}),
        ...(featuredImage !== story.featuredImage ? { featuredImage } : {}),
      });
      if (!revision) throw new Error("Story details could not be saved. Your changes are still shown here.");
      const file = await readStoryFile();
      const next = await reload();
      if (file.hash !== revision || next.revision !== revision) throw new Error("The story changed while saving details. Close and reopen Publish to review it.");
      const preview = storyPreviewFromFile(file);
      setStory(preview); setTitle(preview.previewTitle); setSubtitle(preview.previewSubtitle); setTopics(preview.topics); setFeaturedImage(preview.featuredImage);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Story details could not be saved."); }
    finally { setBusy(false); }
  };
  const link = state?.published ? publicLink(state, workspaceId) : "";
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { linkInput.current?.select(); setError("Select and copy the link from this field."); }
  };
  return <div className="vault-sharing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`vault-sharing-dialog ${readStoryFile ? styles.storyDialog : ""}`} role="dialog" aria-modal="true" aria-label={`Publish ${story?.title || label}`}>
      <header><div><p className="vault-eyebrow">Public page</p><h2>Publish {story?.title || label}</h2></div><button type="button" aria-label="Close publishing" onClick={onClose}>Close</button></header>
      <div className={readStoryFile ? styles.storyScroll : undefined}>
      {loading ? <p role="status">Preparing story preview…</p> : state ? <>
        {story && <div className={styles.storyReview}><div className={styles.storyCard}>
          {coverURL && /* eslint-disable-next-line @next/next/no-img-element */ <img src={coverURL} alt="" />}
          <div><small>Story preview</small><h3>{title.trim() || "Untitled story"}</h3>{subtitle.trim() && <p>{subtitle.trim()}</p>}{story.excerpt && <p>{story.excerpt}</p>}</div>
        </div><div className={styles.storyDetails}><h3>Before publishing</h3><p>Review how your story will appear. These details are saved in its TextPack.</p>{onSaveStoryDetails && <div className={styles.storyFields}><label>Preview title<input aria-label="Story preview title" value={title} maxLength={200} disabled={busy} onChange={event => setTitle(event.target.value)} /></label><label>Preview subtitle<input aria-label="Story preview subtitle" value={subtitle} maxLength={300} disabled={busy} onChange={event => setSubtitle(event.target.value)} /></label></div>}{story.images.length > 1 && <fieldset className={styles.imageChoices} disabled={busy || !onSaveStoryDetails}><legend>Preview image</legend>{story.images.map((image, index) => <label key={image.src}><input type="radio" name="story-preview-image" aria-label={`Use image ${index + 1} for story preview`} checked={featuredImage === image.src} onChange={() => setFeaturedImage(image.src)} />{image.data.length <= 400_000 && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`data:${image.contentType};base64,${image.data}`} alt="" />}<span>Image {index + 1}</span></label>)}</fieldset>}<h4>Topics</h4>{topics.length ? <div className={styles.topics}>{topics.map(topic => <span key={topic}>{topic}{onSaveStoryDetails && <button type="button" aria-label={`Remove ${topic} topic`} disabled={busy} onClick={() => setTopics(values => values.filter(value => value !== topic))}>×</button>}</span>)}</div> : <p>No topics yet.</p>}{onSaveStoryDetails && <><form className={styles.topicForm} onSubmit={event => { event.preventDefault(); addTopic(); }}><input aria-label="Add story topic" placeholder={topics.length >= 5 ? "Five topics maximum" : "Add a topic"} value={topicInput} maxLength={41} disabled={busy || topics.length >= 5} onChange={event => setTopicInput(event.target.value)} /><button type="submit" disabled={busy || topics.length >= 5 || !topicInput.trim()}>Add</button></form>{detailsChanged && <button type="button" className={styles.saveTopics} disabled={busy || !title.trim()} onClick={() => void saveStoryDetails()}>{busy ? "Saving…" : "Save story details"}</button>}</>}</div></div>}
        {story && !story.ready && !state.published && <p role="status" className={styles.draftNotice}>Add a title and some story text before publishing. Your draft is saved in Blog.</p>}
        <p className={styles.status}>{state.published ? "This file is public." : "This file is private."}</p>
        <p className="vault-sharing-intro">Anyone with the link can read the current saved file. Changes you save later appear on the same page. Comments and workspace access stay private.</p>
        {state.published && link && <div className={styles.link}>
          <label htmlFor="vault-public-link">Public link</label>
          <input id="vault-public-link" ref={linkInput} readOnly value={link} onFocus={event => event.currentTarget.select()} />
          <div><button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
            <a href={link} target="_blank" rel="noopener noreferrer">Open page</a></div>
        </div>}
        {state.canPublish === false && <p>Only the workspace owner can change public access.</p>}
      </> : null}
      {error && <p role="alert" className="vault-sharing-error">{error} {!state && <button onClick={() => void reload().then(() => setError("")).catch(() => {})}>Retry</button>}</p>}
      </div>
      {state && state.canPublish !== false && <div className={styles.actions}><button type="button" disabled={busy || detailsChanged || (Boolean(readStoryFile) && (!story || (!state.published && !story.ready)))} onClick={() => void change(!state.published)}>
        {busy ? "Saving…" : state.published ? "Unpublish" : story ? "Publish story" : "Publish file"}
      </button></div>}
    </section>
  </div>;
}
