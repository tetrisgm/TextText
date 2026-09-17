"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  type HomeNews as HomeNewsData,
  type HomeUnit,
  type ReadingListItem,
  type ReadingOverview,
} from "@/lib/reading/client";
import { ManageSourcesDialog } from "@/components/workspace/reading/ManageSourcesDialog";
import styles from "./Home.module.css";

/**
 * The news column of the home page: what the person should know, as
 * Summaries and articles they can scan and open without leaving the
 * keyboard. Mode and topic live in the URL so returning from an article
 * lands on the same view; the list itself is a page of the server's
 * bounded snapshot, never the client pool.
 */

type Mode = "forYou" | "latest";

export function catchMeUpPrompt(folderPath?: string | null): string {
  const scope = folderPath ? `in the "${folderPath}" folder` : "across every feed I follow";
  return `Catch me up on my reading ${scope}. Use list_reading_sources and search_reading to find what arrived recently, group the same news from different sources into one Summary, and write a short brief. Cite every claim with the article's id and original link, and say which source reported it. Do not invent anything that is not in an article.`;
}

function relativeTime(iso: string, now: number): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
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

function sourcesLabel(sources: string[]): string {
  if (sources.length <= 2) return sources.join(" and ");
  return `${sources[0]}, ${sources[1]} and ${sources.length - 2} more`;
}

