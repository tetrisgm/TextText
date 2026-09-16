"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addPost, refreshWorkspacePool } from "@/lib/pool/store";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { fetchReadingOverview, saveReadingBrief, setReadingItemsRead, tickReading, type ReadingListItem, type ReadingOverview } from "@/lib/reading/client";
import { ManageSourcesDialog } from "./ManageSourcesDialog";
import styles from "./Reading.module.css";

/**
 * The reading module on the workspace front page: sources and their health,
 * what is unread, the latest few, and two ways out: ask the assistant for a
 * grounded catch-up, or save a brief as a note of citations.
 */

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
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

export function catchMeUpPrompt(folderPath?: string | null): string {
  const scope = folderPath ? `in the "${folderPath}" folder` : "across every feed I follow";
  return `Catch me up on my reading ${scope}. Use list_reading_sources and search_reading to find what arrived recently, group the same news from different sources into one Summary, and write a short brief. Cite every claim with the article's id and original link, and say which source reported it. Do not invent anything that is not in an article.`;
}

export function ReadingOverviewModule({
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
  const [overview, setOverview] = useState<ReadingOverview | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingOpen = useRef<string | null>(null);
  const [openTick, setOpenTick] = useState(0);
  const [managing, setManaging] = useState(false);
  const reload = useCallback(() => {
    void fetchReadingOverview(handle).then(setOverview).catch(() => undefined);
  }, [handle]);

  // The app is its own scheduler: opening the front page checks stale
  // sources in a few bounded passes, then reads the overview.
  useEffect(() => {
    let cancelled = false;
    const STALE_MS = 30 * 60 * 1000;
    void (async () => {
      if (canManage) {
        try {
          const first = await fetchReadingOverview(handle);
          const newest = Math.max(0, ...first.sources.map((source) => (source.lastSuccessAt ? new Date(source.lastSuccessAt).getTime() : 0)));
          if (first.sources.length > 0 && Date.now() - newest > STALE_MS) {
            for (let pass = 0; pass < 3; pass += 1) {
              const result = await tickReading(handle, 3);
              if ((result.jobs.queued ?? 0) === 0) break;
            }
          } else if (!cancelled) {
            setOverview(first);
            return;
          }
        } catch {
          // A failed check is not an error the front page needs to show.
        }
      }
      return fetchReadingOverview(handle).then((result) => {
        if (!cancelled) setOverview(result);
      });
    })()
      .catch(() => {
        if (!cancelled) setOverview({ sources: [], totals: { items: 0, unread: null, newSince24h: 0 }, latest: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, handle]);

  // Same two-step open as the folder view: merge into the pool, then open
  // once the shell has re-rendered with a handler that can see the item.
  useEffect(() => {
    const id = pendingOpen.current;
    if (!id) return;
    pendingOpen.current = null;
    onOpenPost(id);
  }, [onOpenPost, openTick]);

  const open = useCallback(
    (item: ReadingListItem) => {
      pendingOpen.current = item.id;
      addPost(poolPostFor(item, blogId));
      if (!item.read) {
        setOverview((current) =>
          current
            ? {
                ...current,
                latest: current.latest.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)),
                totals: { ...current.totals, unread: current.totals.unread === null ? null : Math.max(0, current.totals.unread - 1) },
              }
            : current,
        );
        void setReadingItemsRead(handle, [item.id], true).catch(() => undefined);
      }
    },
    [blogId, handle],
  );

  const saveBrief = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await saveReadingBrief(handle);
      await refreshWorkspacePool(handle, blogId).catch(() => undefined);
      setNotice(`Saved a brief with ${result.items} ${result.items === 1 ? "article" : "articles"} to ${result.folderPath}.`);
      // The pool now holds the note; the effect above opens it after this
      // render, when the shell's handler can see it.
      pendingOpen.current = result.id;
      setOpenTick((tick) => tick + 1);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not save the brief");
    } finally {
      setSaving(false);
    }
  }, [blogId, handle, saving]);

  if (!overview || overview.sources.length === 0) return null;
  const unhealthy = overview.sources.filter((source) => !["healthy", "checking"].includes(source.health));

  return (
    <section className={`applecms ${styles.overview}`} aria-label="Reading">
      <header className={styles.overviewHeader}>
        <div>
          <h2>Reading</h2>
          <p className={styles.meta}>
            <span>
              <strong>{overview.totals.newSince24h}</strong> new today
            </span>
            {overview.totals.unread !== null && (
              <span>
                <strong>{overview.totals.unread}</strong> unread
              </span>
            )}
            <span>
              <strong>{overview.sources.length}</strong> {overview.sources.length === 1 ? "source" : "sources"}
            </span>
            {unhealthy.length > 0 && (
              <span className={styles.health}>
                <span className={styles.healthDot} data-health={unhealthy[0].health} aria-hidden="true" />
                {unhealthy.length === 1 ? "1 source needs attention" : `${unhealthy.length} sources need attention`}
              </span>
            )}
          </p>
        </div>
        <div className={styles.controls}>
          {assistantReady && (
            <button type="button" className={styles.button} onClick={() => onUseAssistantPrompt(catchMeUpPrompt())}>
              Catch me up
            </button>
          )}
          {canManage && (
            <button type="button" className={styles.button} onClick={() => void saveBrief()} disabled={saving}>
              {saving ? "Saving…" : "Save brief"}
            </button>
          )}
          {canManage && (
            <button type="button" className={styles.button} onClick={() => setManaging(true)}>
              Manage sources
            </button>
          )}
        </div>
      </header>
      {managing && (
        <ManageSourcesDialog
          handle={handle}
          blogId={blogId}
          folderPath=""
          folderName="all folders"
          onClose={() => setManaging(false)}
          onChanged={reload}
        />
      )}
      {notice && <p className={styles.note} role="status">{notice}</p>}
      <ul className={styles.sourceChips} aria-label="Sources">
        {overview.sources.map((source) => (
          <li key={source.id}>
            <button type="button" className={styles.sourceChip} onClick={() => onOpenSection(source.folderPath)} title={source.healthDetail ?? source.folderPath}>
              <span className={styles.healthDot} data-health={source.health} aria-hidden="true" />
              <span>{source.publisherTitle ?? source.folderName}</span>
              {source.unread !== null && source.unread > 0 && <small>{source.unread}</small>}
            </button>
          </li>
        ))}
      </ul>
      {overview.latest.length > 0 && (
        <ul className={styles.list} role="listbox" aria-label="Latest unread">
          {overview.latest.map((item) => (
            <li
              key={item.id}
              className={styles.row}
              role="option"
              aria-selected={false}
              data-read={item.read ? "true" : "false"}
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
                </p>
                <h3 className={styles.headline}>{item.title}</h3>
                {item.excerpt && <p className={styles.excerpt}>{item.excerpt}</p>}
              </div>
              <div className={styles.side}>
                <time dateTime={item.publishedAt ?? item.receivedAt}>{relativeTime(item.publishedAt ?? item.receivedAt)}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
