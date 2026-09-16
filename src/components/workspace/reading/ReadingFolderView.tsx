"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Blog, Folder, Post } from "@/lib/content";
import { addPost } from "@/lib/pool/store";
import { postFromPoolPost } from "@/lib/pool/selectors";
import type { WorkspacePoolPost, WorkspaceReadingSource } from "@/lib/pool/types";
import {
  fetchReadingPage,
  fetchReadingSummaries,
  markReadingScopeRead,
  setReadingItemsKept,
  setReadingItemsRead,
  tickReading,
  type ReadingFolderSummary,
  type ReadingListItem,
  type ReadingScope,
  type ReadingSummary,
} from "@/lib/reading/client";
import styles from "./Reading.module.css";

/**
 * A folder that follows feeds, or contains folders that do.
 *
 * The list is paged from the server and never the whole corpus. Opening a
 * row merges that one item into the client pool first, so the reader finds
 * it the way it finds any other item, without the pool having to carry every
 * article a workspace follows.
 */

const STALE_AFTER_MS = 30 * 60 * 1000;

const AVAILABILITY_LABEL: Record<ReadingListItem["availability"], string> = {
  full: "Full feed text",
  excerpt: "Feed excerpt",
  metadata: "Link only",
};

function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  };
}

export function readingSourcesUnder(
  sources: WorkspaceReadingSource[] | undefined,
  folderPath: string,
): WorkspaceReadingSource[] {
  if (!sources) return [];
  return sources.filter(
    (source) =>
      source.state !== "detached" &&
      (source.folderPath === folderPath || source.folderPath.startsWith(`${folderPath}/`)),
  );
}

