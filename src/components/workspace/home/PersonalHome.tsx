"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { plainTextExcerpt } from "@/lib/content";
import { READING_ITEMS_CHANGED, type ReadingItemsChange } from "@/lib/reading/client";
import { addPost } from "@/lib/pool/store";
import { fetchWorkspaceTimeline, refreshWorkspaceTimeline, TimelineAccessError } from "@/lib/workspace/timeline-client";
import { reconcileTimeline, type TimelinePage } from "@/lib/workspace/timeline";
import type { HomeSession } from "./session";
import styles from "./Home.module.css";

export function PersonalHome({ pool, capture, onOpenPost, session }: {
  session?: HomeSession;
  pool: WorkspacePoolPayload;
  capture: ReactNode;
  onOpenPost: (id: string) => void;
}) {
  const [timeline, setTimeline] = useState<TimelinePage | null>(() => session?.getTimeline("all") ?? null);
  const [pending, setPending] = useState<TimelinePage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const timelineRef = useRef<TimelinePage | null>(null);
  const generation = useRef(0);
  const timelineRevision = useRef(0);
  const refreshTimeline = useRef<(() => Promise<void>) | null>(null);
  const [error, setError] = useState(false);
  const [accessDenied, setAccessDenied] = useState(session?.accessDenied ?? false);
  const denied = useRef(session?.accessDenied ?? false);
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
    const current = ++generation.current;
    timelineRef.current = session?.getTimeline("all") ?? null;
    let refreshRequest = 0;
    const refresh = async () => {
      const request = ++refreshRequest;
      try {
        const page = await refreshWorkspaceTimeline(pool.blog.handle, "all", timelineRef.current);
        if (current !== generation.current || request !== refreshRequest) return;
        denied.current = false;
        session?.setAccessDenied(false);
        setAccessDenied(false);
        setError(false);
        timelineRevision.current += 1;
        const previous = timelineRef.current;
        if (!previous) {
          timelineRef.current = page;
          session?.saveTimeline("all", page);
          setTimeline(page);
        } else {
          const refreshed = reconcileTimeline(previous, page, true);
          timelineRef.current = refreshed.visible;
          session?.saveTimeline("all", refreshed.visible);
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
  }, [pool.blog.handle, attempt, session, invalidateAccess]);

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
    const revision = timelineRevision.current;
    setLoadingMore(true);
    try {
      const page = await fetchWorkspaceTimeline(pool.blog.handle, "all", timeline.nextCursor);
      if (current !== generation.current || revision !== timelineRevision.current || denied.current) return;
      const combined = { ...page, entries: [...new Map([...timeline.entries, ...page.entries].map((entry) => [entry.id, entry])).values()] };
      timelineRef.current = combined;
      session?.saveTimeline("all", combined);
      setTimeline(combined);
    } catch (failure) {
      if (current !== generation.current) return;
      if (failure instanceof TimelineAccessError) invalidateAccess();
      setError(true);
    }
    finally { if (current === generation.current) setLoadingMore(false); }
  };

  const entries = timeline?.entries ?? [];
  if (accessDenied) return <section className="personal-home" aria-label="Home">
    <p role="alert">Workspace access is unavailable. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>
  </section>;
  return <section className="personal-home" aria-label="Home" data-scroll-restore-pending={!timeline && !error}>
    <h1>All items</h1>
    {capture}
    {error && <p role="alert">Could not refresh reading. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    {pending && <button className={styles.back} onClick={() => { timelineRef.current = pending; session?.saveTimeline("all", pending); setTimeline(pending); setPending(null); }}>New items</button>}
    <ul className={styles.noteList}>{entries.map((item, index) => <li key={item.id}>
      {(index === 0 || new Date(entries[index - 1].at).toLocaleDateString() !== new Date(item.at).toLocaleDateString()) && <h2 className="personal-home-date">{new Date(item.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>}
      <button data-return-focus-key={`timeline:${item.id}`} onClick={() => {
        addPost(item.post);
        pendingOpen.current = item.post.id;
        setOpenTick((value) => value + 1);
      }}>
        <span className={styles.noteMeta}>{item.kind === "saved" ? "Saved" : item.kind === "published" ? "Published" : "Created"} · {new Date(item.at).toLocaleDateString()}</span>
        <strong>{item.post.title || "Untitled"}</strong>
        {item.post.excerpt && <span className={styles.notePreview}>{plainTextExcerpt(item.post.excerpt)}</span>}
      </button>
    </li>)}</ul>
    {timeline?.nextCursor && <button className={styles.back} disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Loading…" : "More items"}</button>}
    {!entries.length && <p className={styles.empty}>{timeline ? "Notes and saved links will appear here." : error ? "Your items are unavailable. Try again to reconnect." : "Loading your items…"}</p>}
  </section>;
}
