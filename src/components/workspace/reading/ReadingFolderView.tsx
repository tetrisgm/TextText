"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTypingTarget } from "@/components/keyboard/typing-target";
import { toggleEditablePostStarredAction } from "@/app/editor/actions";
import type { Blog, Folder, Post } from "@/lib/content";
import { addPost } from "@/lib/pool/store";
import { postFromPoolPost } from "@/lib/pool/selectors";
import type { WorkspacePoolPost, WorkspaceReadingSource } from "@/lib/pool/types";
import {
  deleteSavedSearchRequest,
  fetchReadingPage,
  fetchSavedSearches,
  saveSearch,
  searchReadingList,
  setSavedSearchAlert,
  type SavedReadingSearch,
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

type ReadingPrefs = {
  view: "articles" | "summaries";
  state: ReadingScope["state"];
  dateBasis: ReadingScope["dateBasis"];
  direction: "newest" | "oldest";
};
const DEFAULT_PREFS: ReadingPrefs = { view: "articles", state: "all", dateBasis: "published", direction: "newest" };

/** Per-folder view preferences and the read-on-scroll choice, this browser only. */
function loadPrefs(folderPath: string): ReadingPrefs {
  try {
    const raw = window.localStorage.getItem(`texttext:reading-prefs:${folderPath}`);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReadingPrefs>;
    return {
      view: parsed.view === "summaries" ? "summaries" : "articles",
      state: parsed.state === "unread" || parsed.state === "kept" ? parsed.state : "all",
      dateBasis: parsed.dateBasis === "received" ? "received" : "published",
      direction: parsed.direction === "oldest" ? "oldest" : "newest",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
function savePrefs(folderPath: string, prefs: ReadingPrefs) {
  try {
    window.localStorage.setItem(`texttext:reading-prefs:${folderPath}`, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; a blocked store changes nothing.
  }
}
function loadReadOnScroll(): boolean {
  try {
    return window.localStorage.getItem("texttext:reading:read-on-scroll") === "1";
  } catch {
    return false;
  }
}

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
    origin: item.origin,
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
  query = "",
  onQueryChange,
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
  /** The folder's search box; operators feed:, is:unread, is:starred, is:kept, before:, after: apply. */
  query?: string;
  onQueryChange?: (query: string) => void;
  onOpenPost?: (post: Post) => void;
  onSelectPost?: (postId: string) => void;
  onAddFeeds?: () => void;
}) {
  void blog;
  const initialPrefs = useMemo(() => loadPrefs(folder.path), [folder.path]);
  const [view, setView] = useState<"articles" | "summaries">(initialPrefs.view);
  const [summaries, setSummaries] = useState<{ summaries: Array<ReadingSummary & { text: string | null }>; singles: number; considered: number } | null>(null);
  const [state, setState] = useState<ReadingScope["state"]>(initialPrefs.state);
  const [dateBasis, setDateBasis] = useState<ReadingScope["dateBasis"]>(initialPrefs.dateBasis);
  const [direction, setDirection] = useState<"newest" | "oldest">(initialPrefs.direction);
  const [readOnScroll, setReadOnScroll] = useState<boolean>(() => (typeof window === "undefined" ? false : loadReadOnScroll()));
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  // Taken once per mount: "days left" does not need to tick.
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    savePrefs(folder.path, { view, state, dateBasis, direction });
  }, [dateBasis, direction, folder.path, state, view]);
  const scope = useMemo<ReadingScope>(
    () => ({ folderPath: folder.path, origin: "feed", includeDescendants: true, state, dateBasis, direction }),
    [dateBasis, direction, folder.path, state],
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

  // A search replaces the list: one bounded, ranked result set from the
  // server, in the list's row shape, so every row control keeps working.
  const searchQuery = query.trim();
  const [searchState, setSearchState] = useState<{ query: string; items: ReadingListItem[]; semantic: boolean } | null>(null);
  useEffect(() => {
    if (!searchQuery) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchReadingList(handle, folder.path, searchQuery)
        .then((result) => {
          if (!cancelled) setSearchState({ query: searchQuery, items: result.items, semantic: result.semantic });
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not search");
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [folder.path, handle, searchQuery]);
  const searching = Boolean(searchQuery);
  const searchResults = searchState?.query === searchQuery ? searchState : null;

  const [saved, setSaved] = useState<SavedReadingSearch[] | null>(null);
  const reloadSaved = useCallback(() => {
    void fetchSavedSearches(handle, folder.path)
      .then((result) => setSaved(result.searches))
      .catch(() => undefined);
  }, [folder.path, handle]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) reloadSaved();
    });
    return () => {
      cancelled = true;
    };
  }, [reloadSaved]);
  const saveCurrentSearch = useCallback(async () => {
    if (!searchQuery) return;
    const name = window.prompt("Name this search", searchQuery);
    if (name === null) return;
    try {
      await saveSearch(handle, { name, query: searchQuery, folder: folder.path });
      reloadSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the search");
    }
  }, [folder.path, handle, reloadSaved, searchQuery]);

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

  const setRead = useCallback(
    (item: ReadingListItem, read: boolean) => {
      patchItem(item.id, { read });
      setSummary((current) =>
        current && current.unreadCount !== null
          ? { ...current, unreadCount: Math.max(0, current.unreadCount + (read ? -1 : 1)) }
          : current,
      );
      void setReadingItemsRead(handle, [item.id], read).catch(() => patchItem(item.id, { read: !read }));
    },
    [handle, patchItem],
  );
  const markAboveRead = useCallback(
    (index: number) => {
      const above = items.slice(0, index).filter((item) => !item.read);
      if (above.length === 0) return;
      setItems((current) => current.map((item, position) => (position < index ? { ...item, read: true } : item)));
      setSummary((current) =>
        current && current.unreadCount !== null ? { ...current, unreadCount: Math.max(0, current.unreadCount - above.length) } : current,
      );
      void setReadingItemsRead(handle, above.map((item) => item.id), true).catch(() => undefined);
    },
    [handle, items],
  );
  const toggleStar = useCallback(
    (item: ReadingListItem) => {
      const starred = !item.starred;
      patchItem(item.id, { starred, kept: item.origin !== "feed" || starred || item.keptReasons.length > 0 });
      void toggleEditablePostStarredAction(handle, item.id).catch(() => patchItem(item.id, { starred: item.starred, kept: item.kept }));
    },
    [handle, patchItem],
  );
  const openOriginal = useCallback((item: ReadingListItem) => {
    const target = item.permalink ?? item.externalUrl;
    if (!target) return;
    window.open(target, "_blank", "noopener,noreferrer");
    if (!item.read) setRead(item, true);
  }, [setRead]);

  // Reader's keyboard: j/k move, o or Enter opens, m toggles read, s stars,
  // v opens the original, k(eep) is taken by "previous", so Keep is e.
  const focusIndexRef = useRef(focusIndex);
  useEffect(() => {
    focusIndexRef.current = focusIndex;
  }, [focusIndex]);
  useEffect(() => {
    if (view !== "articles") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const current = focusIndexRef.current;
      const item = current >= 0 ? items[current] : undefined;
      switch (event.key) {
        case "j":
          event.preventDefault();
          setFocusIndex(Math.min(items.length - 1, current + 1));
          break;
        case "k":
          event.preventDefault();
          setFocusIndex(Math.max(0, current - 1));
          break;
        case "o":
        case "Enter":
          if (!item) return;
          event.preventDefault();
          open(item);
          break;
        case "m":
          if (!item) return;
          event.preventDefault();
          setRead(item, !item.read);
          break;
        case "s":
          if (!item) return;
          event.preventDefault();
          toggleStar(item);
          break;
        case "e":
          if (!item) return;
          event.preventDefault();
          toggleKeep(item);
          break;
        case "v":
          if (!item) return;
          event.preventDefault();
          openOriginal(item);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, open, openOriginal, setRead, toggleKeep, toggleStar, view]);
  useEffect(() => {
    if (focusIndex < 0) return;
    const row = document.querySelector<HTMLElement>(`[data-reading-folder] [data-reading-index="${focusIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
    if (focusIndex >= items.length - 5 && cursor && !loadingMore) void Promise.resolve().then(() => loadMore());
  }, [cursor, focusIndex, items.length, loadMore, loadingMore]);

  // Read as you scroll: a row whose bottom edge has passed the top of the
  // viewport counts as read. Off unless the person turns it on.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!readOnScroll || view !== "articles" || !listRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.boundingClientRect.bottom > 0) continue;
          const id = (entry.target as HTMLElement).dataset.workspacePostId;
          const item = items.find((candidate) => candidate.id === id);
          if (item && !item.read) setRead(item, true);
        }
      },
      { root: null, threshold: 0 },
    );
    for (const row of listRef.current.querySelectorAll('[role="option"]')) observer.observe(row);
    return () => observer.disconnect();
  }, [items, readOnScroll, setRead, view]);

  const showPending = useCallback(() => {
    if (!pendingNew) return;
    setItems(pendingNew);
    setPendingNew(null);
  }, [pendingNew]);

  const rows = searching ? (searchResults?.items ?? []) : items;
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
        <div className={styles.segment} role="group" aria-label="Direction">
          <button type="button" aria-pressed={direction === "newest"} onClick={() => setDirection("newest")}>
            Newest
          </button>
          <button type="button" aria-pressed={direction === "oldest"} onClick={() => setDirection("oldest")}>
            Oldest first
          </button>
        </div>
        <label className={styles.toggle} title="Articles you scroll past count as read">
          <input
            type="checkbox"
            checked={readOnScroll}
            onChange={(event) => {
              setReadOnScroll(event.target.checked);
              try {
                window.localStorage.setItem("texttext:reading:read-on-scroll", event.target.checked ? "1" : "0");
              } catch {
                // fine
              }
            }}
          />
          Read as I scroll
        </label>
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

      {(saved?.length ?? 0) > 0 || searching ? (
        <div className={styles.savedRow} role="group" aria-label="Saved searches">
          {saved?.map((entry) => (
            <span key={entry.id} className={styles.savedChip} data-active={searchQuery === entry.query ? "true" : undefined}>
              <button type="button" onClick={() => onQueryChange?.(entry.query)} title={entry.query}>
                {entry.name}
                {entry.unread !== null && entry.unread > 0 && (
                  <small>
                    {entry.unread}
                    {entry.unreadCapped ? "+" : ""}
                  </small>
                )}
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-pressed={entry.notify}
                  title={entry.notify ? "Alert on: new matches are kept and lead the daily digest" : "Turn on an alert for new matches"}
                  onClick={() => {
                    void setSavedSearchAlert(handle, entry.id, !entry.notify).then(reloadSaved).catch(() => undefined);
                  }}
                >
                  {entry.notify ? "Alert on" : "Alert"}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove saved search ${entry.name}`}
                  onClick={() => {
                    void deleteSavedSearchRequest(handle, entry.id).then(reloadSaved).catch(() => undefined);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {searching && (
            <span className={styles.note}>
              {searchResults ? `${searchResults.items.length} ${searchResults.items.length === 1 ? "result" : "results"}${searchResults.semantic ? ", by words and meaning" : ""}` : "Searching…"}
              {" · "}
              <span title="feed:name, is:unread, is:starred, is:kept, before:2026-09-01, after:2026-08-01, and quoted phrases">operators</span>
            </span>
          )}
          {searching && canEdit && !saved?.some((entry) => entry.query === searchQuery) && (
            <button type="button" className={styles.button} onClick={() => void saveCurrentSearch()}>
              Save search
            </button>
          )}
        </div>
      ) : null}

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
      ) : (searching ? searchResults && rows.length === 0 : !loading && items.length === 0) ? (
        <div className={styles.empty}>
          {searching ? (
            <p>Nothing matches {searchQuery}.</p>
          ) : sources.length === 0 ? (
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
        <ul ref={listRef} className={styles.list} role="listbox" aria-label={`Articles in ${folder.name}`} aria-busy={loading}>
          {rows.map((item, index) => (
            <li
              key={item.id}
              className={styles.row}
              role="option"
              aria-selected={selectedPostId === item.id}
              data-read={item.read ? "true" : "false"}
              data-focused={focusIndex === index ? "true" : undefined}
              data-reading-index={index}
              data-workspace-post-id={item.id}
              tabIndex={0}
              onFocus={() => setFocusIndex(index)}
              onClick={() => {
                setFocusIndex(index);
                open(item);
              }}
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
                  {item.kept ? (
                    <span className={styles.kept}>
                      {item.keptReasons.includes("starred")
                        ? "Starred"
                        : item.keptReasons.includes("manual_save")
                          ? "Saved by you"
                          : "Kept"}
                    </span>
                  ) : item.origin === "feed" ? (
                    <span title="Not kept: it leaves on the feed's schedule unless you star, keep, comment on, or link to it">
                      {item.expiresAt ? `Passing through, ${Math.max(1, Math.ceil((new Date(item.expiresAt).getTime() - nowMs) / 86_400_000))} d left` : "Passing through"}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className={styles.side}>
                <time dateTime={item.publishedAt ?? item.receivedAt} title={new Date(item.publishedAt ?? item.receivedAt).toLocaleString()}>
                  {relativeTime(item.publishedAt ?? item.receivedAt)}
                </time>
                {item.folderPath !== folder.path && <span>{item.sourceFolderName}</span>}
                {index > 0 && items.slice(0, index).some((above) => !above.read) && (
                  <button
                    type="button"
                    className={styles.keep}
                    title="Mark everything above this article as read"
                    onClick={(event) => {
                      event.stopPropagation();
                      markAboveRead(index);
                    }}
                  >
                    Mark above read
                  </button>
                )}
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

      {cursor && view === "articles" && !searching && (
        <button type="button" className={`${styles.button} ${styles.more}`} onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
