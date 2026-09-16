"use client";

import type { FeedConnectionView } from "./connections.server";
import type { FeedCandidate } from "./fetch.server";
import type { ReadingFolderSummary, ReadingListItem, ReadingListPage, ReadingScope } from "./list.server";
import type { ReadingOverview } from "./overview.server";
import type { ReadingSummary } from "./summaries.server";
import type { SavedReadingSearch } from "./saved-searches.server";

/**
 * The browser's view of the reading API. Thin on purpose: every function is
 * one request to one route, with the workspace handle in the query so the
 * server resolves access itself.
 */

export type { FeedConnectionView, FeedCandidate, ReadingFolderSummary, ReadingListItem, ReadingListPage, ReadingScope, ReadingOverview, ReadingSummary, SavedReadingSearch };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  }
  return body;
}

export function fetchReadingPage(input: {
  handle: string;
  scope: ReadingScope;
  cursor?: string | null;
  limit?: number;
}): Promise<ReadingListPage & { summary: ReadingFolderSummary | null }> {
  const params = new URLSearchParams({
    handle: input.handle,
    folder: input.scope.folderPath,
    descendants: input.scope.includeDescendants ? "1" : "0",
    state: input.scope.state,
    dateBasis: input.scope.dateBasis,
    direction: input.scope.direction ?? "newest",
  });
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.limit) params.set("limit", String(input.limit));
  return request(`/api/workspace/reading/items?${params.toString()}`);
}

export function fetchFeedConnections(handle: string): Promise<{ connections: FeedConnectionView[] }> {
  return request(`/api/workspace/reading/feeds?handle=${encodeURIComponent(handle)}`);
}

export function discoverFeeds(
  handle: string,
  input: string,
): Promise<{ candidates: FeedCandidate[]; pageTitle: string | null; detail: string | null }> {
  return request(`/api/workspace/reading/discover?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, input }),
  });
}

export function addFeed(input: {
  handle: string;
  parentFolderPath: string;
  url: string;
  name?: string | null;
  retentionDays?: number | null;
  initialImportLimit?: number | null;
}): Promise<{
  connection: FeedConnectionView;
  folder: { id: string; path: string; name: string };
  created: boolean;
  imported: { done: number; failed: number } | null;
}> {
  return request(`/api/workspace/reading/feeds?handle=${encodeURIComponent(input.handle)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function manageFeed(input: {
  handle: string;
  id: string;
  action: "pause" | "resume" | "detach" | "refresh" | "settings" | "adopt_move";
  keepAllItems?: boolean;
  settings?: { name?: string; retentionDays?: number | null; mutedKeywords?: string[] };
}): Promise<{ connection?: FeedConnectionView; queued?: boolean }> {
  return request(`/api/workspace/reading/feeds/${encodeURIComponent(input.id)}?handle=${encodeURIComponent(input.handle)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function tickReading(handle: string, limit = 3): Promise<{
  queued: number;
  ran: { leased: number; done: number; failed: number };
  jobs: Record<string, number>;
}> {
  return request(`/api/workspace/reading/tick?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, limit }),
  });
}

export function setReadingItemsRead(handle: string, ids: string[], read: boolean): Promise<{ ok: true; count: number }> {
  return request(`/api/workspace/reading/items?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, action: read ? "read" : "unread", ids }),
  });
}

export function setReadingItemsKept(handle: string, ids: string[], keep: boolean): Promise<{ ok: true; count: number }> {
  return request(`/api/workspace/reading/items?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, action: keep ? "keep" : "unkeep", ids }),
  });
}

export function cleanupReading(
  handle: string,
  mode: "preview" | "run",
): Promise<
  | { expiring: Array<{ id: string; title: string; expiresAt: string }>; protected: Array<{ id: string; title: string; reason: string }>; truncated: boolean }
  | { trashed: number; protected: number; skipped: number; truncated: boolean; dryRun: boolean }
> {
  return request(`/api/workspace/reading/cleanup?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, mode }),
  });
}

export function fetchReadingOverview(handle: string): Promise<ReadingOverview> {
  return request(`/api/workspace/reading/overview?handle=${encodeURIComponent(handle)}`);
}

export function fetchReadingSummaries(
  handle: string,
  folderPath: string,
): Promise<{ summaries: Array<ReadingSummary & { text: string | null }>; considered: number; singles: number }> {
  const params = new URLSearchParams({ handle, folder: folderPath });
  return request(`/api/workspace/reading/summaries?${params.toString()}`);
}

export function saveReadingBrief(handle: string, folderPath?: string | null): Promise<{ id: string; slug: string; folderPath: string; items: number }> {
  return request(`/api/workspace/reading/brief?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, folder: folderPath ?? "" }),
  });
}

