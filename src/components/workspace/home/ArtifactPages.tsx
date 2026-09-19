"use client";

import { useEffect, useRef, useState } from "react";
import { addPost } from "@/lib/pool/store";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { WorkspaceDocumentOpenHistory } from "@/lib/workspace-activity";
import { fetchReadingHome, fetchReadingPage, setReadingItemsRead, type HomeUnit, type ReadingListItem } from "@/lib/reading/client";
import { ManageSourcesDialog } from "@/components/workspace/reading/ManageSourcesDialog";
import { ArtifactIcon } from "./ArtifactNavigation";
import { poolPostFor, PublisherRow } from "./HomeNews";
import styles from "./Home.module.css";

type Summary = Extract<HomeUnit, { kind: "summary" }>;
type OpenProps = { handle: string; blogId: string; onOpenPost: (id: string) => void };

function useOpenArticle(props: OpenProps) {
  const onOpen = useRef(props.onOpenPost);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { onOpen.current = props.onOpenPost; }, [props.onOpenPost]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (item: ReadingListItem) => {
    addPost(poolPostFor(item, props.blogId));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onOpen.current(item.id), 0);
    void setReadingItemsRead(props.handle, [item.id], true).catch(() => undefined);
  };
}

function ArticleRows({ items, ...props }: OpenProps & { items: ReadingListItem[] }) {
  const open = useOpenArticle(props);
  return <ul className={styles.list}>{items.map((item) => <li key={item.id}>
    <button className={`${styles.unit} ${styles.rowButton}`} onClick={() => open(item)}>
      <span className={styles.body}>
        <PublisherRow item={item} at={item.publishedAt ?? item.receivedAt} now={0} />
        <span className={styles.headline}>{item.title}</span>
        <span className={styles.sources}>{item.read ? "✓ Read" : item.wordCount > 100 ? `${Math.max(1, Math.round(item.wordCount / 220))} min read` : ""}</span>
      </span>
      {item.imageUrl && <img className={styles.thumb} src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    </button>
  </li>)}</ul>;
}

export function ArtifactHeadlines(props: OpenProps) {
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [selected, setSelected] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchReadingHome({ handle: props.handle, mode: "forYou", topic: null, limit: 100 }).then((page) => {
      if (!active) return;
      const combined = [...page.headlines, ...page.units].filter((unit): unit is Summary => unit.kind === "summary");
      setSummaries([...new Map(combined.map((unit) => [unit.id, unit])).values()]);
      setError(null);
    }).catch(() => { if (active) setError("Could not load headlines."); });
    return () => { active = false; };
  }, [props.handle, attempt]);

  if (selected) return <section aria-label="Headline coverage">
    <button className={styles.back} onClick={() => setSelected(null)}>‹ Headlines</button>
    <h1 className={styles.storyTitle}>{selected.headline}</h1>
    <p className={styles.storyMeta}>{selected.members.length} articles · {selected.sources.length} sources</p>
    {selected.imageUrl && <img className={styles.leadImage} src={selected.imageUrl} alt="" referrerPolicy="no-referrer" />}
    {selected.text && <p className={styles.storySummary}>{selected.text}</p>}
    <ArticleRows items={selected.members} {...props} />
  </section>;

  return <section aria-labelledby="artifact-headlines-title">
    <h1 className={styles.pageTitle} id="artifact-headlines-title">Headlines</h1>
    {error ? <p role="alert">{error} <button className={styles.action} onClick={() => setAttempt((value) => value + 1)}>Try again</button></p> : summaries === null ? <p className={styles.empty} role="status">Loading headlines…</p> : summaries.length === 0 ? <p className={styles.empty}>When your publishers cover the same news, their articles appear together here.</p> : <ul className={styles.list}>
      {summaries.map((summary) => <li key={summary.id}><button className={`${styles.unit} ${styles.rowButton}`} onClick={() => setSelected(summary)}>
        <span className={styles.body}><span className={styles.headline}>{summary.headline}</span><span className={styles.sources}>{summary.members.length} articles · {summary.sources.length} sources</span></span>
        {summary.imageUrl && <img className={styles.thumb} src={summary.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </button></li>)}
    </ul>}
  </section>;
}

function ReadLater(props: OpenProps) {
  const [items, setItems] = useState<ReadingListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchReadingPage({ handle: props.handle, scope: { folderPath: "", includeDescendants: true, state: "kept", dateBasis: "received" } }).then((page) => {
      if (!active) return;
      setItems(page.items); setCursor(page.nextCursor); setError(null);
    }).catch(() => { if (active) setError("Could not load saved articles."); });
    return () => { active = false; };
  }, [props.handle, attempt]);
  const more = async () => {
    setLoading(true);
    try {
      const page = await fetchReadingPage({ handle: props.handle, cursor, scope: { folderPath: "", includeDescendants: true, state: "kept", dateBasis: "received" } });
      setItems((current) => [...(current ?? []), ...page.items]); setCursor(page.nextCursor); setError(null);
    } catch { setError("Could not load more articles."); }
    finally { setLoading(false); }
  };
  return <>{error && <p role="alert">{error} <button className={styles.action} onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    {items ? items.length ? <ArticleRows items={items} {...props} /> : <p className={styles.empty}>Save an article to read it later. Your saved articles stay here.</p> : !error && <p className={styles.empty} role="status">Loading saved articles…</p>}
    {cursor && <button className={styles.back} disabled={loading} onClick={() => void more()}>{loading ? "Loading…" : "More articles"}</button>}
  </>;
}

