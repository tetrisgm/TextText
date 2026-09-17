"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";
import { addPost } from "@/lib/pool/store";
import { fetchReadingPage, type ReadingListItem } from "@/lib/reading/client";
import { publisherFor } from "./publisher";
import styles from "./Home.module.css";

/**
 * The dashboard rail: what is in the workspace, and what the person was last
 * doing in it.
 *
 * Three panels, in the order a command centre answers questions. Collections
 * says what the workspace holds, as bars whose length is the count, because a
 * number in a list is read and a bar is seen. Your desk is the last few things
 * written or saved. Kept to read is the articles deliberately held back,
 * which is the one queue a news surface owes its reader.
 */

const KIND_LABEL: Record<string, string> = { note: "Note", article: "Draft", bookmark: "Bookmark", media_post: "Post", video_post: "Post" };
/** Own work gets a flat tone per kind; a feed item gets its publisher's. */
const KIND_TONE: Record<string, string> = {
  note: "#3a2ce0",
  article: "#0b7a5a",
  bookmark: "#a3521a",
  media_post: "#7a2c8f",
  video_post: "#7a2c8f",
  Published: "#0b7a5a",
};

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

type Row = {
  id: string;
  title: string;
  kind: string;
  at: string | undefined;
  mark: { initials: string; color: string };
  open: () => void;
};

function RailRows({ rows, now, empty }: { rows: Row[]; now: number; empty: string }) {
  if (rows.length === 0) return <p className={styles.recentEmpty}>{empty}</p>;
  return (
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
          <span className={styles.mark} style={{ ["--mark-bg" as string]: row.mark.color }} aria-hidden="true">
            {row.mark.initials}
          </span>
          <span>
            <span className={styles.recentTitle}>{row.title}</span>
            <span className={styles.recentMeta}>
              <b>{row.kind}</b>
              <span>{relativeTime(row.at, now)}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HomeRecent({
  pool,
  recent,
  onOpenPost,
  onShowAll,
  onOpenSection,
}: {
  pool: WorkspacePoolPayload;
  /** Already sorted by the library's own recent order. */
  recent: WorkspacePoolPost[];
  onOpenPost: (postId: string) => void;
  onShowAll: () => void;
  onOpenSection?: (folderPath: string) => void;
}) {
  const [kept, setKept] = useState<ReadingListItem[]>([]);
  // Set once the kept items arrive, never during render.
  const [now, setNow] = useState(0);
  const limit = 5;

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

  const desk = useMemo<Row[]>(
    () =>
      recent.slice(0, limit).map((post) => {
        const kind = post.status === "published" && post.type === "article" ? "Published" : KIND_LABEL[post.type] ?? "Item";
        return {
          id: post.id,
          title: post.title || "Untitled",
          kind,
          at: post.updatedAt,
          mark: { initials: kind.slice(0, 1), color: KIND_TONE[post.type] ?? KIND_TONE[kind] ?? "#55565c" },
          open: () => onOpenPost(post.id),
        };
      }),
    [limit, onOpenPost, recent],
  );

  const keptRows = useMemo<Row[]>(
    () =>
      kept.slice(0, limit).map((item) => {
        const publisher = publisherFor(item);
        return {
          id: item.id,
          title: item.title,
          kind: publisher.name,
          at: item.receivedAt,
          mark: { initials: publisher.initials, color: publisher.color },
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
        };
      }),
    [kept, limit, onOpenPost, pool.blogId],
  );

  // Collections, largest first. The bar is the share of the biggest one, so
  // the panel reads as a shape before it reads as numbers.
  const collections = useMemo(() => {
    // Counts are per exact folder, so a collection's own number is itself plus
    // everything filed under it: a feed's folder belongs to Bookmarks.
    const rows = pool.folders
      .filter((folder) => !folder.path.includes("/"))
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        count: Object.entries(pool.counts).reduce(
          (total, [path, count]) => (path === folder.path || path.startsWith(`${folder.path}/`) ? total + count : total),
          0,
        ),
      }))
      .filter((folder) => folder.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
    const largest = rows[0]?.count ?? 1;
    return rows.map((row) => ({ ...row, share: Math.max(8, Math.round((row.count / largest) * 100)) }));
  }, [pool.counts, pool.folders]);

  return (
    <aside className={`applecms ${styles.recent}`} aria-label="Workspace">
      {collections.length > 0 && (
        <div className={styles.railCard} data-tone="indigo">
          <div className={styles.railHead}>
            <h2>Collections</h2>
            <button type="button" onClick={onShowAll}>
              All items
            </button>
          </div>
          <ul className={styles.bars}>
            {collections.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  className={styles.bar}
                  style={{ ["--bar" as string]: `${folder.share}%` }}
                  onClick={() => (onOpenSection ? onOpenSection(folder.path) : onShowAll())}
                >
                  <span className={styles.barFill} aria-hidden="true" />
                  <span className={styles.barLabel}>{folder.name}</span>
                  <span className={styles.barCount}>{folder.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className={styles.railSection}>
        <header className={styles.recentHeader}>
          <h2>Your desk</h2>
          <button type="button" onClick={onShowAll}>
            All items
          </button>
        </header>
        <RailRows rows={desk} now={now} empty="Nothing yet. Capture a thought and it lands here." />
      </section>
      {keptRows.length > 0 && (
        <section className={styles.railSection}>
          <header className={styles.recentHeader}>
            <h2>Kept to read</h2>
          </header>
          <RailRows rows={keptRows} now={now} empty="" />
        </section>
      )}
    </aside>
  );
}