export function markReadingScopeRead(handle: string, folderPath: string): Promise<{ ok: true; count: number }> {
  return request(`/api/workspace/reading/items?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, action: "read_all", folder: folderPath }),
  });
}

export function importOpml(input: { handle: string; parentFolderPath: string; opml: string }): Promise<{
  results: Array<{ url: string; title: string | null; status: "added" | "existing" | "failed"; detail?: string; folderPath?: string }>;
  skipped: number;
}> {
  return request(`/api/workspace/reading/opml?handle=${encodeURIComponent(input.handle)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function opmlExportUrl(handle: string): string {
  return `/api/workspace/reading/opml?handle=${encodeURIComponent(handle)}`;
}

export function fetchReadingNeighbors(
  handle: string,
  id: string,
  dateBasis: "published" | "received" = "published",
): Promise<{ previous: ReadingListItem | null; next: ReadingListItem | null; current: ReadingListItem | null }> {
  const params = new URLSearchParams({ handle, id, dateBasis });
  return request(`/api/workspace/reading/neighbors?${params.toString()}`);
}

export function extractReadingItem(
  handle: string,
  id: string,
): Promise<
  | { outcome: "applied"; characters: number }
  | { outcome: "recorded"; characters: number; reason: "edited" }
  | { outcome: "unavailable"; reason: "no_link" | "unreachable" | "not_readable" }
> {
  return request(`/api/workspace/reading/items?handle=${encodeURIComponent(handle)}`, {
    method: "POST",
    body: JSON.stringify({ handle, action: "extract", ids: [id] }),
  });
}

export function searchReadingList(handle: string, folderPath: string, query: string): Promise<{ items: ReadingListItem[]; semantic: boolean; total: number }> {
  const params = new URLSearchParams({ handle, folder: folderPath, q: query });
  return request(`/api/workspace/reading/search?${params.toString()}`);
}

export function fetchSavedSearches(handle: string, folderPath: string): Promise<{ searches: SavedReadingSearch[] }> {
  const params = new URLSearchParams({ handle, folder: folderPath });
  return request(`/api/workspace/reading/searches?${params.toString()}`);
}

export function saveSearch(handle: string, input: { name: string; query: string; folder: string }): Promise<{ search: SavedReadingSearch }> {
  return request(`/api/workspace/reading/searches?handle=${encodeURIComponent(handle)}`, { method: "POST", body: JSON.stringify({ handle, ...input }) });
}

export function deleteSavedSearchRequest(handle: string, id: string): Promise<{ ok: boolean }> {
  return request(`/api/workspace/reading/searches?handle=${encodeURIComponent(handle)}`, { method: "DELETE", body: JSON.stringify({ handle, id }) });
}

export function setSavedSearchAlert(handle: string, id: string, notify: boolean): Promise<{ ok: boolean }> {
  return request(`/api/workspace/reading/searches?handle=${encodeURIComponent(handle)}`, { method: "PATCH", body: JSON.stringify({ handle, id, notify }) });
}

export function fetchDigestSetting(handle: string): Promise<{ hour: number | null; sentOn: string | null }> {
  return request(`/api/workspace/reading/digest?handle=${encodeURIComponent(handle)}`);
}

export function setDigestHour(handle: string, hour: number | null): Promise<{ hour: number | null; sentOn: string | null }> {
  return request(`/api/workspace/reading/digest?handle=${encodeURIComponent(handle)}`, { method: "POST", body: JSON.stringify({ handle, hour }) });
}

export function sendDigestNow(handle: string): Promise<{ sent: boolean; reason: string | null; articles: number; alerts: number; to: string | null }> {
  return request(`/api/workspace/reading/digest?handle=${encodeURIComponent(handle)}`, { method: "POST", body: JSON.stringify({ handle, action: "send" }) });
}

export function readingExportUrl(handle: string, folderPath: string, state: "all" | "kept", format: "json" | "csv"): string {
  const params = new URLSearchParams({ handle, folder: folderPath, state, format });
  return `/api/workspace/reading/export?${params.toString()}`;
}