export function HomeNews({
  handle,
  blogId,
  canManage,
  assistantReady,
  onOpenPost,
  onOpenSection,
  onUseAssistantPrompt,
}: {
  handle: string;
  blogId: string;
  canManage: boolean;
  assistantReady: boolean;
  onOpenPost: (postId: string) => void;
  onOpenSection: (folderPath: string) => void;
  onUseAssistantPrompt: (prompt: string) => void;
}) {
  // The router's params are the same on the server and at hydration, so the
  // first render agrees with itself; later changes are mirrored into local
  // state and written back with replaceState so the local view machine is
  // not asked to navigate.
  const searchParams = useSearchParams();
  const [{ mode, topic }, setView] = useState(() => stateFrom(searchParams));
  const [data, setData] = useState<HomeNewsData | null>(null);
  const [overview, setOverview] = useState<ReadingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [memberIndex, setMemberIndex] = useState(-1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openLines, setOpenLines] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now] = useState(() => Date.now());
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
    const initial = stateFrom(searchParams);
    void Promise.resolve().then(() => (cancelled ? undefined : load(initial)));
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
        if (ran > 0) await load(initial);
      } catch {
        // A failed check is not something the front page needs to show.
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the URL is read once, at mount
  }, [canManage, handle, load]);

  const setMode = (next: Mode) => {
    setView({ mode: next, topic });
    writeUrlState(next, topic);
    setFocusIndex(-1);
    void load({ mode: next, topic });
  };
  const setTopic = (next: string | null) => {
    const value = next === topic ? null : next;
    setView({ mode, topic: value });
    writeUrlState(mode, value);
    setFocusIndex(-1);
    void load({ mode, topic: value });
  };

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

  const removeUnit = useCallback((id: string) => {
    setData((current) => (current ? { ...current, units: current.units.filter((unit) => unit.id !== id), hiddenCount: current.hiddenCount + 1 } : current));
  }, []);
  const hideSummary = useCallback(
    (unit: Extract<HomeUnit, { kind: "summary" }>) => {
      if (!unit.summaryId) return;
      const summaryId = unit.summaryId;
      removeUnit(unit.id);
      setUnitMenu(null);
      void setSummaryHiddenRequest(handle, summaryId, true).catch(() => undefined);
      setUndo({
        label: "Hidden. It stays out of For you until you show it again in Settings.",
        run: async () => {
          await setSummaryHiddenRequest(handle, summaryId, false);
          await load({ mode, topic });
        },
      });
    },
    [handle, load, mode, removeUnit, topic],
  );
  const lessLikeThis = useCallback(
    (unit: HomeUnit, target: { kind: "topic_less" | "source_less"; target: string; label: string }) => {
      setUnitMenu(null);
      removeUnit(unit.id);
      void setReadingPreferenceRequest(handle, target)
        .then((result) => {
          setUndo({
            label: target.kind === "source_less" ? `Less from ${target.label}. A soft rule for For you, listed in Settings.` : `Less about ${target.label}. A soft rule for For you, listed in Settings.`,
            run: async () => {
              const { removeReadingPreferenceRequest } = await import("@/lib/reading/client");
              await removeReadingPreferenceRequest(handle, result.rule.id);
              await load({ mode, topic });
            },
          });
        })
        .catch((caught) => setNotice(caught instanceof Error ? caught.message : "Could not save that preference"));
    },
    [handle, load, mode, removeUnit, topic],
  );
  /** What "less like this" can name for a unit: its topics by label, its sources by folder. */
  const lessTargets = useCallback(
    (unit: HomeUnit): Array<{ kind: "topic_less" | "source_less"; target: string; label: string }> => {
      const topicsById = new Map((data?.topics ?? []).map((entry) => [entry.id, entry]));
      const topics = unit.topicIds
        .map((id) => topicsById.get(id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry) && entry!.kind !== "source")
        .map((entry) => ({ kind: "topic_less" as const, target: entry.id, label: entry.label }));
      const sources = unit.kind === "summary"
        ? unit.members.map((member) => ({ kind: "source_less" as const, target: member.folderPath, label: member.publisherName ?? member.sourceFolderName }))
        : [{ kind: "source_less" as const, target: unit.item.folderPath, label: unit.item.publisherName ?? unit.item.sourceFolderName }];
      const seen = new Set<string>();
      return [...topics, ...sources].filter((entry) => (seen.has(entry.target) ? false : (seen.add(entry.target), true)));
    },
    [data?.topics],
  );

  const focusIndexRef = useRef(focusIndex);
  useEffect(() => {
    focusIndexRef.current = focusIndex;
  }, [focusIndex]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
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
  }, [expanded, hideSummary, memberIndex, open, openOriginal, setRead, targetOf, toggleExpanded, toggleKeep, toggleStar, units]);
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

  const unhealthy = overview?.sources.filter((source) => !["healthy", "checking"].includes(source.health)) ?? [];
  const leadIndex = mode === "forYou" ? units.findIndex((unit) => unit.kind === "summary" && unit.imageUrl) : -1;

  return (
    <section className={`applecms ${styles.news}`} aria-label="News" data-home-news>
      <header className={styles.header}>
        <div className={styles.modes} role="group" aria-label="News mode">
          <button type="button" aria-pressed={mode === "forYou"} onClick={() => setMode("forYou")}>
            For you
          </button>
          <button type="button" aria-pressed={mode === "latest"} onClick={() => setMode("latest")}>
            Latest
          </button>
        </div>
        {data && mode === "forYou" && <span className={styles.modeNote}>{data.modeLabel}</span>}
        <span className={styles.spacer} />
        <div className={styles.utilities}>
          {unhealthy.length > 0 && (
            <button type="button" className={styles.attention} onClick={() => setManaging(true)} title={unhealthy[0].healthDetail ?? undefined}>
              <span className={styles.attentionDot} aria-hidden="true" />
              {unhealthy.length === 1 ? "1 source needs attention" : `${unhealthy.length} sources need attention`}
            </button>
          )}
          <div className={styles.menuWrap}>
            <button type="button" className={styles.menuButton} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              Reading
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu" onMouseLeave={() => setMenuOpen(false)}>
                {overview && (
                  <small>
                    {overview.totals.newSince24h} new today
                    {overview.totals.unread !== null ? `, ${overview.totals.unread} unread` : ""}, {overview.sources.length} {overview.sources.length === 1 ? "source" : "sources"}
                  </small>
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
                {canManage && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setManaging(true); }}>
                    Manage sources
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {data && data.topics.length > 0 && (
        <ul className={styles.topics} aria-label="Topics">
          <li>
            <button type="button" aria-pressed={topic === null} onClick={() => setTopic(null)}>
              All
            </button>
          </li>
          {data.topics.map((entry) => (
            <li key={entry.id}>
              <button type="button" aria-pressed={topic === entry.id} onClick={() => setTopic(entry.id)} title={entry.kind === "search" ? `Saved search: ${entry.detail}` : `Source folder`}>
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
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
      {data && units.length === 0 && !loading && (
        <p className={styles.empty}>{topic ? "Nothing in this topic yet." : "Nothing has arrived yet. Sources are checked when you open the workspace."}</p>
      )}
      <ol className={styles.list} role="listbox" aria-label={mode === "latest" ? "Latest articles" : "News"}>
        {units.map((unit, index) => {
          const focused = index === focusIndex;
          const lead = index === leadIndex;
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
                tabIndex={focused || (focusIndex < 0 && index === 0) ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => open(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(item);
                  }
                }}
              >
                <div className={styles.body}>
                  <p className={styles.eyebrow}>
                    <strong>{item.publisherName ?? item.sourceFolderName}</strong>
                    <time dateTime={unit.latestAt}>{relativeTime(unit.latestAt, now)}</time>
                    {!item.read && <span className={styles.state}>New to you</span>}
                  </p>
                  <h3 className={styles.headline}>{item.title}</h3>
                  {item.excerpt && <p className={styles.excerpt}>{item.excerpt}</p>}
                  <div className={styles.actions} onClick={(event) => event.stopPropagation()}>
                    <button type="button" className={styles.action} aria-pressed={item.keptReasons.includes("keep")} onClick={() => toggleKeep(item)}>
                      {item.keptReasons.includes("keep") ? "Kept" : "Keep"}
                    </button>
                    <button type="button" className={styles.action} onClick={() => setRead(item, !item.read)}>
                      {item.read ? "Unread" : "Read"}
                    </button>
                    <button type="button" className={styles.action} onClick={() => openOriginal(item)}>
                      Original
                    </button>
                    <button type="button" className={styles.action} aria-haspopup="menu" aria-expanded={unitMenu?.id === unit.id} onClick={() => setUnitMenu(unitMenu?.id === unit.id ? null : { id: unit.id, kind: "less" })}>
                      Less like this
                    </button>
                    {mode === "forYou" && (
                      <button type="button" className={styles.action} onClick={() => setUnitMenu(unitMenu?.id === unit.id && unitMenu.kind === "why" ? null : { id: unit.id, kind: "why" })}>
                        Why
                      </button>
                    )}
                  </div>
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
                {item.imageUrl && <img className={styles.thumb} src={item.imageUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.dataset.hidden = "true"; }} />}
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
              {lead && unit.imageUrl && <img className={styles.leadImage} src={unit.imageUrl} alt="" loading="eager" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
              <div className={styles.body}>
                <p className={styles.eyebrow}>
                  <strong>{unit.sources.length} {unit.sources.length === 1 ? "source" : "sources"}</strong>
                  <time dateTime={unit.latestAt}>{relativeTime(unit.latestAt, now)}</time>
                  {unit.seenRevision > 0 && unit.coverageRevision > unit.seenRevision ? (
                    <span className={styles.state}>New coverage</span>
                  ) : unit.unread > 0 ? (
                    <span className={styles.state}>{unit.unread === unit.members.length ? "New to you" : `${unit.unread} unread`}</span>
                  ) : null}
                </p>
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
                ) : (
                  representative.excerpt && <p className={styles.excerpt}>{representative.excerpt}</p>
                )}
                <p className={styles.sources} onClick={(event) => event.stopPropagation()}>
                  <button type="button" aria-expanded={isExpanded} onClick={() => toggleExpanded(unit.id)}>
                    {sourcesLabel(unit.sources)}
                  </button>
                  <span className={styles.actions}>
                    <button type="button" className={styles.action} aria-pressed={representative.keptReasons.includes("keep")} onClick={() => toggleKeep(representative)} title="Keeps the article the headline opens, not every source">
                      {representative.keptReasons.includes("keep") ? "Kept" : "Keep"}
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
              {!lead && unit.imageUrl && <img className={styles.thumb} src={unit.imageUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.dataset.hidden = "true"; }} />}
              {isExpanded && (
                <ul className={styles.members} onClick={(event) => event.stopPropagation()}>
                  {unit.members.map((member, position) => (
                    <li key={member.id} className={styles.member} data-read={member.read ? "true" : "false"} data-focused={focused && memberIndex === position ? "true" : "false"}>
                      <span>{member.publisherName ?? member.sourceFolderName}</span>
                      <button type="button" onClick={() => open(member)}>
                        {member.title}
                      </button>
                      <button type="button" className={styles.action} onClick={() => toggleKeep(member)} aria-pressed={member.keptReasons.includes("keep")}>
                        {member.keptReasons.includes("keep") ? "Kept" : "Keep"}
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