export function ReadingFolderView({
  blog,
  folder,
  handle,
  blogId,
  sources,
  canEdit,
  selectedPostId,
  onOpenPost,
  onSelectPost,
  onAddFeeds,
}: {
  blog: Blog;
  folder: Folder;
  handle: string;
  blogId: string;
  sources: WorkspaceReadingSource[];
  canEdit: boolean;
  selectedPostId?: string | null;
  onOpenPost?: (post: Post) => void;
  onSelectPost?: (postId: string) => void;
  onAddFeeds?: () => void;
}) {
  void blog;
  const [view, setView] = useState<"articles" | "summaries">("articles");
  const [summaries, setSummaries] = useState<{ summaries: Array<ReadingSummary & { text: string | null }>; singles: number; considered: number } | null>(null);
  const [state, setState] = useState<ReadingScope["state"]>("all");
  const [dateBasis, setDateBasis] = useState<ReadingScope["dateBasis"]>("published");
  const scope = useMemo<ReadingScope>(
    () => ({ folderPath: folder.path, includeDescendants: true, state, dateBasis }),
    [dateBasis, folder.path, state],
  );
  const [items, setItems] = useState<ReadingListItem[]>([]);
  const [summary, setSummary] = useState<ReadingFolderSummary | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<ReadingListItem[] | null>(null);
  const generation = useRef(0);
  const tickedFor = useRef<string | null>(null);

  const loadFirstPage = useCallback(
    async (mode: "replace" | "compare") => {
      const mine = ++generation.current;
      if (mode === "replace") {
        setLoading(true);
        setError(null);
      }
      try {
        const page = await fetchReadingPage({ handle, scope, limit: 40 });
        if (mine !== generation.current) return;
        if (page.summary) setSummary(page.summary);
        if (mode === "replace") {
          setItems(page.items);
          setCursor(page.nextCursor);
          setPendingNew(null);
        } else {
          // Never reshuffle a list the person is reading: hold new arrivals
          // behind an affordance until they ask for them.
          const known = new Set(items.map((item) => item.id));
          const fresh = page.items.filter((item) => !known.has(item.id));
          if (fresh.length > 0) setPendingNew(page.items);
        }
      } catch (caught) {
        if (mine !== generation.current) return;
        setError(caught instanceof Error ? caught.message : "Could not load this folder");
      } finally {
        if (mine === generation.current && mode === "replace") setLoading(false);
      }
    },
    [handle, items, scope],
  );

  useEffect(() => {
    // Deferred by a tick so the page load is a subscription to the server,
    // not a synchronous state write inside the effect.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return loadFirstPage("replace");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, scope]);

  // One bounded tick when the folder is opened and its sources look stale.
  // The tick queues due polls and runs a few; the list is compared, not
  // replaced, when something arrives.
  useEffect(() => {
    if (!canEdit || sources.length === 0) return;
    if (tickedFor.current === folder.path) return;
    const newest = sources
      .map((source) => (source.lastSuccessAt ? new Date(source.lastSuccessAt).getTime() : 0))
      .sort((a, b) => b - a)[0];
    if (newest && Date.now() - newest < STALE_AFTER_MS) return;
    tickedFor.current = folder.path;
    void (async () => {
      try {
        // Drain what is queued in a few bounded passes rather than one, so a
        // freshly added feed's import and indexing finish while the folder is
        // open instead of waiting for the next visit.
        let done = 0;
        for (let pass = 0; pass < 4; pass += 1) {
          const result = await tickReading(handle, 3);
          done += result.ran.done;
          if ((result.jobs.queued ?? 0) === 0) break;
        }
        if (done > 0) await loadFirstPage("compare");
      } catch {
        // A failed background check is not an error the folder needs to show.
      }
    })();
  }, [canEdit, folder.path, handle, loadFirstPage, sources]);

  useEffect(() => {
    if (view !== "summaries") return;
    let cancelled = false;
    void fetchReadingSummaries(handle, folder.path)
      .then((result) => {
        if (!cancelled) setSummaries(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not build summaries");
      });
    return () => {
      cancelled = true;
    };
  }, [folder.path, handle, view]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchReadingPage({ handle, scope, cursor, limit: 40 });
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((entry) => entry.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, handle, loadingMore, scope]);

  const refresh = useCallback(async () => {
    if (!canEdit || refreshing) return;
    setRefreshing(true);
    try {
      await tickReading(handle, 5);
      await loadFirstPage("compare");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check for new articles");
    } finally {
      setRefreshing(false);
    }
  }, [canEdit, handle, loadFirstPage, refreshing]);

  // Opening is two steps on purpose. addPost updates the pool store, but the
  // shell's open handler closes over the pool snapshot of its last render;
  // calling it in the same tick finds nothing. The effect runs after the
  // shell has re-rendered against the merged pool, with a fresh handler.
  const pendingOpen = useRef<WorkspacePoolPost | null>(null);
  const patchItem = useCallback((id: string, patch: Partial<ReadingListItem>) => {
    setItems((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);
  const open = useCallback(
    (item: ReadingListItem) => {
      const poolPost = poolPostFor(item, blogId);
      pendingOpen.current = poolPost;
      addPost(poolPost);
      onSelectPost?.(item.id);
      if (!item.read) {
        // Opening is reading. Optimistic, personal, and never in the way of
        // the open itself.
        patchItem(item.id, { read: true });
        setSummary((current) =>
          current && current.unreadCount !== null ? { ...current, unreadCount: Math.max(0, current.unreadCount - 1) } : current,
        );
        void setReadingItemsRead(handle, [item.id], true).catch(() => patchItem(item.id, { read: false }));
      }
    },
    [blogId, handle, onSelectPost, patchItem],
  );
  const toggleKeep = useCallback(
    (item: ReadingListItem) => {
      const keep = !item.keptReasons.includes("keep");
      const reasons = keep ? [...item.keptReasons, "keep"] : item.keptReasons.filter((reason) => reason !== "keep");
      patchItem(item.id, { keptReasons: reasons, kept: item.origin !== "feed" || item.starred || reasons.length > 0 });
      void setReadingItemsKept(handle, [item.id], keep).catch(() =>
        patchItem(item.id, { keptReasons: item.keptReasons, kept: item.kept }),
      );
    },
    [handle, patchItem],
  );
  useEffect(() => {
    const post = pendingOpen.current;
    if (!post) return;
    pendingOpen.current = null;
    onOpenPost?.(postFromPoolPost(post));
  }, [onOpenPost]);

  const showPending = useCallback(() => {
    if (!pendingNew) return;
    setItems(pendingNew);
    setPendingNew(null);
  }, [pendingNew]);

  const newCount = pendingNew
    ? pendingNew.filter((item) => !items.some((entry) => entry.id === item.id)).length
    : 0;
  const unhealthy = summary?.health.filter((entry) => !["healthy", "checking"].includes(entry.health)) ?? [];

  return (
    <div className={`applecms ${styles.view}`} data-reading-folder={folder.path}>
      <p className={styles.meta}>
        {summary ? (
          <>
            <span>
              <strong>{summary.sourceCount}</strong> {summary.sourceCount === 1 ? "source" : "sources"}
            </span>
            <span>
              <strong>{summary.itemCount}</strong> {summary.itemCount === 1 ? "article" : "articles"}
            </span>
            {summary.unreadCount !== null && (
              <span>
                <strong>{summary.unreadCount}</strong> unread
              </span>
            )}
            {summary.lastSuccessAt && <span>Checked {relativeTime(summary.lastSuccessAt)}</span>}
            {unhealthy.length > 0 && (
              <span className={styles.health} title={unhealthy.map((entry) => `${entry.folderPath}: ${entry.detail ?? entry.health}`).join("\n")}>
                <span className={styles.healthDot} data-health={unhealthy[0].health} aria-hidden="true" />
                {unhealthy.length === 1 ? "1 source needs attention" : `${unhealthy.length} sources need attention`}
              </span>
            )}
          </>
        ) : (
          <span>Loading…</span>
        )}
      </p>

      <div className={styles.controls} role="toolbar" aria-label="Reading view">
        <div className={styles.segment} role="group" aria-label="View">
          <button type="button" aria-pressed={view === "articles"} onClick={() => setView("articles")}>
            Articles
          </button>
          <button type="button" aria-pressed={view === "summaries"} onClick={() => setView("summaries")}>
            Summaries
          </button>
        </div>
        <div className={styles.segment} role="group" aria-label="Show">
          {(["all", "unread", "kept"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={state === option} onClick={() => setState(option)}>
              {option === "all" ? "All" : option === "unread" ? "Unread" : "Kept"}
            </button>
          ))}
        </div>
        <div className={styles.segment} role="group" aria-label="Order">
          <button type="button" aria-pressed={dateBasis === "published"} onClick={() => setDateBasis("published")}>
            Published
          </button>
          <button type="button" aria-pressed={dateBasis === "received"} onClick={() => setDateBasis("received")}>
            Received
          </button>
        </div>
        <span className={styles.spacer} />
        {summary && summary.unreadCount !== null && summary.unreadCount > 0 && (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              void markReadingScopeRead(handle, folder.path)
                .then(() => {
                  setItems((current) => current.map((item) => ({ ...item, read: true })));
                  setSummary((current) => (current ? { ...current, unreadCount: 0 } : current));
                })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not mark as read"));
            }}
          >
            Mark all read
          </button>
        )}
        {canEdit && (
          <button type="button" className={styles.button} onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Checking…" : "Refresh"}
          </button>
        )}
        {canEdit && onAddFeeds && (
          <button type="button" className={styles.primary} onClick={onAddFeeds}>
            Add feeds
          </button>
        )}
      </div>

      {newCount > 0 && (
        <div className={styles.newBar} role="status">
          <span>
            {newCount} new {newCount === 1 ? "article" : "articles"}
          </span>
          <button type="button" className={styles.button} onClick={showPending}>
            Show
          </button>
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {view === "summaries" ? (
        !summaries ? (
          <p className={styles.note}>Grouping the same news from different sources…</p>
        ) : summaries.summaries.length === 0 ? (
          <div className={styles.empty}>
            <p>No Summaries yet. A Summary appears when more than one source carries the same news.</p>
          </div>
        ) : (
          <ul className={styles.list} aria-label={`Summaries in ${folder.name}`}>
            {summaries.summaries.map((summary) => (
              <li key={summary.id} className={styles.summary}>
                <div className={styles.main}>
                  <p className={styles.source}>
                    <span>{summary.sources.join(" · ")}</span>
                  </p>
                  <h3 className={styles.headline}>{summary.headline}</h3>
                  {summary.text && <p className={styles.summaryText}>{summary.text}</p>}
                </div>
                <div className={styles.side}>
                  <time dateTime={summary.latestAt}>{relativeTime(summary.latestAt)}</time>
                  <span>
                    {summary.members.length} articles{summary.unread > 0 ? `, ${summary.unread} unread` : ""}
                  </span>
                </div>
                <ul className={styles.summaryMembers}>
                  {summary.members.map((member) => (
                    <li key={member.id} className={styles.summaryMember} data-read={member.read ? "true" : "false"}>
                      <button type="button" onClick={() => open(member)}>
                        {member.title}
                      </button>
                      <span>{member.publisherName ?? member.sourceFolderName}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : !loading && items.length === 0 ? (
        <div className={styles.empty}>
          {sources.length === 0 ? (
            <>
              <p>This folder does not follow any feeds yet.</p>
              {canEdit && onAddFeeds && (
                <button type="button" className={styles.primary} onClick={onAddFeeds}>
                  Add feeds
                </button>
              )}
            </>
          ) : state === "unread" ? (
            <p>Nothing unread here.</p>
          ) : state === "kept" ? (
            <p>Nothing kept here yet. Star an article, or comment on it, and it stays.</p>
          ) : (
            <p>Waiting for the first articles to arrive.</p>
          )}
        </div>
      ) : (
        <ul className={styles.list} role="listbox" aria-label={`Articles in ${folder.name}`} aria-busy={loading}>
          {items.map((item) => (
            <li
              key={item.id}
              className={styles.row}
              role="option"
              aria-selected={selectedPostId === item.id}
              data-read={item.read ? "true" : "false"}
              data-workspace-post-id={item.id}
              tabIndex={0}
              onClick={() => open(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  open(item);
                }
              }}
            >
              <span className={styles.unreadDot} aria-hidden="true" />
              <div className={styles.main}>
                <p className={styles.source}>
                  <span>{item.publisherName ?? item.sourceFolderName}</span>
                  {item.authors.length > 0 && <span>{item.authors.slice(0, 2).join(", ")}</span>}
                </p>
                <h3 className={styles.headline}>{item.title}</h3>
                {item.excerpt && <p className={styles.excerpt}>{item.excerpt}</p>}
                <p className={styles.rowMeta}>
                  {item.origin === "feed" && <span>{AVAILABILITY_LABEL[item.availability]}</span>}
                  {item.kept && (
                    <span className={styles.kept}>
                      {item.keptReasons.includes("starred")
                        ? "Starred"
                        : item.keptReasons.includes("manual_save")
                          ? "Saved by you"
                          : "Kept"}
                    </span>
                  )}
                </p>
              </div>
              <div className={styles.side}>
                <time dateTime={item.publishedAt ?? item.receivedAt} title={new Date(item.publishedAt ?? item.receivedAt).toLocaleString()}>
                  {relativeTime(item.publishedAt ?? item.receivedAt)}
                </time>
                {item.folderPath !== folder.path && <span>{item.sourceFolderName}</span>}
                {canEdit && item.origin === "feed" && (
                  <button
                    type="button"
                    className={styles.keep}
                    aria-pressed={item.keptReasons.includes("keep")}
                    title={item.keptReasons.includes("keep") ? "Stop keeping this article" : "Keep this article past cleanup"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleKeep(item);
                    }}
                  >
                    {item.keptReasons.includes("keep") ? "Kept" : "Keep"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button type="button" className={`${styles.button} ${styles.more}`} onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
