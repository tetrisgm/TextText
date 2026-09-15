"use client";

import type { FeedConnectionView } from "./connections.server";
import type { FeedCandidate } from "./fetch.server";
import type { ReadingFolderSummary, ReadingListItem, ReadingListPage, ReadingScope } from "./list.server";

/**
 * The browser's view of the reading API. Thin on purpose: every function is
 * one request to one route, with the workspace handle in the query so the
 * server resolves access itself.
 */

export type { FeedConnectionView, FeedCandidate, ReadingFolderSummary, ReadingListItem, ReadingListPage, ReadingScope };

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
  action: "pause" | "resume" | "detach" | "refresh";
  keepAllItems?: boolean;
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
