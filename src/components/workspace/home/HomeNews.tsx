"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTypingTarget } from "@/components/keyboard/typing-target";
import { toggleEditablePostStarredAction } from "@/app/editor/actions";
import { addPost, refreshWorkspacePool } from "@/lib/pool/store";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import {
  fetchReadingHome,
  fetchReadingOverview,
  markSummariesSeenRequest,
  saveReadingBrief,
  setReadingPreferenceRequest,
  setSummaryHiddenRequest,
  setReadingItemsKept,
  setReadingItemsRead,
  tickReading,
  applyStarterFeedsRequest,
  type HomeNews as HomeNewsData,
  type HomeUnit,
  type ReadingListItem,
  type ReadingOverview,
} from "@/lib/reading/client";
import { AddFeedsDialog } from "@/components/workspace/reading/AddFeedsDialog";
import { ManageSourcesDialog } from "@/components/workspace/reading/ManageSourcesDialog";
import { STARTER_FEEDS } from "@/lib/reading/starter-feeds";
import { tidyPublisherName } from "@/lib/reading/publisher-name";
import { publisherFor } from "./publisher";
import styles from "./Home.module.css";

/**
 * The news column of the home page: what the person should know, as
 * Summaries and articles they can scan and open without leaving the
 * keyboard. Mode and topic live in the URL so returning from an article
 * lands on the same view; the list itself is a page of the server's
 * bounded snapshot, never the client pool.
 */

type Mode = "forYou" | "latest";

/** Items between one full-width photograph and the next. */
const HERO_GAP = 3;
/** Words a minute, for the one number about an article we can state honestly. */
const READING_PACE = 220;

function readingTime(words: number): string | null {
  if (!words || words < READING_PACE / 2) return null;
  return `${Math.max(1, Math.round(words / READING_PACE))} min read`;
}

export function catchMeUpPrompt(folderPath?: string | null): string {
  const scope = folderPath ? `in the "${folderPath}" folder` : "across every feed I follow";
  return `Catch me up on my reading ${scope}. Use list_reading_sources and search_reading to find what arrived recently, group the same news from different sources into one Summary, and write a short brief. Cite every claim with the article's id and original link, and say which source reported it. Do not invent anything that is not in an article.`;
}

