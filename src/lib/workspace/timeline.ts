import type { WorkspacePoolPost } from "@/lib/pool/types";

export type TimelineFilter = "all" | "writing" | "saved";
export type TimelineEntry = {
  id: string;
  at: string;
  kind: "created" | "saved" | "published";
  post: WorkspacePoolPost;
};
export type TimelinePage = {
  entries: TimelineEntry[];
  nextCursor: string | null;
  snapshot: string;
};

/** Refresh the covered range without moving existing rows or dropping older loaded pages. */
export function reconcileTimeline(previous: TimelinePage, fresh: TimelinePage, revalidatedWindow = false) {
  const byId = new Map(fresh.entries.map((entry) => [entry.id, entry]));
  const boundary = fresh.entries.at(-1);
  const covered = (entry: TimelineEntry) => !fresh.nextCursor || !boundary ||
    entry.at > boundary.at || (entry.at === boundary.at && entry.id >= boundary.id);
  const entries = previous.entries.flatMap((entry) => {
    const current = byId.get(entry.id);
    if (current) return current.at === entry.at ? [current] : [];
    return revalidatedWindow || covered(entry) ? [] : [entry];
  });
  const hasArrivals = fresh.entries.some((entry) => !previous.entries.some((old) => old.id === entry.id && old.at === entry.at));
  return {
    visible: { ...previous, entries, nextCursor: revalidatedWindow ? fresh.nextCursor : fresh.nextCursor ? previous.nextCursor : null },
    pending: hasArrivals ? fresh : null,
  };
}
