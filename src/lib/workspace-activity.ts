import type { WorkspacePoolPost } from "@/lib/pool/types";

export type SidebarDocumentSort =
  "recent" | "alphabetical" | "created" | "edited";

export type WorkspaceDocumentOpenHistory = Record<string, number>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const HISTORY_STORAGE_PREFIX = "write:workspace-document-opens:";
const MAX_HISTORY_ENTRIES = 200;

export const WORKSPACE_DOCUMENT_OPENED_EVENT =
  "write:workspace-document-opened";

export function sidebarDocumentTitle(post: WorkspacePoolPost): string {
  return post.title.trim() || "Untitled";
}

export function localDateKey(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function historyStorageKey(workspaceId: string): string {
  return `${HISTORY_STORAGE_PREFIX}${workspaceId}`;
}

export function readWorkspaceDocumentOpenHistory(
  workspaceId: string,
  storage?: StorageLike | null,
): WorkspaceDocumentOpenHistory {
  if (!workspaceId || !storage) return {};
  try {
    const parsed = JSON.parse(
      storage.getItem(historyStorageKey(workspaceId)) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          entry[0].length > 0 &&
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]) &&
          entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function writeWorkspaceDocumentOpen(
  workspaceId: string,
  postId: string,
  openedAt: number,
  storage?: StorageLike | null,
): WorkspaceDocumentOpenHistory {
  const current = readWorkspaceDocumentOpenHistory(workspaceId, storage);
  if (!workspaceId || !postId || !Number.isFinite(openedAt) || openedAt <= 0) {
    return current;
  }
  const next = Object.fromEntries(
    Object.entries({ ...current, [postId]: openedAt })
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_HISTORY_ENTRIES),
  );
  try {
    storage?.setItem(historyStorageKey(workspaceId), JSON.stringify(next));
  } catch {
    // A private or full browser storage area must not block navigation.
  }
  return next;
}

export function recordWorkspaceDocumentOpened(
  workspaceId: string,
  postId: string,
  openedAt = Date.now(),
): WorkspaceDocumentOpenHistory {
  const storage = typeof window === "undefined" ? null : window.localStorage;
  const next = writeWorkspaceDocumentOpen(
    workspaceId,
    postId,
    openedAt,
    storage,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_DOCUMENT_OPENED_EVENT, {
        detail: { workspaceId, postId, openedAt },
      }),
    );
  }
  return next;
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortSidebarDocuments(
  documents: WorkspacePoolPost[],
  sort: SidebarDocumentSort,
  openHistory: WorkspaceDocumentOpenHistory,
): WorkspacePoolPost[] {
  const next = [...documents];
  if (sort === "alphabetical") {
    return next.sort((a, b) =>
      sidebarDocumentTitle(a).localeCompare(
        sidebarDocumentTitle(b),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    );
  }
  if (sort === "recent") {
    return next.sort((a, b) => {
      const openDelta = (openHistory[b.id] ?? 0) - (openHistory[a.id] ?? 0);
      if (openDelta !== 0) return openDelta;
      return (
        timestamp(b.updatedAt ?? b.date) - timestamp(a.updatedAt ?? a.date)
      );
    });
  }
  const field = sort === "created" ? "createdAt" : "updatedAt";
  return next.sort(
    (a, b) => timestamp(b[field] ?? b.date) - timestamp(a[field] ?? a.date),
  );
}

export function groupDocumentsByCreatedDate(
  documents: WorkspacePoolPost[],
): Map<string, WorkspacePoolPost[]> {
  const byDate = new Map<string, WorkspacePoolPost[]>();
  for (const post of documents) {
    const key = localDateKey(post.createdAt ?? post.date);
    if (!key) continue;
    const list = byDate.get(key) ?? [];
    list.push(post);
    byDate.set(key, list);
  }
  return byDate;
}

export type CalendarDocumentAction =
  | { kind: "none" }
  | { kind: "open"; postId: string }
  | { kind: "filter"; dateKey: string; postIds: string[] };

export function calendarDocumentAction(
  date: string,
  documents: WorkspacePoolPost[],
): CalendarDocumentAction {
  if (documents.length === 0) return { kind: "none" };
  if (documents.length === 1) return { kind: "open", postId: documents[0].id };
  return {
    kind: "filter",
    dateKey: date,
    postIds: documents.map((post) => post.id),
  };
}
