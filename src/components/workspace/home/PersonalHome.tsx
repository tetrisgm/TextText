"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { WorkspaceDocumentOpenHistory } from "@/lib/workspace-activity";
import { plainTextExcerpt } from "@/lib/content";
import { fetchReadingPage, type ReadingListItem } from "@/lib/reading/client";
import { addPost } from "@/lib/pool/store";
import { poolPostFor } from "./HomeNews";
import styles from "./Home.module.css";

export function PersonalHome({ pool, history, capture, onOpenPost, onNews }: {
  pool: WorkspacePoolPayload;
  history: WorkspaceDocumentOpenHistory;
  capture: ReactNode;
  onOpenPost: (id: string) => void;
  onNews: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "writing" | "saved" | "news">("all");
  const [saved, setSaved] = useState<ReadingListItem[]>([]);
  const [news, setNews] = useState<ReadingListItem[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current); }, []);
  useEffect(() => {
    let active = true;
    const scope = { folderPath: "", includeDescendants: true, dateBasis: "received" as const };
    void Promise.all([
      fetchReadingPage({ handle: pool.blog.handle, scope: { ...scope, state: "bookmarked" }, limit: 30 }),
      fetchReadingPage({ handle: pool.blog.handle, scope: { ...scope, state: "all" }, limit: 30 }),
    ]).then(([bookmarks, articles]) => {
      if (!active) return;
      setSaved(bookmarks.items);
      setNews(articles.items.filter((item) => item.origin === "feed").slice(0, 3));
      setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [pool.blog.handle, attempt]);

  const continued = useMemo(() => pool.posts.filter((post) => history[post.id] > 0)
    .sort((a, b) => history[b.id] - history[a.id]).slice(0, 3), [pool.posts, history]);
  const entries = useMemo(() => {
    const manual = pool.posts.filter((post) => post.origin !== "feed").map((post) => ({
      id: post.id, title: post.title, excerpt: post.excerpt || post.bodyPreview,
      at: post.createdAt, kind: post.type === "bookmark" ? "saved" : "writing",
      image: post.cover, reading: undefined as ReadingListItem | undefined,
    }));
    const byId = new Map(manual.map((item) => [item.id, item]));
    for (const item of saved) if (!byId.has(item.id)) byId.set(item.id, {
      id: item.id, title: item.title, excerpt: item.excerpt ?? undefined,
      at: item.receivedAt, kind: "saved", image: item.imageUrl ?? undefined, reading: item,
    });
    return [...byId.values()].filter((item) => filter === "all" || item.kind === filter)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || a.id.localeCompare(b.id));
  }, [pool.posts, saved, filter]);
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
      {(["all", "writing", "saved", "news"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "Everything" : value === "writing" ? "Writing" : value === "saved" ? "Saved" : "News"}</button>)}
    </nav>
    {(filter === "all" || filter === "news") && <section className="personal-home-news" aria-label="From your feeds">
      <header><h2>From your feeds</h2><button onClick={onNews}>Open News</button></header>
      {news.map((item) => <button className="personal-home-headline" key={item.id} onClick={() => openReading(item)}>{item.title}</button>)}
      {!news.length && !error && <p>Your latest feed articles will appear here.</p>}
    </section>}
    {error && <p role="alert">Could not refresh reading. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    <ul className={styles.noteList}>{entries.slice(0, 60).map((item) => <li key={item.id}>
      <button onClick={() => item.reading ? openReading(item.reading) : onOpenPost(item.id)}>
        <span className={styles.noteMeta}>{item.kind === "saved" ? "Saved" : "Writing"}{item.at ? ` · ${new Date(item.at).toLocaleDateString()}` : ""}</span>
        <strong>{item.title || "Untitled"}</strong>
        {item.excerpt && <span className={styles.notePreview}>{plainTextExcerpt(item.excerpt)}</span>}
      </button>
    </li>)}</ul>
    {!entries.length && filter !== "news" && <p className={styles.empty}>Your writing and saved reading will appear here.</p>}
  </section>;
}