export function ArtifactProfile({ pool, history, onOpenPost, onOpenSection, onShowLibrary, onBrowseFolders, onOpenAssistant, settingsHref, canManage }: {
  pool: WorkspacePoolPayload;
  history: WorkspaceDocumentOpenHistory;
  onOpenPost: (id: string) => void;
  onOpenSection: (path: string) => void;
  onShowLibrary: () => void;
  onBrowseFolders: () => void;
  onOpenAssistant: () => void;
  settingsHref: string;
  canManage: boolean;
}) {
  const [page, setPage] = useState<"profile" | "kept" | "history">("profile");
  const [managing, setManaging] = useState(false);
  const recent = pool.posts.filter((post) => history[post.id]).sort((a, b) => history[b.id] - history[a.id]);
  return <section aria-labelledby="artifact-profile-title">
    <header className={styles.profileHeader}>
      {page !== "profile" && <button className={styles.back} onClick={() => setPage("profile")}>‹ Profile</button>}
      <h1 className={styles.pageTitle} id="artifact-profile-title">{page === "profile" ? "Profile" : page === "kept" ? "Read Later" : "Reading History"}</h1>
      {page === "profile" && <a className={styles.iconButton} href={settingsHref} aria-label="Settings"><ArtifactIcon name="settings" /></a>}
    </header>
    {page === "kept" ? <ReadLater handle={pool.blog.handle} blogId={pool.blogId} onOpenPost={onOpenPost} /> : page === "history" ? <>
      <p className={styles.storyMeta}>Recently opened on this device</p>
      {recent.length ? <ul className={styles.profileList}>{recent.map((post) => <li key={post.id}><button onClick={() => onOpenPost(post.id)}><span>{post.title || "Untitled"}</span><span aria-hidden="true">›</span></button></li>)}</ul> : <p className={styles.empty}>Articles you open appear here.</p>}
    </> : <>
      <div className={styles.profileIdentity}><span className={styles.avatar} aria-hidden="true">{(pool.blog.name || pool.blog.handle).slice(0, 1).toUpperCase()}</span><div><strong>{pool.blog.name || pool.blog.handle}</strong><p>@{pool.blog.handle}</p></div></div>
      <ul className={styles.profileList}>
        <li><button onClick={() => setPage("kept")}><ArtifactIcon name="bookmark" /><span>Read Later</span><span aria-hidden="true">›</span></button></li>
        <li><button onClick={() => setPage("history")}><ArtifactIcon name="history" /><span>Reading History</span><span aria-hidden="true">›</span></button></li>
        {canManage && <li><button onClick={() => setManaging(true)}><ArtifactIcon name="headlines" /><span>Publisher Subscriptions</span><span aria-hidden="true">›</span></button></li>}
      </ul>
      <h2 className={styles.profileSection}>Your library</h2>
      <ul className={styles.profileList}>
        <li><button onClick={onShowLibrary}><ArtifactIcon name="folder" /><span>All items</span><span aria-hidden="true">›</span></button></li>
        {pool.folders.filter((folder) => !folder.parentId).map((folder) => <li key={folder.id}><button onClick={() => onOpenSection(folder.path)}><ArtifactIcon name="folder" /><span>{folder.name}</span><span aria-hidden="true">›</span></button></li>)}
        <li><button onClick={onBrowseFolders}><ArtifactIcon name="folder" /><span>Browse folders</span><span aria-hidden="true">›</span></button></li>
      </ul>
      <ul className={styles.profileList}><li><button onClick={onOpenAssistant}><ArtifactIcon name="profile" /><span>Assistant</span><span aria-hidden="true">›</span></button></li><li><a href={settingsHref}><ArtifactIcon name="settings" /><span>Settings</span><span aria-hidden="true">›</span></a></li></ul>
    </>}
    {managing && <ManageSourcesDialog handle={pool.blog.handle} blogId={pool.blogId} folderPath="" folderName="all folders" onClose={() => setManaging(false)} onChanged={() => undefined} />}
  </section>;
}
