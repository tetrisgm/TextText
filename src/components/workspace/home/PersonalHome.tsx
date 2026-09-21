"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { WorkspaceDocumentOpenHistory } from "@/lib/workspace-activity";
import { plainTextExcerpt } from "@/lib/content";
import { fetchReadingPage, type ReadingListItem } from "@/lib/reading/client";
import { addPost } from "@/lib/pool/store";
import { poolPostFor } from "./HomeNews";
import { fetchWorkspaceTimeline } from "@/lib/workspace/timeline-client";
import type { TimelinePage } from "@/lib/workspace/timeline";
import styles from "./Home.module.css";

export function PersonalHome({ pool, history, capture, onOpenPost, onNews }: {
  pool: WorkspacePoolPayload;
  history: WorkspaceDocumentOpenHistory;
  capture: ReactNode;
  onOpenPost: (id: string) => void;
  onNews: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "writing" | "saved" | "news">("all");
  const [timeline, setTimeline] = useState<TimelinePage | null>(null);
  const [pending, setPending] = useState<TimelinePage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const timelineRef = useRef<TimelinePage | null>(null);
  const generation = useRef(0);
  const refreshTimeline = useRef<(() => Promise<void>) | null>(null);
  const [news, setNews] = useState<ReadingListItem[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current); }, []);
  useEffect(() => {
    let active = true;
    const scope = { folderPath: "", includeDescendants: true, dateBasis: "received" as const };
    void fetchReadingPage({ handle: pool.blog.handle, scope: { ...scope, state: "all" }, limit: 30 }).then((articles) => {
      if (!active) return;
      setNews(articles.items.filter((item) => item.origin === "feed").slice(0, 3));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [pool.blog.handle, attempt]);

  useEffect(() => {
    const current = ++generation.current;
    const selected = filter === "news" ? "all" : filter;
    timelineRef.current = null;
    const refresh = async () => {
      try {
        const page = await fetchWorkspaceTimeline(pool.blog.handle, selected);
        if (current !== generation.current) return;
        setError(false);
        const previous = timelineRef.current;
        if (!previous) {
          timelineRef.current = page;
          setTimeline(page);
        } else if (page.entries.some((entry) => !previous.entries.some((old) => old.id === entry.id && old.at === entry.at))) {
          setPending(page);
        }
      } catch { if (current === generation.current) setError(true); }
    };
    refreshTimeline.current = refresh;
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { generation.current = current + 1; refreshTimeline.current = null; window.removeEventListener("focus", refresh); };
  }, [pool.blog.handle, filter, attempt]);

  const previousCount = useRef(pool.posts.length);
  useEffect(() => {
    if (previousCount.current !== pool.posts.length) {
      previousCount.current = pool.posts.length;
      void refreshTimeline.current?.();
    }
  }, [pool.posts.length]);

  const more = async () => {
    if (!timeline?.nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchWorkspaceTimeline(pool.blog.handle, filter === "news" ? "all" : filter, timeline.nextCursor);
      if (current !== generation.current) return;
      const combined = { ...page, entries: [...new Map([...timeline.entries, ...page.entries].map((entry) => [entry.id, entry])).values()] };
      timelineRef.current = combined;
      setTimeline(combined);
    } catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) setLoadingMore(false); }
  };

  const continued = useMemo(() => pool.posts.filter((post) => history[post.id] > 0)
    .sort((a, b) => history[b.id] - history[a.id]).slice(0, 3), [pool.posts, history]);
  const entries = filter === "news" ? [] : timeline?.entries ?? [];
  const openReading = (item: ReadingListItem) => {
    addPost(poolPostFor(item, pool.blogId));
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => onOpenPost(item.id), 0);
  };
  return <section className="personal-home" aria-label="Home">
    {capture}
    {continued.length > 0 && <section className="personal-home-continue" aria-label="Continue">
      <h2>Continue</h2>
      <div>{continued.map((post) => <button key={post.id} onClick={() => onOpenPost(post.id)}>{post.title || "Untitled"}</button>)}</div>
    </section>}
    <nav className={styles.noteFolders} aria-label="Timeline filters">
      {(["all", "writing", "saved", "news"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => {
        if (value === filter) return;
        setTimeline(null); setPending(null); setLoadingMore(false); setFilter(value);
      }}>{value === "all" ? "Everything" : value === "writing" ? "Writing" : value === "saved" ? "Saved" : "News"}</button>)}
    </nav>
    {(filter === "all" || filter === "news") && <section className="personal-home-news" aria-label="From your feeds">
      <header><h2>From your feeds</h2><button onClick={onNews}>Open News</button></header>
      {news.map((item) => <button className="personal-home-headline" key={item.id} onClick={() => openReading(item)}>{item.title}</button>)}
      {!news.length && !error && <p>Your latest feed articles will appear here.</p>}
    </section>}
    {error && <p role="alert">Could not refresh reading. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    {pending && <button className={styles.back} onClick={() => { timelineRef.current = pending; setTimeline(pending); setPending(null); }}>New items</button>}
    <ul className={styles.noteList}>{entries.map((item, index) => <li key={item.id}>
      {(index === 0 || new Date(entries[index - 1].at).toLocaleDateString() !== new Date(item.at).toLocaleDateString()) && <h2 className="personal-home-date">{new Date(item.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>}
      <button onClick={() => {
        addPost(item.post);
        if (openTimer.current) clearTimeout(openTimer.current);
        openTimer.current = setTimeout(() => onOpenPost(item.post.id), 0);
      }}>
        <span className={styles.noteMeta}>{item.kind === "saved" ? "Saved" : item.kind === "published" ? "Published" : "Created"} · {new Date(item.at).toLocaleDateString()}</span>
        <strong>{item.post.title || "Untitled"}</strong>
        {item.post.excerpt && <span className={styles.notePreview}>{plainTextExcerpt(item.post.excerpt)}</span>}
      </button>
    </li>)}</ul>
    {filter !== "news" && timeline?.nextCursor && <button className={styles.back} disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Loading…" : "More items"}</button>}
    {!entries.length && filter !== "news" && <p className={styles.empty}>{timeline ? "Your writing and saved reading will appear here." : error ? "Your timeline is unavailable. Try again to reconnect." : "Loading your timeline…"}</p>}
  </section>;
}
