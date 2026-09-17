"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";
import { addPost } from "@/lib/pool/store";
import { fetchReadingPage, type ReadingListItem } from "@/lib/reading/client";
import styles from "./Home.module.css";

/**
 * What the person was working on: the last few items they authored or
 * saved, plus articles they deliberately kept. Imports never appear here;
 * a kept article is the same bookmark-kind item, fetched through one
 * bounded server query rather than the client pool.
 */

const KIND_LABEL: Record<string, string> = { note: "Note", article: "Draft", bookmark: "Bookmark", media_post: "Post", video_post: "Post" };

function relativeTime(iso: string | undefined, now: number): string {
  if (!iso || !now) return "";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString();
}

type Row = { id: string; title: string; kind: string; at: string | undefined; open: () => void };

export function HomeRecent({
  pool,
  recent,
  onOpenPost,
  onShowAll,
}: {
  pool: WorkspacePoolPayload;
  /** Already sorted by the library's own recent order. */
  recent: WorkspacePoolPost[];
  onOpenPost: (postId: string) => void;
  onShowAll: () => void;
}) {
  const [kept, setKept] = useState<ReadingListItem[]>([]);
  // Set once the kept items arrive, never during render.
  const [now, setNow] = useState(0);
  const limit = 6;

  useEffect(() => {
    let cancelled = false;
    void fetchReadingPage({ handle: pool.blog.handle, scope: { folderPath: "", includeDescendants: true, state: "kept", dateBasis: "received" }, limit: 6 })
      .then((page) => {
        if (cancelled) return;
        setKept(page.items.filter((item) => item.origin === "feed"));
        setNow(Date.now());
      })
      .catch(() => {
        if (!cancelled) setNow(Date.now());
      });
    return () => {
      cancelled = true;
    };
  }, [pool.blog.handle]);

  const rows = useMemo<Row[]>(() => {
    const own: Row[] = recent.map((post) => ({
      id: post.id,
      title: post.title || "Untitled",
      kind: post.status === "published" && post.type === "article" ? "Published" : KIND_LABEL[post.type] ?? "Item",
      at: post.updatedAt,
      open: () => onOpenPost(post.id),
    }));
    const keptRows: Row[] = kept.map((item) => ({
      id: item.id,
      title: item.title,
      kind: "Kept article",
      at: item.receivedAt,
      open: () => {
        addPost({
          id: item.id,
          blogId: pool.blogId,
          folderId: item.folderId,
          type: "bookmark",
          slug: item.slug,
          title: item.title,
          excerpt: item.excerpt ?? undefined,
          status: "draft",
          visibility: "private",
          template: { id: "texttext.bookmark", version: 1 },
          starred: item.starred,
          createdAt: item.receivedAt,
          updatedAt: item.receivedAt,
          origin: item.origin,
        });
        // The pool now holds it; the shell's handler sees it on the next tick.
        setTimeout(() => onOpenPost(item.id), 0);
      },
    }));
    const merged = [...own, ...keptRows].sort((left, right) => new Date(right.at ?? 0).getTime() - new Date(left.at ?? 0).getTime());
    return merged.slice(0, limit);
  }, [kept, limit, onOpenPost, pool.blogId, recent]);

  return (
    <aside className={`applecms ${styles.recent}`} aria-label="Recent">
      <header className={styles.recentHeader}>
        <h2>Recent</h2>
        <button type="button" onClick={onShowAll}>
          All items
        </button>
      </header>
      {rows.length === 0 ? (
        <p className={styles.recentEmpty}>Nothing yet. Capture a thought or save a link and it lands here.</p>
      ) : (
        <ul className={styles.recentList}>
          {rows.map((row) => (
            <li
              key={row.id}
              className={styles.recentRow}
              tabIndex={0}
              onClick={row.open}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  row.open();
                }
              }}
            >
              <p className={styles.recentTitle}>{row.title}</p>
              <p className={styles.recentMeta}>
                <b>{row.kind}</b>
                <span>{relativeTime(row.at, now)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
