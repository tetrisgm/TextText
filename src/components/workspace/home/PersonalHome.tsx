"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { WorkspaceDocumentOpenHistory } from "@/lib/workspace-activity";
import { plainTextExcerpt } from "@/lib/content";
import { fetchReadingHome, READING_ITEMS_CHANGED, type ReadingItemsChange, type ReadingListItem } from "@/lib/reading/client";
import { addPost } from "@/lib/pool/store";
import { poolPostFor } from "./HomeNews";
import { fetchWorkspaceTimeline, TimelineAccessError } from "@/lib/workspace/timeline-client";
import { reconcileTimeline, type TimelinePage } from "@/lib/workspace/timeline";
import type { HomeSession } from "./session";
import styles from "./Home.module.css";

export function PersonalHome({ pool, history, capture, onOpenPost, onNews, session }: {
  session?: HomeSession;
  pool: WorkspacePoolPayload;
  history: WorkspaceDocumentOpenHistory;
  capture: ReactNode;
  onOpenPost: (id: string) => void;
  onNews: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "writing" | "saved" | "news">(session?.personalFilter ?? "all");
  const [timeline, setTimeline] = useState<TimelinePage | null>(() => session?.getTimeline(filter === "news" ? "all" : filter) ?? null);
  const [pending, setPending] = useState<TimelinePage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const timelineRef = useRef<TimelinePage | null>(null);
  const generation = useRef(0);
  const refreshTimeline = useRef<(() => Promise<void>) | null>(null);
  const [news, setNews] = useState<ReadingListItem[]>(session?.personalNews ?? []);
  const [error, setError] = useState(false);
  const [accessDenied, setAccessDenied] = useState(session?.accessDenied ?? false);
  const denied = useRef(session?.accessDenied ?? false);
  const [newsError, setNewsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pendingOpen = useRef<string | null>(null);
  const [openTick, setOpenTick] = useState(0);
  const invalidateAccess = useCallback(() => {
    denied.current = true;
    generation.current += 1;
    session?.setAccessDenied(true);
    timelineRef.current = null;
    setTimeline(null);
    setPending(null);
    setNews([]);
    pendingOpen.current = null;
    setLoadingMore(false);
    setAccessDenied(true);
  }, [session]);
  useEffect(() => {
    const id = pendingOpen.current;
    if (!id || !pool.posts.some((post) => post.id === id)) return;
    pendingOpen.current = null;
    onOpenPost(id);
  }, [openTick, pool.posts, onOpenPost]);
  useEffect(() => {
    if (accessDenied) return;
    let active = true;
    void fetchReadingHome({ handle: pool.blog.handle, mode: "latest", topic: null, limit: 3 }).then((articles) => {
      if (!active || denied.current) return;
      const next = articles.units.flatMap((unit) => unit.kind === "article" ? [unit.item] : []).slice(0, 3);
      if (session) session.personalNews = next;
      setNews(next);
      setNewsError(false);
    }).catch(() => { if (active) setNewsError(true); });
    return () => { active = false; };
  }, [pool.blog.handle, attempt, session, accessDenied]);

  useEffect(() => {
    const current = ++generation.current;
    const selected = filter === "news" ? "all" : filter;
    timelineRef.current = session?.getTimeline(selected) ?? null;
    let refreshRequest = 0;
    const refresh = async () => {
      const request = ++refreshRequest;
      try {
        const page = await fetchWorkspaceTimeline(pool.blog.handle, selected);
        if (current !== generation.current || request !== refreshRequest) return;
        denied.current = false;
        session?.setAccessDenied(false);
        setAccessDenied(false);
        setError(false);
        const previous = timelineRef.current;
        if (!previous) {
          timelineRef.current = page;
          session?.saveTimeline(selected, page);
          setTimeline(page);
        } else {
          const refreshed = reconcileTimeline(previous, page);
          timelineRef.current = refreshed.visible;
          session?.saveTimeline(selected, refreshed.visible);
          setTimeline(refreshed.visible);
          setPending(refreshed.pending);
        }
      } catch (failure) {
        if (current !== generation.current || request !== refreshRequest) return;
        if (failure instanceof TimelineAccessError) {
          invalidateAccess();
        }
        setError(true);
      }
    };
    refreshTimeline.current = refresh;
    void refresh();
    const savedChanged = (event: Event) => {
      const change = (event as CustomEvent<ReadingItemsChange>).detail;
      if (change.handle === pool.blog.handle && change.keep !== undefined) void refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener(READING_ITEMS_CHANGED, savedChanged);
    return () => { generation.current = current + 1; refreshTimeline.current = null; window.removeEventListener("focus", refresh); window.removeEventListener(READING_ITEMS_CHANGED, savedChanged); };
  }, [pool.blog.handle, filter, attempt, session, invalidateAccess]);

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
      if (current !== generation.current || denied.current) return;
      const combined = { ...page, entries: [...new Map([...timeline.entries, ...page.entries].map((entry) => [entry.id, entry])).values()] };
      timelineRef.current = combined;
      session?.saveTimeline(filter === "news" ? "all" : filter, combined);
      setTimeline(combined);
    } catch (failure) {
      if (current !== generation.current) return;
      if (failure instanceof TimelineAccessError) invalidateAccess();
      setError(true);
    }
    finally { if (current === generation.current) setLoadingMore(false); }
  };

  const continued = useMemo(() => pool.posts.filter((post) => history[post.id] > 0)
    .sort((a, b) => history[b.id] - history[a.id]).slice(0, 3), [pool.posts, history]);
  const entries = filter === "news" ? [] : timeline?.entries ?? [];
  const openReading = (item: ReadingListItem) => {
    addPost(poolPostFor(item, pool.blogId));
    pendingOpen.current = item.id;
    setOpenTick((value) => value + 1);
  };
  if (accessDenied) return <section className="personal-home" aria-label="Home">
    <p role="alert">Workspace access is unavailable. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>
  </section>;
  return <section className="personal-home" aria-label="Home">
    {capture}
    {continued.length > 0 && <section className="personal-home-continue" aria-label="Continue">
      <h2>Continue</h2>
      <div>{continued.map((post) => <button key={post.id} onClick={() => onOpenPost(post.id)}>{post.title || "Untitled"}</button>)}</div>
    </section>}
    <nav className={styles.noteFolders} aria-label="Timeline filters">
      {(["all", "writing", "saved", "news"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => {
        if (value === filter) return;
        if (session) session.personalFilter = value;
        setTimeline(session?.getTimeline(value === "news" ? "all" : value) ?? null); setPending(null); setLoadingMore(false); setFilter(value);
      }}>{value === "all" ? "Everything" : value === "writing" ? "Writing" : value === "saved" ? "Saved" : "News"}</button>)}
    </nav>
    {(filter === "all" || filter === "news") && <section className="personal-home-news" aria-label="From your feeds">
      <header><h2>From your feeds</h2><button onClick={onNews}>Open News</button></header>
      {news.map((item) => <button className="personal-home-headline" key={item.id} onClick={() => openReading(item)}>{item.title}</button>)}
      {!news.length && !newsError && <p>Your latest feed articles will appear here.</p>}
      {newsError && <p role="alert">Could not refresh your feeds. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    </section>}
    {error && <p role="alert">Could not refresh reading. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    {pending && <button className={styles.back} onClick={() => { timelineRef.current = pending; session?.saveTimeline(filter === "news" ? "all" : filter, pending); setTimeline(pending); setPending(null); }}>New items</button>}
    <ul className={styles.noteList}>{entries.map((item, index) => <li key={item.id}>
      {(index === 0 || new Date(entries[index - 1].at).toLocaleDateString() !== new Date(item.at).toLocaleDateString()) && <h2 className="personal-home-date">{new Date(item.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>}
      <button onClick={() => {
        addPost(item.post);
        pendingOpen.current = item.post.id;
        setOpenTick((value) => value + 1);
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
