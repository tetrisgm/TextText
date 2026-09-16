"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/components/keyboard/typing-target";
import type { Blog } from "@/lib/content";
import { acknowledgePostDocument, addPost } from "@/lib/pool/store";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { blogWorkspacePostPath } from "@/lib/public-paths";
import { extractReadingItem, fetchReadingNeighbors, setReadingItemsRead, type ReadingListItem } from "@/lib/reading/client";
import styles from "./Reading.module.css";

/**
 * Inside an open article: the newer and older article in its folder, one
 * key each (p and n, or k and j), and a way to load the whole original when
 * the feed sent a teaser. Neighbours come from the reading list on the
 * server, so opening an article never loads its folder.
 */

function poolPostFor(item: ReadingListItem, blogId: string): WorkspacePoolPost {
  return {
    id: item.id,
    blogId,
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
  };
}

export function ReadingReaderBar({
  blog,
  blogId,
  postId,
  canManage,
  onNavigate,
  onReload,
}: {
  blog: Blog;
  blogId: string;
  postId: string;
  canManage: boolean;
  onNavigate: (path: string) => Promise<void> | void;
  onReload: () => void;
}) {
  type Neighbors = { previous: ReadingListItem | null; next: ReadingListItem | null; current: ReadingListItem | null };
  // Keyed by the article so a stale answer never shows for the next one.
  const [loaded, setLoaded] = useState<{ postId: string; neighbors: Neighbors } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [noticeState, setNoticeState] = useState<{ postId: string; text: string } | null>(null);
  const pendingPath = useRef<string | null>(null);
  // The shell's navigate closes over its pool snapshot; after addPost the
  // shell re-renders with a new one, and the timeout below must call that.
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  const neighbors = loaded?.postId === postId ? loaded.neighbors : null;
  const notice = noticeState?.postId === postId ? noticeState.text : null;
  const setNotice = useCallback((text: string | null) => setNoticeState(text ? { postId, text } : null), [postId]);
  const setNeighbors = useCallback(
    (update: (current: Neighbors | null) => Neighbors | null) =>
      setLoaded((current) => {
        const next = update(current?.postId === postId ? current.neighbors : null);
        return next ? { postId, neighbors: next } : null;
      }),
    [postId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchReadingNeighbors(blog.handle, postId)
      .then((result) => {
        if (!cancelled) setLoaded({ postId, neighbors: result });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [blog.handle, postId]);

  const go = useCallback(
    (item: ReadingListItem | null) => {
      if (!item) return;
      addPost(poolPostFor(item, blogId));
      if (!item.read) void setReadingItemsRead(blog.handle, [item.id], true).catch(() => undefined);
      const path = blogWorkspacePostPath(blog, item.folderPath, { slug: item.slug });
      pendingPath.current = path;
      // The shell resolves the path against its pool, which re-renders on
      // the next tick after addPost; a microtask is too early and lands on
      // the workspace root.
      window.setTimeout(() => {
        if (pendingPath.current === path) {
          pendingPath.current = null;
          void onNavigateRef.current(path);
        }
      }, 0);
    },
    [blog, blogId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "n" || event.key === "j") {
        event.preventDefault();
        go(neighbors?.next ?? null);
      } else if (event.key === "p" || event.key === "k") {
        event.preventDefault();
        go(neighbors?.previous ?? null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, neighbors]);

  const extract = useCallback(async () => {
    setLoading("extract");
    setNotice(null);
    try {
      const result = await extractReadingItem(blog.handle, postId);
      if (result.outcome === "applied") {
        setNotice("Loaded the full article.");
        // Take the saved document straight into the reader's cache; a plain
        // refetch can be skipped as "already ready" by the store.
        try {
          const payload = (await fetch(`/api/post/${encodeURIComponent(postId)}/body`, { credentials: "same-origin", headers: { Accept: "application/json" } }).then((response) => response.json())) as {
            document?: Parameters<typeof acknowledgePostDocument>[2];
            revision?: number;
            updatedAt?: string;
          };
          if (payload.document) acknowledgePostDocument(blogId, postId, payload.document, payload.revision, payload.updatedAt);
          else onReload();
        } catch {
          onReload();
        }
        setNeighbors((current) => (current?.current ? { ...current, current: { ...current.current, availability: "full" } } : current));
      } else if (result.outcome === "recorded") {
        setNotice("The full text was saved as a source version; your edits stay as they are.");
      } else {
        setNotice(
          result.reason === "no_link"
            ? "This article has no original link."
            : result.reason === "unreachable"
              ? "The original page could not be fetched."
              : "The page did not read as an article.",
        );
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load the article");
    } finally {
      setLoading(null);
    }
  }, [blog.handle, blogId, onReload, postId]);

  const current = neighbors?.current ?? null;
  return (
    <div className={`applecms ${styles.readerBar}`} role="navigation" aria-label="Reading">
      <button type="button" className={styles.button} disabled={!neighbors?.previous} onClick={() => go(neighbors?.previous ?? null)} title="Newer article (p)">
        ← Newer
      </button>
      <button type="button" className={styles.button} disabled={!neighbors?.next} onClick={() => go(neighbors?.next ?? null)} title="Older article (n)">
        Older →
      </button>
      <span className={styles.spacer} />
      {notice && <span className={styles.note}>{notice}</span>}
      {current && current.availability !== "full" && canManage && (
        <button type="button" className={styles.button} disabled={loading === "extract"} onClick={() => void extract()}>
          {loading === "extract" ? "Loading…" : "Load full article"}
        </button>
      )}
      {current?.permalink && (
        <a className={styles.button} href={current.permalink} target="_blank" rel="noopener noreferrer" title="Open the original (v)">
          Original ↗
        </a>
      )}
    </div>
  );
}
