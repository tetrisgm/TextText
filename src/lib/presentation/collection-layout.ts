import { applyCollectionSpec, FIELD_PREFIX, type CollectionQueryable } from "@/lib/documents/collection-query";
import type { CollectionRenderSpec, DocumentFieldDefinition } from "./schema";

/** Shared by the folder and its authoring preview. Pinning stays outside the
 * declarative query, and an unspecified query keeps the historical date order. */
export function queryCollectionItems<T extends CollectionQueryable & { pinned?: boolean }>(
  items: T[],
  collection: Pick<CollectionRenderSpec, "sort" | "filters"> | null | undefined,
): T[] {
  const queried = collection && (collection.sort.length || collection.filters.length)
    ? applyCollectionSpec(items, collection)
    : [...items].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  return queried.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

export function collectionDateGroups<T extends CollectionQueryable>(
  items: readonly T[],
  collection: CollectionRenderSpec | null | undefined,
  fields: readonly DocumentFieldDefinition[],
) {
  if (!collection?.dateBy || !["calendar", "heatmap"].includes(collection.layout)) return null;
  const id = collection.dateBy.slice(FIELD_PREFIX.length);
  if (!fields.some((field) => field.id === id && field.type === "date")) return null;
  const byDay = new Map<string, T[]>();
  const undated: T[] = [];
  for (const item of items) {
    const value = item.fields[id];
    const key = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
    // Row dates are strings in schema v1. Impossible dates belong with the
    // undated items, and must not become an invalid preview month anchor.
    const date = key ? new Date(`${key}T12:00:00`) : null;
    if (!key || !date || Number.isNaN(date.getTime()) || collectionDayKey(date) !== key) undated.push(item);
    else {
      const bucket = byDay.get(key) ?? [];
      bucket.push(item);
      byDay.set(key, bucket);
    }
  }
  return { byDay, undated };
}

export function collectionBoardGroups<T extends CollectionQueryable>(
  items: readonly T[],
  collection: CollectionRenderSpec | null | undefined,
  fields: readonly DocumentFieldDefinition[],
) {
  if (collection?.layout !== "board" || !collection.groupBy) return null;
  const id = collection.groupBy.slice(FIELD_PREFIX.length);
  const field = fields.find((entry) => entry.id === id);
  if (field?.type !== "enum") return null;
  const known = new Set(field.options.map((option) => option.value));
  const columns = field.options.map((option) => ({
    ...option,
    tone: option.tone ?? "neutral",
    items: items.filter((item) => item.fields[id] === option.value),
  }));
  const unsorted = items.filter((item) => {
    const value = item.fields[id];
    return typeof value !== "string" || !known.has(value);
  });
  return { columns, unsorted };
}

export function collectionDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function collectionCalendarMonth(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: { key: string | null; day: number | null }[] = Array.from(
    { length: first.getDay() }, () => ({ key: null, day: null }),
  );
  for (let day = 1; day <= length; day += 1) {
    cells.push({ key: collectionDayKey(new Date(first.getFullYear(), first.getMonth(), day)), day });
  }
  return { monthLabel: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }), cells };
}

export function collectionHeatmapDays(counts: ReadonlyMap<string, number>, today: Date) {
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());
  const days: { key: string; count: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const key = collectionDayKey(cursor);
    days.push({ key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
