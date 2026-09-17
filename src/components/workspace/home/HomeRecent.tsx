"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";
import { addPost } from "@/lib/pool/store";
import { fetchReadingPage, type ReadingListItem } from "@/lib/reading/client";
import { publisherFor } from "./publisher";
import styles from "./Home.module.css";

/**
 * Recent: one short, quiet route back to what the person was last doing.
 *
 * A secondary region beside the news, not a second dashboard. The workspace's
 * own organisation already lives in the sidebar, so nothing here repeats
 * folders or their counts; the only navigation it adds is the single way into
 * the whole library.
 *
 * A deliberately kept article belongs here, through the same bounded query the
 * reading list uses. An automatic feed import does not: it is not the person's
 * work, and it would push their notes off a five row list within minutes of
 * any feed arriving.
 */

const KIND_LABEL: Record<string, string> = { note: "Note", article: "Draft", bookmark: "Bookmark", media_post: "Post", video_post: "Post" };
/** Own work takes a flat tone per kind; a kept article takes its publisher's. */
const KIND_TONE: Record<string, string> = {
  note: "#2c18ac",
  article: "#0f5c4a",
  bookmark: "#8a3a00",
  media_post: "#6a2b8f",
  video_post: "#6a2b8f",
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

  const rows = useMemo<Row[]>(() => {
    const own: Row[] = recent.map((post) => {
      const kind = post.status === "published" && post.type === "article" ? "Published" : KIND_LABEL[post.type] ?? "Item";
      return {
        id: post.id,
        title: post.title || "Untitled",
        kind,
        at: post.updatedAt,
        mark: { initials: kind.slice(0, 1), color: KIND_TONE[post.type] ?? "#2f4858" },
        open: () => onOpenPost(post.id),
      };
    });
    const keptRows: Row[] = kept.map((item) => {
      const publisher = publisherFor(item);
      return {
        id: item.id,
        title: item.title,
        kind: `Kept, ${publisher.name}`,
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
    });
    return [...own, ...keptRows]
      .sort((left, right) => new Date(right.at ?? 0).getTime() - new Date(left.at ?? 0).getTime())
      .slice(0, limit);
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
      )}
    </aside>
  );
}
