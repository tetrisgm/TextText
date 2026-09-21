"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addPost } from "@/lib/pool/store";
import { plainTextExcerpt } from "@/lib/content";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { WorkspaceDocumentOpenHistory } from "@/lib/workspace-activity";
import { fetchReadingHome, fetchReadingOverview, fetchReadingPage, setReadingItemsRead, type HomeUnit, type ReadingOverview, type ReadingListItem } from "@/lib/reading/client";
import { ManageSourcesDialog } from "@/components/workspace/reading/ManageSourcesDialog";
import { ReadingPreferences } from "./ReadingPreferences";
import { StoryActions } from "./StoryActions";
import { signOut } from "next-auth/react";
import { ArtifactIcon } from "./ArtifactNavigation";
import { poolPostFor } from "./HomeNews";
import { publisherFor } from "./publisher";
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

function ArticleRows({ items, previews = false, ...props }: OpenProps & { items: ReadingListItem[]; previews?: boolean }) {
  const open = useOpenArticle(props);
  return <ul className={styles.list}>{items.map((item) => <li key={item.id}>
    <button className={`${styles.unit} ${styles.rowButton} ${styles.savedRow} ${previews ? styles.libraryRow : ""}`} onClick={() => open(item)}>
      <span className={styles.body}>
        <span className={styles.headline}>{item.title}</span>
        {previews && item.excerpt && <span className={styles.libraryExcerpt}>{plainTextExcerpt(item.excerpt, 240)}</span>}
        <span className={styles.sources}>{publisherFor(item).name}{item.read ? <> · <span className={styles.readState}>✓ Read</span></> : item.wordCount > 100 ? ` · ${Math.max(1, Math.round(item.wordCount / 220))} min read` : ""}</span>
        {previews && <span className={styles.libraryFolder}>{item.folderPath.split("/").join(" / ")}</span>}
      </span>
      {item.imageUrl && <img className={styles.thumb} src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
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
    <p className={styles.storyMeta}>{selected.members.length} articles · {selected.sources.length} {selected.sources.length === 1 ? "source" : "sources"}</p>
    {selected.imageUrl && <img className={styles.leadImage} src={selected.imageUrl} alt="" referrerPolicy="no-referrer" />}
    {selected.text && <p className={styles.storySummary}>{selected.text}</p>}
    <ArticleRows items={selected.members} {...props} />
  </section>;

  return <section aria-labelledby="artifact-headlines-title">
    <h1 className={styles.pageTitle} id="artifact-headlines-title">Headlines</h1>
    {error ? <p role="alert">{error} <button className={styles.action} onClick={() => setAttempt((value) => value + 1)}>Try again</button></p> : summaries === null ? <p className={styles.empty} role="status">Loading headlines…</p> : summaries.length === 0 ? <p className={styles.empty}>When your publishers cover the same news, their articles appear together here.</p> : <ul className={styles.list}>
      {summaries.map((summary) => <li key={summary.id}><button className={`${styles.unit} ${styles.rowButton}`} onClick={() => setSelected(summary)}>
        <span className={styles.body}><span className={styles.headline}>{summary.headline}</span><span className={styles.sources}>{summary.members.length} articles · {summary.sources.length} {summary.sources.length === 1 ? "source" : "sources"}</span></span>
        {summary.imageUrl && <img className={styles.thumb} src={summary.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </button></li>)}
    </ul>}
  </section>;
}

export function SavedArticles({ state, folders = [], ...props }: OpenProps & { state: "saved" | "read" | "bookmarked"; folders?: WorkspacePoolPayload["folders"] }) {
  const [folderPath, setFolderPath] = useState("");
  const [later, setLater] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const effectiveState = state === "bookmarked" && later ? "saved" : state;
  const generation = useRef(0);
  const [items, setItems] = useState<ReadingListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const resetPage = () => {
    generation.current += 1;
    setItems(null); setCursor(null); setError(null); setLoading(false);
  };
  useEffect(() => {
    generation.current += 1;
    let active = true;
    void fetchReadingPage({ handle: props.handle, scope: { folderPath, query, includeDescendants: true, state: effectiveState, dateBasis: state === "read" ? "read" : "received" } }).then((page) => {
      if (!active) return;
      setItems(page.items); setCursor(page.nextCursor); setError(null);
    }).catch(() => { if (active) setError("Could not load saved articles."); });
    return () => { active = false; generation.current += 1; };
  }, [props.handle, attempt, state, effectiveState, folderPath, query]);
  const more = async () => {
    if (loading || !cursor) return;
    const request = generation.current;
    setLoading(true);
    try {
      const page = await fetchReadingPage({ handle: props.handle, cursor, scope: { folderPath, query, includeDescendants: true, state: effectiveState, dateBasis: state === "read" ? "read" : "received" } });
      if (request !== generation.current) return;
      setItems((current) => [...new Map([...(current ?? []), ...page.items].map((item) => [item.id, item])).values()]); setCursor(page.nextCursor); setError(null);
    } catch { if (request === generation.current) setError("Could not load more articles."); }
    finally { if (request === generation.current) setLoading(false); }
  };
  return <>{state === "bookmarked" && <div className={styles.libraryFilters}>
    <form className={styles.librarySearch} role="search" onSubmit={(event) => { event.preventDefault(); if (query !== search.trim()) { resetPage(); setQuery(search.trim()); } }}>
      <input type="search" aria-label="Search saved articles" placeholder="Search saved articles" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} />
      <button type="submit">Search</button>
      {query && <button type="button" onClick={() => { resetPage(); setSearch(""); setQuery(""); }}>Clear</button>}
    </form>
    <div role="group" aria-label="Saved articles"><button aria-pressed={!later} onClick={() => { if (later) { resetPage(); setLater(false); } }}>All saved</button><button aria-pressed={later} onClick={() => { if (!later) { resetPage(); setLater(true); } }}>Read Later</button></div>
    <select aria-label="Bookmark folder" value={folderPath} onChange={(event) => { resetPage(); setFolderPath(event.target.value); }}><option value="">All folders</option>{[...folders].sort((a, b) => a.path.localeCompare(b.path)).map((folder) => <option key={folder.id} value={folder.path}>{folder.path.split("/").join(" / ")}</option>)}</select>
  </div>}{error && <p role="alert">{error} <button className={styles.action} onClick={() => { resetPage(); setAttempt((value) => value + 1); }}>Try again</button></p>}
    {items ? items.length ? <ArticleRows items={items} previews={state === "bookmarked"} {...props} /> : <p className={styles.empty}>{query ? "No saved articles match this search and filters." : state === "read" ? "Articles you read appear here." : folderPath ? "No saved articles in this folder yet." : later ? "Articles you mark Read Later appear here." : "Save a link or keep an article from News to start your library."}</p> : !error && <p className={styles.empty} role="status">Loading saved articles…</p>}
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
  const [page, setPage] = useState<"profile" | "kept" | "history" | "interests" | "hidden">("profile");
  const [managing, setManaging] = useState(false);
  const [settingsMenu, setSettingsMenu] = useState(false);
  void history;
  const [overview, setOverview] = useState<ReadingOverview | null>(null);
  useEffect(() => {
    let active = true;
    void fetchReadingOverview(pool.blog.handle).then((value) => { if (active) setOverview(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [pool.blog.handle]);
  const articlesRead = overview?.totals.unread != null ? Math.max(0, overview.totals.items - overview.totals.unread) : null;
  return <section aria-labelledby="artifact-profile-title" className={page === "profile" ? styles.profileHome : undefined}>
    <header className={styles.profileHeader}>
      {page !== "profile" && <button className={`${styles.iconButton} ${styles.profileBack}`} aria-label="Back to Profile" onClick={() => setPage("profile")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4-8 8 8 8" /></svg></button>}
      <h1 className={styles.pageTitle} id="artifact-profile-title">{page === "profile" ? "Profile" : page === "kept" ? "Read Later" : page === "history" ? "Reading History" : page === "interests" ? "Manage interests" : "Hidden publishers"}</h1>
      {page === "profile" && <button className={styles.iconButton} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setSettingsMenu(true); }} aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsMenu}><ArtifactIcon name="settings" /></button>}
    </header>
    {page === "interests" || page === "hidden" ? <ReadingPreferences handle={pool.blog.handle} mode={page} onDone={() => setPage("profile")} /> : page === "kept" || page === "history" ? <SavedArticles key={page} state={page === "kept" ? "saved" : "read"} handle={pool.blog.handle} blogId={pool.blogId} onOpenPost={onOpenPost} /> : <>
      <div className={styles.profileIdentity}><span className={styles.avatar} aria-hidden="true">{(pool.blog.name || pool.blog.handle).slice(0, 1).toUpperCase()}</span><div><strong>{pool.blog.name || pool.blog.handle}</strong><p>@{pool.blog.handle}</p></div></div>
      {articlesRead !== null && <button className={styles.readingStats} onClick={() => setPage("history")} aria-label={`${articlesRead} articles read. View reading history`}>
        <span className={styles.readingRing}>{articlesRead}</span><span><strong>Articles read</strong><span>Every story brings a new perspective.</span></span>
      </button>}
      <ul className={styles.profileList}>
        <li><button onClick={() => setPage("kept")}><ArtifactIcon name="bookmark" /><span>Read Later</span><span aria-hidden="true">›</span></button></li>
        <li><button onClick={() => setPage("history")}><ArtifactIcon name="history" /><span>Reading History</span><span aria-hidden="true">›</span></button></li>
        <li><button onClick={() => setPage("interests")}><ArtifactIcon name="headlines" /><span>Manage interests</span><span aria-hidden="true">›</span></button></li>
        <li><button onClick={() => setPage("hidden")}><ArtifactIcon name="history" /><span>Hidden publishers</span><span aria-hidden="true">›</span></button></li>
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
    {settingsMenu && <StoryActions placement="menu" label="Profile settings" onClose={() => setSettingsMenu(false)}>
      {canManage && <button onClick={() => { setSettingsMenu(false); setManaging(true); }}>Subscriptions<ArtifactIcon name="bookmark" /></button>}
      <button onClick={() => { setSettingsMenu(false); setPage("interests"); }}>Manage interests<ArtifactIcon name="headlines" /></button>
      <button onClick={() => { setSettingsMenu(false); setPage("hidden"); }}>Hidden publishers<ArtifactIcon name="history" /></button>
      <a href="/terms">Terms of service<ArtifactIcon name="notes" /></a>
      <a href="/privacy">Privacy<ArtifactIcon name="bookmark" /></a>
      <a href={`${settingsHref}#settings-notifications`}>Push settings<ArtifactIcon name="bell" /></a>
      <a href={settingsHref}>Account options<ArtifactIcon name="profile" /></a>
      <button className={styles.signOut} onClick={() => {
        const host = window as typeof window & { __TEXTTEXT_APP__?: boolean; webkit?: { messageHandlers?: { textTextApp?: { postMessage: (message: unknown) => void } } } };
        if (host.__TEXTTEXT_APP__ === true) host.webkit?.messageHandlers?.textTextApp?.postMessage({ action: "signOut" });
        else void signOut({ redirectTo: "/signin" });
      }}>Sign out<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 3H3v18h6M8 12h14m-5-5 5 5-5 5" /></svg></button>
    </StoryActions>}
    {managing && <ManageSourcesDialog handle={pool.blog.handle} blogId={pool.blogId} folderPath="" folderName="all folders" onClose={() => setManaging(false)} onChanged={() => undefined} />}
  </section>;
}


export function ArtifactNotes({ pool, onOpenPost, onOpenSection, onCreateNote, onBrowseFolders, canManage, notice, creating, creationControls }: {
  creationControls?: ReactNode;
  notice?: string | null;
  creating?: boolean;
  pool: WorkspacePoolPayload;
  onOpenPost: (id: string) => void;
  onOpenSection: (path: string) => void;
  onCreateNote: () => void;
  onBrowseFolders: () => void;
  canManage: boolean;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const [kind, setKind] = useState<"all" | "note" | "article">("all");
  const folders = pool.folders.filter((folder) => pool.posts.some((post) => post.folderId === folder.id && post.type !== "bookmark"));
  const notes = pool.posts.filter((post) => post.origin !== "feed" && post.type !== "bookmark" && (kind === "all" || post.type === kind) && (!folderId || post.folderId === folderId))
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return <section aria-labelledby="artifact-notes-title" data-artifact-notes>
    {canManage && creationControls ? creationControls : <header className={styles.profileHeader}>
      <h1 className={styles.pageTitle} id="artifact-notes-title">Writing</h1>
      {canManage && <button className={styles.iconButton} onClick={onCreateNote} disabled={creating} aria-label="New note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M13 5H4v16h16v-9M10 14l1-4L20 1l3 3-9 9Z" /></svg></button>}
    </header>}
    {notice && <p role="alert">{notice}</p>}
    <nav className={styles.noteFolders} aria-label="Writing types">
      {(["all", "note", "article"] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setLimit(60); }}>{value === "all" ? "Everything" : value === "note" ? "Notes" : "Articles"}</button>)}
    </nav>
    <nav className={styles.noteFolders} aria-label="Writing folders">
      <button aria-pressed={!folderId} onClick={() => { setFolderId(null); setLimit(60); }}>All folders</button>
      {folders.map((folder) => <button key={folder.id} aria-pressed={folderId === folder.id} onClick={() => { setFolderId(folder.id); setLimit(60); }}>{folder.name}</button>)}
      <button aria-label="Browse folders" onClick={onBrowseFolders}>•••</button>
    </nav>
    {notes.length ? <ul className={styles.noteList}>{notes.slice(0, limit).map((note) => <li key={note.id}>
      <button onClick={() => onOpenPost(note.id)}>
        <strong>{note.starred && <span aria-label="Starred">★ </span>}{note.title || "Untitled"}</strong>
        {(note.excerpt || note.bodyPreview) && <span className={styles.notePreview}>{plainTextExcerpt(note.excerpt) || plainTextExcerpt(note.bodyPreview)}</span>}
        <span className={styles.noteMeta}>{pool.folders.find((folder) => folder.id === note.folderId)?.name}{note.tags?.length ? ` · ${note.tags.map((tag) => `#${tag}`).join(" ")}` : ""}</span>
      </button>
    </li>)}</ul> : <div className={styles.noteEmpty}><ArtifactIcon name="notes" /><h2>{kind === "article" ? "Your articles start here" : "Your writing, close at hand"}</h2><p>Write, link ideas, and pick up where you left off.</p>{canManage && kind !== "article" && <button className={styles.primaryButton} disabled={creating} onClick={onCreateNote}>{creating ? "Creating…" : "Write a note"}</button>}</div>}
    {notes.length > limit && <button className={styles.back} onClick={() => setLimit((value) => value + 60)}>More writing</button>}
    {folderId && <button className={styles.back} onClick={() => { const folder = folders.find((entry) => entry.id === folderId); if (folder) onOpenSection(folder.path); }}>Open folder</button>}
  </section>;
}
