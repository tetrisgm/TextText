"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/components/keyboard/typing-target";
import type { Blog } from "@/lib/content";
import { acknowledgePostDocument, addPost } from "@/lib/pool/store";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { blogWorkspacePostPath, blogWorkspacePostEditPath } from "@/lib/public-paths";
import { extractReadingItem, fetchReadingNeighbors, setReadingItemsRead, setReadingItemsKept, type ReadingListItem } from "@/lib/reading/client";
import { ArtifactIcon } from "@/components/workspace/home/ArtifactNavigation";

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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [fontSize, setFontSize] = useState(17);
  const [saving, setSaving] = useState(false);
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
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let stored = 17;
      try { stored = Number(localStorage.getItem("texttext:reader-size")) || 17; } catch { /* Session size remains available. */ }
      const next = Math.min(25, Math.max(14, stored));
      setFontSize(next);
      document.querySelector<HTMLElement>(".artifact-workspace")?.style.setProperty("--artifact-reading-size", `${next}px`);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const changeFontSize = (delta: number) => {
    const next = Math.min(25, Math.max(14, fontSize + delta));
    setFontSize(next);
    try { localStorage.setItem("texttext:reader-size", String(next)); } catch { /* Storage is optional. */ }
    document.querySelector<HTMLElement>(".artifact-workspace")?.style.setProperty("--artifact-reading-size", `${next}px`);
  };
  const keep = async () => {
    if (!current || saving) return;
    setSaving(true);
    const kept = !current.keptReasons.includes("keep");
    try {
      await setReadingItemsKept(blog.handle, [current.id], kept);
      setNeighbors((value) => value?.current ? { ...value, current: { ...value.current, keptReasons: kept ? [...value.current.keptReasons, "keep"] : value.current.keptReasons.filter((reason) => reason !== "keep") } } : value);
    } catch { setNotice("Could not update Read Later. Try again."); }
    finally { setSaving(false); }
  };
  return (
    <nav className="artifact-reader-bar" aria-label="Reading">
      <button type="button" aria-label="Back to feed" onClick={() => {
        if (window.history.length > 1) window.history.back();
        else void onNavigate(`/t/${blog.handle}`);
      }}>‹</button>
      <button type="button" aria-label="Share article" onClick={() => {
        const url = current?.permalink ?? current?.externalUrl ?? window.location.href;
        void navigator.clipboard.writeText(url).then(() => setNotice("Link copied")).catch(() => setNotice("Could not copy the link."));
      }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 10v11h14V10M12 15V2m-5 5 5-5 5 5" /></svg></button>
      <button type="button" aria-label="Read Later" aria-pressed={current?.keptReasons.includes("keep") ?? false} disabled={!current || saving} onClick={() => void keep()}><ArtifactIcon name="bookmark" /></button>
      <button type="button" aria-label="Text options" aria-expanded={optionsOpen} onClick={() => { setNotice(null); setOptionsOpen((open) => !open); }}>Aa</button>
      {notice && <p className="artifact-reader-notice" role="status">{notice}</p>}
      {optionsOpen && <div className="artifact-reader-options" role="group" aria-label="Text options" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOptionsOpen(false); } }}>
        <button type="button" disabled={fontSize >= 25} onClick={() => changeFontSize(1)}>Increase font size</button>
        <button type="button" disabled={fontSize <= 14} onClick={() => changeFontSize(-1)}>Decrease font size</button>
        {current && canManage && <button type="button" onClick={() => void onNavigate(blogWorkspacePostEditPath(blog, current.folderPath, current))}>Edit article</button>}
        {current?.permalink && <a href={current.permalink} target="_blank" rel="noopener noreferrer">Open original</a>}
        {current && current.availability !== "full" && canManage && <button type="button" disabled={loading === "extract"} onClick={() => void extract()}>{loading === "extract" ? "Loading…" : "Load full article"}</button>}
        <button type="button" disabled={!neighbors?.previous} onClick={() => { setOptionsOpen(false); go(neighbors?.previous ?? null); }}>Newer article</button>
        <button type="button" disabled={!neighbors?.next} onClick={() => { setOptionsOpen(false); go(neighbors?.next ?? null); }}>Older article</button>
      </div>}
    </nav>
  );
}