function relativeTime(iso: string, now: number): string {
  if (!now) return "";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function poolPostFor(item: ReadingListItem, blogId: string): WorkspacePoolPost {
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

function stateFrom(params: { get(name: string): string | null } | null): { mode: Mode; topic: string | null } {
  return { mode: params?.get("news") === "latest" ? "latest" : "forYou", topic: params?.get("topic") ?? null };
}

function writeUrlState(mode: Mode, topic: string | null) {
  const url = new URL(window.location.href);
  if (mode === "latest") url.searchParams.set("news", "latest");
  else url.searchParams.delete("news");
  if (topic) url.searchParams.set("topic", topic);
  else url.searchParams.delete("topic");
  window.history.replaceState(window.history.state, "", url.toString());
}

/** "The Verge and Ars Technica", from the titles their feeds give themselves. */
function sourcesLabel(sources: string[]): string {
  const names = sources.map(tidyPublisherName);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * The row above every headline: who published it, and when. It carries a mark
 * so the eye can find a publisher without reading, which is the whole reason
 * a news surface has one.
 */
export function PublisherRow({ item, at, now }: { item: ReadingListItem; at: string; now: number }) {
  const publisher = publisherFor(item);
  return (
    <span className={styles.eyebrow}>
      <span className={styles.mark} style={{ ["--mark-bg" as string]: publisher.color }} aria-hidden="true">
        {publisher.initials}
        {publisher.domain && (
          // The site's own icon when it has one at the conventional path, the
          // monogram underneath when it does not. Same posture as the bookmark
          // cards: no referrer, lazy, and nothing is stored.
          <img
            src={`https://${publisher.domain}/favicon.ico`}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            style={{ opacity: 0 }}
            onLoad={(event) => { event.currentTarget.style.opacity = "1"; }}
            onError={(event) => { event.currentTarget.style.display = "none"; }}
          />
        )}
      </span>
      <strong>{publisher.name}</strong>
      <time dateTime={at}>{relativeTime(at, now)}</time>
      {publisher.via && <span className={styles.via}>via {publisher.via}</span>}
    </span>
  );
}

export function HomeNews({
  handle,
  blogId,
  canManage,
  assistantReady,
  /** Where a new feed's folder is created, which is the bookmarks root. */
  feedsFolderPath,
  feedsFolderName,
  retentionDays,
  onOpenPost,
  onOpenSection,
  onUseAssistantPrompt,
}: {
  handle: string;
  blogId: string;
  canManage: boolean;
  assistantReady: boolean;
  feedsFolderPath: string;
  feedsFolderName: string;
  retentionDays: number;
  onOpenPost: (postId: string) => void;
  onOpenSection: (folderPath: string) => void;
  onUseAssistantPrompt: (prompt: string) => void;
}) {
  // The server renders the default view; the URL's mode and topic are
  // adopted right after hydration (a deferred update, so the first render
  // agrees with itself) and written back with replaceState from then on,
  // so the local view machine is never asked to navigate.
  const [{ mode, topic }, setView] = useState<{ mode: Mode; topic: string | null }>({ mode: "forYou", topic: null });
  const [data, setData] = useState<HomeNewsData | null>(null);
  const [overview, setOverview] = useState<ReadingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [newArticles, setNewArticles] = useState(false);
  const hasVisibleArticles = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [memberIndex, setMemberIndex] = useState(-1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openLines, setOpenLines] = useState<Set<string>>(() => new Set());
  // Items the person has asked for less of, faded where they are.
  const [dimmed, setDimmed] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [addingFeeds, setAddingFeeds] = useState(false);
  // "starting" while the workspace is being given its first sources, "own"
  // once it is following something it chose, or chose to be empty.
  const [starter, setStarter] = useState<"unknown" | "starting" | "own">("unknown");
  const starterRan = useRef(false);
  const tabsRef = useRef<HTMLUListElement | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when data arrives, never during render, so server and client agree.
  const [now, setNow] = useState(0);
  const pendingOpen = useRef<string | null>(null);
  const [openTick, setOpenTick] = useState(0);
  const [unitMenu, setUnitMenu] = useState<{ id: string; kind: "menu" | "less" | "why" } | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const seenQueue = useRef(new Map<string, number>());
  const seenTimer = useRef<number | null>(null);

  const load = useCallback(
    async (next: { mode: Mode; topic: string | null }, offset = 0) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchReadingHome({ handle, mode: next.mode, topic: next.topic, offset });
        setNow(Date.now());
        hasVisibleArticles.current = page.units.length > 0;
        if (offset === 0) setNewArticles(false);
        setData((current) => (offset > 0 && current ? { ...page, units: [...current.units, ...page.units] } : page));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load the news");
      } finally {
        setLoading(false);
      }
    },
    [handle],
  );

  // Serve what is cached at once. The app is its own scheduler: after the
  // first paint, stale sources are checked in a few bounded passes and the
  // news is read again only when something actually ran.
  useEffect(() => {
    let cancelled = false;
    const STALE_MS = 30 * 60 * 1000;
    const initial = stateFrom(new URLSearchParams(window.location.search));
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setView(initial);
      return load(initial);
    });
    void (async () => {
      try {
        const first = await fetchReadingOverview(handle);
        if (cancelled) return;
        setOverview(first);
        const newest = Math.max(0, ...first.sources.map((source) => (source.lastSuccessAt ? new Date(source.lastSuccessAt).getTime() : 0)));
        if (!canManage || first.sources.length === 0 || Date.now() - newest <= STALE_MS) return;
        let ran = 0;
        for (let pass = 0; pass < 3; pass += 1) {
          const result = await tickReading(handle, 3);
          ran += result.ran.done;
          if ((result.jobs.queued ?? 0) === 0) break;
        }
        if (cancelled) return;
        const refreshed = await fetchReadingOverview(handle);
        if (cancelled) return;
        setOverview(refreshed);
        if (ran > 0) {
          if (hasVisibleArticles.current) setNewArticles(true);
          else await load(initial);
        }
      } catch {
        // A failed check is not something the front page needs to show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, handle, load]);

  const setMode = (next: Mode) => {
    setView({ mode: next, topic });
    writeUrlState(next, topic);
    setFocusIndex(-1);
    void load({ mode: next, topic });
  };
  const setTopic = useCallback(
    (next: string | null) => {
      const value = next === topic ? null : next;
      setView({ mode, topic: value });
      writeUrlState(mode, value);
      setFocusIndex(-1);
      void load({ mode, topic: value });
    },
    [load, mode, topic],
  );

  // Same two-step open as the folder views: merge into the pool, then open
  // once the shell has re-rendered with a handler that can see the item.
  useEffect(() => {
    const id = pendingOpen.current;
    if (!id) return;
    pendingOpen.current = null;
    onOpenPost(id);
  }, [onOpenPost, openTick]);

  const patchItem = useCallback((id: string, patch: Partial<ReadingListItem>) => {
    setData((current) => {
      if (!current) return current;
      const apply = (item: ReadingListItem) => (item.id === id ? { ...item, ...patch } : item);
      return {
        ...current,
        units: current.units.map((unit) =>
          unit.kind === "article"
            ? { ...unit, item: apply(unit.item) }
            : { ...unit, members: unit.members.map(apply), representative: apply(unit.representative), unread: unit.members.map(apply).filter((member) => !member.read).length },
        ),
      };
    });
  }, []);

  const open = useCallback(
    (item: ReadingListItem) => {
      pendingOpen.current = item.id;
      addPost(poolPostFor(item, blogId));
      if (!item.read) {
        patchItem(item.id, { read: true });
        void setReadingItemsRead(handle, [item.id], true).catch(() => patchItem(item.id, { read: false }));
      }
      setOpenTick((tick) => tick + 1);
    },
    [blogId, handle, patchItem],
  );
  const setRead = useCallback(
    (item: ReadingListItem, read: boolean) => {
      patchItem(item.id, { read });
      void setReadingItemsRead(handle, [item.id], read).catch(() => patchItem(item.id, { read: !read }));
    },
    [handle, patchItem],
  );
  const toggleStar = useCallback(
    (item: ReadingListItem) => {
      const starred = !item.starred;
      patchItem(item.id, { starred, kept: item.origin !== "feed" || starred || item.keptReasons.length > 0 });
      void toggleEditablePostStarredAction(handle, item.id).catch(() => patchItem(item.id, { starred: item.starred, kept: item.kept }));
    },
    [handle, patchItem],
  );
  const toggleKeep = useCallback(
    (item: ReadingListItem) => {
      const keep = !item.keptReasons.includes("keep");
      const reasons = keep ? [...item.keptReasons, "keep"] : item.keptReasons.filter((reason) => reason !== "keep");
      patchItem(item.id, { keptReasons: reasons, kept: item.origin !== "feed" || item.starred || reasons.length > 0 });
      void setReadingItemsKept(handle, [item.id], keep).catch(() => patchItem(item.id, { keptReasons: item.keptReasons, kept: item.kept }));
    },
    [handle, patchItem],
  );
  const openOriginal = useCallback(
    (item: ReadingListItem) => {
      const target = item.permalink ?? item.externalUrl;
      if (!target) return;
      window.open(target, "_blank", "noopener,noreferrer");
      if (!item.read) setRead(item, true);
    },
    [setRead],
  );
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMemberIndex(-1);
  }, []);

  const units = useMemo(() => data?.units ?? [], [data]);
  /** The article a key acts on: the focused member when expanded, else the unit's own. */
  const targetOf = useCallback(
    (unit: HomeUnit | undefined): ReadingListItem | null => {
      if (!unit) return null;
      if (unit.kind === "article") return unit.item;
      if (expanded.has(unit.id) && memberIndex >= 0 && unit.members[memberIndex]) return unit.members[memberIndex];
      return unit.representative;
    },
    [expanded, memberIndex],
  );

  // Seen: a Summary row that stays in view for a moment is acknowledged at
  // the coverage revision it showed, in one bounded batch. Prefetch and
  // offscreen rows never count, and the watermark only ever rises.
  const flushSeen = useCallback(() => {
    seenTimer.current = null;
    const batch = [...seenQueue.current.entries()].map(([id, revision]) => ({ id, revision }));
    seenQueue.current.clear();
    if (batch.length === 0) return;
    void markSummariesSeenRequest(handle, batch).catch(() => undefined);
  }, [handle]);
  useEffect(() => {
    if (mode !== "forYou") return;
    const root = document.querySelector('[data-home-news] [role="listbox"]');
    if (!root) return;
    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const id = element.dataset.summaryId;
          const revision = Number(element.dataset.coverageRevision ?? 0);
          if (!id || !revision) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (!timers.has(element)) {
              timers.set(
                element,
                window.setTimeout(() => {
                  timers.delete(element);
                  const known = seenQueue.current.get(id) ?? 0;
                  seenQueue.current.set(id, Math.max(known, revision));
                  if (seenTimer.current === null) seenTimer.current = window.setTimeout(flushSeen, 2000);
                }, 400),
              );
            }
          } else if (timers.has(element)) {
            window.clearTimeout(timers.get(element));
            timers.delete(element);
          }
        }
      },
      { root: null, threshold: [0, 0.6, 1] },
    );
    for (const row of root.querySelectorAll("[data-summary-id]")) observer.observe(row);
    return () => {
      observer.disconnect();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [flushSeen, mode, units]);
  useEffect(() => () => flushSeen(), [flushSeen]);

  /**
   * Telling the page you want less of something dims the item where it is
   * and leaves it in the scroll. Removing it, or re-ranking the page under
   * the cursor, moves everything below it while a person is still reading:
   * the original fades the card to four tenths in place for exactly this
   * reason, and the rule takes effect on the next page either way.
   */
  const dim = useCallback((id: string, on: boolean) => {
    setDimmed((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const hideSummary = useCallback(
    (unit: Extract<HomeUnit, { kind: "summary" }>) => {
      if (!unit.summaryId) return;
      const summaryId = unit.summaryId;
      dim(unit.id, true);
      setUnitMenu(null);
      void setSummaryHiddenRequest(handle, summaryId, true).catch(() => undefined);
      setUndo({
        label: "Hidden. It stays out of For you until you show it again in Settings.",
        run: async () => {
          await setSummaryHiddenRequest(handle, summaryId, false);
          dim(unit.id, false);
        },
      });
    },
    [dim, handle],
  );
  const lessLikeThis = useCallback(
    (unit: HomeUnit, target: { kind: "topic_less" | "source_less"; target: string; label: string }) => {
      setUnitMenu(null);
      // A demotion, not an exclusion: the rule applies to the next page. This
      // one dims and stays put, because re-ranking the list a person is
      // reading is how you lose their place.
      dim(unit.id, true);
      void setReadingPreferenceRequest(handle, target)
        .then((result) => {
          setUndo({
            label: target.kind === "source_less" ? `Less from ${target.label}. A soft rule for For you, listed in Settings.` : `Less about ${target.label}. A soft rule for For you, listed in Settings.`,
            run: async () => {
              const { removeReadingPreferenceRequest } = await import("@/lib/reading/client");
              await removeReadingPreferenceRequest(handle, result.rule.id);
              dim(unit.id, false);
            },
          });
        })
        .catch((caught) => {
          dim(unit.id, false);
          setNotice(caught instanceof Error ? caught.message : "Could not save that preference");
        });
    },
    [dim, handle],
  );
  /** What "less like this" can name for a unit: its topics by label, its sources by folder. */
  const lessTargets = useCallback(
    (unit: HomeUnit): Array<{ kind: "topic_less" | "source_less"; target: string; label: string }> => {
      const topicsById = new Map((data?.topics ?? []).map((entry) => [entry.id, entry]));
      const topics = unit.topicIds
        .map((id) => topicsById.get(id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry) && entry!.kind !== "source")
        .map((entry) => ({ kind: "topic_less" as const, target: entry.id, label: entry.label }));
      // Named the way the row names it: "Less from The Guardian", never
      // "Less from World news | The Guardian".
      const named = (item: ReadingListItem) => tidyPublisherName(item.publisherName ?? item.sourceFolderName);
      const sources = unit.kind === "summary"
        ? unit.members.map((member) => ({ kind: "source_less" as const, target: member.folderPath, label: named(member) }))
        : [{ kind: "source_less" as const, target: unit.item.folderPath, label: named(unit.item) }];
      const seen = new Set<string>();
      return [...topics, ...sources].filter((entry) => (seen.has(entry.target) ? false : (seen.add(entry.target), true)));
    },
    [data?.topics],
  );

  // The strip scrolls, so the chosen tab is brought into view: one picked by
  // keyboard, or restored from the URL, must never sit off the end of it.
  useEffect(() => {
    const strip = tabsRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !current) return;
    const left = current.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + current.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [topic, data?.topics]);

  const focusIndexRef = useRef(focusIndex);
  useEffect(() => {
    focusIndexRef.current = focusIndex;
  }, [focusIndex]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key !== "Escape" && event.target instanceof Element && event.target.closest("button, a, [role=menu]")) return;
      const current = focusIndexRef.current;
      const unit = current >= 0 ? units[current] : undefined;
      const item = targetOf(unit);
      switch (event.key) {
        case "j":
          event.preventDefault();
          if (unit?.kind === "summary" && expanded.has(unit.id) && memberIndex < unit.members.length - 1) {
            setMemberIndex(memberIndex + 1);
          } else {
            setFocusIndex(Math.min(units.length - 1, current + 1));
            setMemberIndex(-1);
          }
          break;
        case "k":
          event.preventDefault();
          if (unit?.kind === "summary" && expanded.has(unit.id) && memberIndex >= 0) {
            setMemberIndex(memberIndex - 1);
          } else {
            setFocusIndex(Math.max(0, current - 1));
            setMemberIndex(-1);
          }
          break;
        case "l":
        case "ArrowRight":
          if (unit?.kind !== "summary" || expanded.has(unit.id)) return;
          event.preventDefault();
          toggleExpanded(unit.id);
          break;
        case "h":
        case "ArrowLeft":
          if (unit?.kind !== "summary" || !expanded.has(unit.id)) return;
          event.preventDefault();
          toggleExpanded(unit.id);
          break;
        case "[":
        case "]": {
          const strip = [null, ...(data?.topics ?? []).map((entry) => entry.id)];
          const at = strip.indexOf(topic);
          if (at < 0) return;
          const next = strip[(at + (event.key === "]" ? 1 : strip.length - 1)) % strip.length];
          event.preventDefault();
          setTopic(next);
          break;
        }
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
        case "x":
          if (unit?.kind !== "summary" || !unit.summaryId) return;
          event.preventDefault();
          hideSummary(unit);
          break;
        case ",":
          if (!unit) return;
          event.preventDefault();
          setUnitMenu({ id: unit.id, kind: "less" });
          break;
        case "Escape":
          setUnitMenu(null);
          return;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data?.topics, expanded, hideSummary, memberIndex, open, openOriginal, setRead, setTopic, targetOf, toggleExpanded, toggleKeep, toggleStar, topic, units]);
  useEffect(() => {
    if (focusIndex < 0) return;
    document.querySelector<HTMLElement>(`[data-home-news] [data-unit-index="${focusIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const saveBrief = async () => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setMenuOpen(false);
    try {
      const result = await saveReadingBrief(handle);
      await refreshWorkspacePool(handle, blogId).catch(() => undefined);
      setNotice(`Saved a brief with ${result.items} ${result.items === 1 ? "article" : "articles"} to ${result.folderPath}.`);
      pendingOpen.current = result.id;
      setOpenTick((tick) => tick + 1);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not save the brief");
    } finally {
      setSaving(false);
    }
  };

  // A news surface that opens empty is a broken news surface. A workspace
  // following nothing is given the starter set once, a few publishers per
  // pass so the page fills rather than hangs. The server decides whether it
  // is owed: a workspace that was given them and then emptied says no, and
  // this stops at the first refusal.
  useEffect(() => {
    if (!canManage || overview === null || overview.sources.length > 0 || starterRan.current) return;
    starterRan.current = true;
    let cancelled = false;
    void (async () => {
      for (let pass = 0; pass < 6; pass += 1) {
        const result = await applyStarterFeedsRequest(handle).catch(() => null);
        if (cancelled) return;
        if (!result?.outcome.applied) {
          setStarter("own");
          return;
        }
        setStarter("starting");
        if (result.outcome.remaining === 0) break;
      }
      if (cancelled) return;
      await refreshWorkspacePool(handle, blogId).catch(() => undefined);
      if (cancelled) return;
      const fresh = await fetchReadingOverview(handle).catch(() => null);
      if (cancelled || !fresh) return;
      setOverview(fresh);
      void load({ mode, topic });
    })();
    return () => {
      cancelled = true;
    };
    // The workspace is asked once per mount; mode and topic are read at the
    // moment the sources land, never as reasons to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogId, canManage, handle, overview]);

  const unhealthy = overview?.sources.filter((source) => !["healthy", "checking"].includes(source.health)) ?? [];
  // A photograph gets the full width every few items and the rest stay
  // compact. Artifact's feed alternates this way, and it is what stops a list
  // of headlines reading as a wall of text.
  const heroes = useMemo(() => {
    const chosen = new Set<number>();
    // -1, not -infinity: the original never opens on a photograph. Two
    // compact rows, then the picture.
    let previous = -1;
    units.forEach((unit, index) => {
      const image = unit.kind === "summary" ? unit.imageUrl : unit.item.imageUrl;
      if (image && index - previous >= HERO_GAP) {
        chosen.add(index);
        previous = index;
      }
    });
    return chosen;
  }, [units]);
  // Chosen by the server across the whole window, not by this page, and
  // already lifted out of the list below.
  const headlines = useMemo(
    () => (data?.headlines ?? []).filter((unit): unit is Extract<HomeUnit, { kind: "summary" }> => unit.kind === "summary"),
    [data?.headlines],
  );

  // With nothing followed, the modes and topics control nothing, and the news
  // area would be a hole the height of a feed. The page becomes a short setup
  // block instead, and Recent follows it directly.
  const noSources = overview !== null && overview.sources.length === 0;
  const starterTopicLabel = useMemo(() => {
    const topics = [...new Set(STARTER_FEEDS.map((feed) => feed.topic))];
    return `${topics.slice(0, -1).join(", ")} and ${topics[topics.length - 1]}`.toLowerCase();
  }, []);

  return (
    <section className={`applecms ${styles.news}`} aria-label="News" data-home-news>
      {noSources && starter === "starting" && (
        <div className={styles.setup}>
          <h2>Setting up your news</h2>
          <p>
            Following {STARTER_FEEDS.length} publishers across {starterTopicLabel}. They will start arriving in a moment, and
            you can drop any of them from Manage sources.
          </p>
        </div>
      )}
      {noSources && starter === "own" && (
        <div className={styles.setup}>
          <h2>News from the sources you follow</h2>
          <p>Choose publishers to start your personal news feed.</p>
          <div className={styles.setupActions}>
            <button type="button" className="ac-btn ac-btn-filled" onClick={() => setAddingFeeds(true)}>
              Add feeds
            </button>
            <button type="button" className={styles.setupSecondary} onClick={() => setManaging(true)}>
              Import OPML
            </button>
          </div>
        </div>
      )}
      {/* One strip, the way the app this copies had one: For You and then the
          subjects, at a size that makes it the navigation rather than a
          caption. Everything that is not a subject lives behind the button at
          its end, so the strip stays a strip. */}
      {!noSources && (
        <nav className={styles.strip} aria-label="Channels">
          <ul className={styles.tabs} ref={tabsRef}>
            <li>
              <button
                type="button"
                className={styles.tab}
                aria-current={topic === null ? "true" : undefined}
                onClick={() => setTopic(null)}
              >
                For You
              </button>
            </li>
            {(data?.topics ?? []).map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={styles.tab}
                  aria-current={topic === entry.id ? "true" : undefined}
                  onClick={() => setTopic(entry.id)}
                  title={
                    entry.kind === "channel"
                      ? entry.detail || undefined
                      : entry.kind === "search"
                        ? `Saved search: ${entry.detail}`
                        : entry.kind === "derived"
                          ? `Grouped by what the articles are about: ${entry.detail}`
                          : "One source"
                  }
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.menuWrap}>
            <button
              type="button"
              className={styles.stripMore}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="News options"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span aria-hidden="true">•••</span>
              {unhealthy.length > 0 && <span className={styles.attentionDot} aria-hidden="true" />}
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu" onMouseLeave={() => setMenuOpen(false)}>
                {overview && (
                  <small>
                    {overview.totals.newSince24h} new today
                    {overview.totals.unread !== null ? `, ${overview.totals.unread} unread` : ""}, {overview.sources.length} {overview.sources.length === 1 ? "source" : "sources"}
                  </small>
                )}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={mode === "latest"}
                  onClick={() => { setMenuOpen(false); setMode(mode === "latest" ? "forYou" : "latest"); }}
                >
                  Newest first
                  {mode === "latest" && <span aria-hidden="true">✓</span>}
                </button>
                {canManage && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setManaging(true); }}>
                    Manage sources
                  </button>
                )}
                {unhealthy.length > 0 && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setManaging(true); }} title={unhealthy[0].healthDetail ?? undefined}>
                    {unhealthy.length === 1 ? "1 source needs attention" : `${unhealthy.length} sources need attention`}
                  </button>
                )}
                {assistantReady && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onUseAssistantPrompt(catchMeUpPrompt(topic?.startsWith("source:") ? topic.slice(7) : null)); }}>
                    Catch me up
                  </button>
                )}
                {canManage && (
                  <button type="button" role="menuitem" onClick={() => void saveBrief()} disabled={saving}>
                    {saving ? "Saving" : "Save brief"}
                  </button>
                )}
              </div>
            )}
          </div>
        </nav>
      )}
      {addingFeeds && (
        <AddFeedsDialog
          handle={handle}
          parentFolderPath={feedsFolderPath}
          parentFolderName={feedsFolderName}
          defaultRetentionDays={retentionDays}
          onClose={() => setAddingFeeds(false)}
          onAdded={async (result) => {
            setAddingFeeds(false);
            await refreshWorkspacePool(handle, blogId).catch(() => undefined);
            void fetchReadingOverview(handle).then(setOverview).catch(() => undefined);
            void load({ mode, topic });
            onOpenSection(result.folderPath);
          }}
        />
      )}
      {managing && (
        <ManageSourcesDialog
          handle={handle}
          blogId={blogId}
          folderPath=""
          folderName="all folders"
          onClose={() => setManaging(false)}
          onChanged={() => {
            void fetchReadingOverview(handle).then(setOverview).catch(() => undefined);
            void load({ mode, topic });
          }}
        />
      )}
      {newArticles && <div className={styles.newArticles}><button type="button" onClick={() => {
        void load({ mode, topic });
        document.querySelector(".post-editor-content")?.scrollTo({ top: 0 });
      }}>↑ New articles</button></div>}
      {undo && (
        <p className={styles.status} role="status">
          {undo.label}{" "}
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              const pending = undo;
              setUndo(null);
              void pending.run().catch(() => setNotice("Could not undo"));
            }}
          >
            Undo
          </button>
        </p>
      )}
      {notice && <p className={styles.status} role="status">{notice}</p>}
      {error && <p className={styles.status} role="alert">{error}</p>}
      {data?.topicNote && <p className={styles.note}>{data.topicNote}</p>}
      {!noSources && data && units.length === 0 && !loading && (
        <p className={styles.empty}>
          {topic
            ? "Nothing in this topic yet. Clear the topic to see everything you follow."
            : "Nothing has arrived yet. Sources are checked when you open the workspace."}
        </p>
      )}
      {headlines.length > 1 && (
        <>
          <div className={`${styles.sectionHead} ${styles.carouselHead}`}>
            <h2 className={styles.sectionTitle}>Headlines</h2>
          </div>
          <ul className={styles.carousel} aria-label="Headlines">
            {headlines.map((unit) => (
              <li
                key={`card:${unit.id}`}
                className={styles.card}
                tabIndex={0}
                role="link"
                onClick={() => open(unit.representative)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(unit.representative);
                  }
                }}
              >
                {unit.imageUrl ? (
                  <img className={styles.cardImage} src={unit.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                ) : (
                  <span className={styles.cardImage} aria-hidden="true" style={{ background: publisherFor(unit.representative).color }} />
                )}
                <div className={styles.cardBody}>
                  <h3 className={styles.cardHeadline}>{unit.headline}</h3>
                  <p className={styles.cardMeta}>
                    {unit.members.length} {unit.members.length === 1 ? "article" : "articles"} · {unit.sources.length} sources
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <ol className={styles.list} role="listbox" aria-label={mode === "latest" ? "Latest articles" : "News"}>
        {units.map((unit, index) => {
          const focused = index === focusIndex;
          const lead = heroes.has(index);
          if (unit.kind === "article") {
            const item = unit.item;
            return (
              <li
                key={unit.id}
                className={styles.unit}
                role="option"
                aria-selected={focused}
                data-unit-index={index}
                data-focused={focused ? "true" : "false"}
                data-read={item.read ? "true" : "false"}
                data-dimmed={dimmed.has(unit.id) ? "true" : "false"}
                data-lead={lead ? "true" : "false"}
                tabIndex={focused || (focusIndex < 0 && index === 0) ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => open(item)}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setUnitMenu({ id: unit.id, kind: "menu" }); }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(item);
                  }
                }}
              >
                {lead && item.imageUrl && (
                  <img className={styles.leadImage} src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                )}
                <div className={styles.body}>
                  <PublisherRow item={item} at={unit.latestAt} now={now} />
                  <h3 className={styles.headline}>{item.title}</h3>
                  {/* Unread is the default state of a feed, so it is said by
                      the headline's full ink rather than by a chip on every
                      row. Only what is true of the few is written down. */}
                  <p className={styles.sources}>
                    {item.read && <span className={styles.state}>Read</span>}
                    {readingTime(item.wordCount) && <span>{readingTime(item.wordCount)}</span>}
                    {item.keptReasons.includes("keep") && <span>Kept</span>}
                  </p>
                  <button type="button" className={styles.rowMore} aria-label={`More options for ${item.title}`} aria-haspopup="menu" aria-expanded={unitMenu?.id === unit.id} onClick={(event) => {
                    event.stopPropagation(); setUnitMenu(unitMenu?.id === unit.id ? null : { id: unit.id, kind: "menu" });
                  }}>•••</button>
                  {unitMenu?.id === unit.id && (
                    <span className={styles.unitMenu} role="menu" onClick={(event) => event.stopPropagation()}>
                      {unitMenu.kind === "why" ? (
                        <>
                          <small>Why this is here</small>
                          {unit.reasons.length === 0 ? <button type="button" role="menuitem" disabled>Newest first</button> : unit.reasons.map((reason) => (
                            <button key={reason.name} type="button" role="menuitem" disabled>
                              {reason.name} {reason.value > 0 ? `+${reason.value}` : reason.value}
                            </button>
                          ))}
                        </>
                      ) : unitMenu.kind === "menu" ? (
                        <>
                          <button type="button" role="menuitem" onClick={() => { toggleKeep(item); setUnitMenu(null); }}>{item.keptReasons.includes("keep") ? "Remove from Read Later" : "Read Later"}</button>
                          <button type="button" role="menuitem" onClick={() => { setRead(item, !item.read); setUnitMenu(null); }}>{item.read ? "Mark unread" : "Mark read"}</button>
                          <button type="button" role="menuitem" onClick={() => { openOriginal(item); setUnitMenu(null); }}>Open original</button>
                          <button type="button" role="menuitem" onClick={() => {
                            const link = item.permalink ?? item.externalUrl;
                            if (link) void navigator.clipboard.writeText(link).then(() => setNotice("Link copied")).catch(() => setNotice("Could not copy the link"));
                            setUnitMenu(null);
                          }}>Copy link</button>
                          <button type="button" role="menuitem" onClick={() => setUnitMenu({ id: unit.id, kind: "less" })}>Show fewer</button>
                          <button type="button" role="menuitem" onClick={() => setUnitMenu({ id: unit.id, kind: "why" })}>Why this article</button>
                        </>
                      ) : (
                        <>
                          <small>Less like this</small>
                          {lessTargets(unit).map((target) => (
                            <button key={`${target.kind}:${target.target}`} type="button" role="menuitem" onClick={() => lessLikeThis(unit, target)}>
                              {target.kind === "source_less" ? `Less from ${target.label}` : `Less about ${target.label}`}
                            </button>
                          ))}
                        </>
                      )}
                    </span>
                  )}
                </div>
                {!lead && item.imageUrl && <img className={styles.thumb} src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.dataset.hidden = "true"; }} />}
              </li>
            );
          }
          const isExpanded = expanded.has(unit.id);
          const representative = unit.representative;
          return (
            <li
              key={unit.id}
              className={styles.unit}
              role="option"
              aria-selected={focused}
              data-unit-index={index}
              data-focused={focused ? "true" : "false"}
              data-read={unit.unread === 0 ? "true" : "false"}
              data-dimmed={dimmed.has(unit.id) ? "true" : "false"}
              data-lead={lead ? "true" : "false"}
              data-summary-id={unit.summaryId ?? undefined}
              data-coverage-revision={unit.summaryId ? unit.coverageRevision : undefined}
              tabIndex={focused || (focusIndex < 0 && index === 0) ? 0 : -1}
              onFocus={() => setFocusIndex(index)}
              onClick={() => open(representative)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  open(targetOf(unit) ?? representative);
                }
              }}
            >
              {lead && unit.imageUrl && <img className={styles.leadImage} src={unit.imageUrl} alt="" loading="eager" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
              <div className={styles.body}>
                {unit.sources.length > 1 && (
                  <p className={styles.kicker}>
                    <span aria-hidden="true">✳</span>
                    Covered by {unit.sources.length} sources
                  </p>
                )}
                <PublisherRow item={representative} at={unit.latestAt} now={now} />
                <h3 className={styles.headline}>{unit.headline}</h3>
                {unit.text ? (
                  <p
                    className={styles.line}
                    data-open={openLines.has(unit.id) ? "true" : "false"}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenLines((current) => {
                        const next = new Set(current);
                        if (next.has(unit.id)) next.delete(unit.id);
                        else next.add(unit.id);
                        return next;
                      });
                    }}
                  >
                    <em>{unit.textStale ? "Summary, earlier coverage" : "Summary"}</em>
                    {unit.text}
                  </p>
                ) : null}
                <p className={styles.sources} onClick={(event) => event.stopPropagation()}>
                  {unit.seenRevision > 0 && unit.coverageRevision > unit.seenRevision ? (
                    <span className={styles.state}>New coverage</span>
                  ) : unit.unread > 0 && unit.unread < unit.members.length ? (
                    <span>{unit.unread} unread</span>
                  ) : null}
                  <button type="button" aria-expanded={isExpanded} onClick={() => toggleExpanded(unit.id)}>
                    {sourcesLabel(unit.sources)}
                  </button>
                  {readingTime(representative.wordCount) && <span>{readingTime(representative.wordCount)}</span>}
                  <span className={styles.actions}>
                    <button type="button" className={styles.action} aria-pressed={representative.keptReasons.includes("keep")} onClick={() => toggleKeep(representative)} title="Keeps the article the headline opens, not every source">
                      {representative.keptReasons.includes("keep") ? "Saved" : "Read Later"}
                    </button>
                    <button type="button" className={styles.action} onClick={() => openOriginal(representative)}>
                      Original
                    </button>
                    <button type="button" className={styles.action} aria-haspopup="menu" aria-expanded={unitMenu?.id === unit.id} onClick={() => setUnitMenu(unitMenu?.id === unit.id ? null : { id: unit.id, kind: "menu" })}>
                      More
                    </button>
                  </span>
                  {unitMenu?.id === unit.id && (
                    <span className={styles.unitMenu} role="menu">
                      {unitMenu.kind === "less" ? (
                        <>
                          <small>Less like this</small>
                          {lessTargets(unit).map((target) => (
                            <button key={`${target.kind}:${target.target}`} type="button" role="menuitem" onClick={() => lessLikeThis(unit, target)}>
                              {target.kind === "source_less" ? `Less from ${target.label}` : `Less about ${target.label}`}
                            </button>
                          ))}
                        </>
                      ) : unitMenu.kind === "why" ? (
                        <>
                          <small>Why this is here</small>
                          {unit.reasons.length === 0 ? <button type="button" role="menuitem" disabled>Newest first</button> : unit.reasons.map((reason) => (
                            <button key={reason.name} type="button" role="menuitem" disabled>
                              {reason.name} {reason.value > 0 ? `+${reason.value}` : reason.value}
                            </button>
                          ))}
                        </>
                      ) : (
                        <>
                          {unit.summaryId && (
                            <button type="button" role="menuitem" onClick={() => hideSummary(unit)}>
                              Hide this Summary
                            </button>
                          )}
                          <button type="button" role="menuitem" onClick={() => setUnitMenu({ id: unit.id, kind: "less" })}>
                            Less like this
                          </button>
                          {mode === "forYou" && (
                            <button type="button" role="menuitem" onClick={() => setUnitMenu({ id: unit.id, kind: "why" })}>
                              Why this is here
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </p>
              </div>
              {!lead && unit.imageUrl && <img className={styles.thumb} src={unit.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.dataset.hidden = "true"; }} />}
              {isExpanded && (
                <ul className={styles.members} onClick={(event) => event.stopPropagation()}>
                  {unit.members.map((member, position) => (
                    <li key={member.id} className={styles.member} data-read={member.read ? "true" : "false"} data-focused={focused && memberIndex === position ? "true" : "false"}>
                      <span>{member.publisherName ?? member.sourceFolderName}</span>
                      <button type="button" onClick={() => open(member)}>
                        {member.title}
                      </button>
                      <button type="button" className={styles.action} onClick={() => toggleKeep(member)} aria-pressed={member.keptReasons.includes("keep")}>
                        {member.keptReasons.includes("keep") ? "Saved" : "Read Later"}
                      </button>
                      <button type="button" className={styles.action} onClick={() => onOpenSection(member.folderPath)}>
                        Folder
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {data?.nextOffset !== null && data?.nextOffset !== undefined && (
        <button type="button" className={styles.more} onClick={() => void load({ mode, topic }, data.nextOffset ?? 0)} disabled={loading}>
          {loading ? "Loading" : "More news"}
        </button>
      )}
    </section>
  );
}
