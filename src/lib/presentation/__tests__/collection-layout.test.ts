import { describe, expect, it } from "vitest";
import { compileItemTypeBlueprint } from "../item-type-blueprint";
import { selectCollectionView } from "../collection-views";
import { queryCollectionItems, collectionDateGroups, collectionBoardGroups, collectionCalendarMonth, collectionHeatmapDays } from "../collection-layout";

const template = compileItemTypeBlueprint({
  name: "Due dates", fields: [
    { id: "due", label: "Due", type: "date" }, { id: "created", label: "Created", type: "date" },
    { id: "done", label: "Done", type: "boolean" },
    { id: "status", label: "Status", type: "enum", options: [{ value: "done", label: "Done" }] },
  ],
  collection: { layout: "list", views: [
    { id: "due", name: "Due", layout: "calendar", dateBy: "due", filters: [{ field: "done", op: "eq", value: true }], sort: [{ field: "title", direction: "desc" }] },
    { id: "status", name: "Status", layout: "board", groupBy: "status", sort: [{ field: "title", direction: "asc" }] },
  ], defaultView: "due" },
}, { id: "dates" });
const rows: import("@/lib/documents/collection-query").CollectionQueryable[] = [
  { title: "Alpha", fields: { due: "2026-08-29", created: "2026-08-19", done: true, status: "done" } },
  { title: "Zulu", fields: { due: "2026-08-29T12:00:00Z", done: true, status: "unknown" } },
  { title: "Excluded", fields: { due: "2026-08-31", done: false } },
  { title: "Last day", fields: { due: "2026-08-31", done: true } },
  { title: "Undated", fields: { created: "2026-08-19", done: true } },
];

describe("shared production collection model", () => {
  it("applies the default query before placing all matches by the configured date", () => {
    const collection = selectCollectionView(template.collection, template.collection.defaultView!);
    const sorted = queryCollectionItems(rows, collection);
    expect(sorted.map((row) => row.title)).toEqual(["Zulu", "Undated", "Last day", "Alpha"]);
    const groups = collectionDateGroups(sorted, collection, template.fields)!;
    expect(groups.byDay.get("2026-08-29")?.map((row) => row.title)).toEqual(["Zulu", "Alpha"]);
    expect(groups.byDay.get("2026-08-31")?.map((row) => row.title)).toEqual(["Last day"]);
    expect(groups.byDay.has("2026-08-19")).toBe(false);
    expect(groups.undated.map((row) => row.title)).toEqual(["Undated"]);
    expect(rows[0].title).toBe("Alpha");
  });
  it.each([[2026, 7, 31, 6], [2026, 8, 30, 2], [2028, 1, 29, 2], [2027, 1, 28, 1]])("includes every day and leading weekday cells for %i/%i", (year, month, count, blanks) => {
    const { cells } = collectionCalendarMonth(new Date(year, month, 1));
    expect(cells.filter((cell) => cell.day !== null)).toHaveLength(count);
    expect(cells.slice(0, blanks).every((cell) => cell.key === null)).toBe(true);
    expect(cells[blanks].day).toBe(1);
    expect(cells.at(-1)?.day).toBe(count);
  });
  it("keeps invalid date strings with undated items instead of losing them", () => {
    const invalid = ["2026-02-30", "2026-13-01", "not a date"].map((due) => ({ fields: { due } }));
    const groups = collectionDateGroups(invalid, template.collection, template.fields)!;
    expect(groups.byDay.size).toBe(0);
    expect(groups.undated).toEqual(invalid);
  });
  it("switches to a saved board query and retains unknown and unset values", () => {
    const collection = selectCollectionView(template.collection, "status");
    const groups = collectionBoardGroups(queryCollectionItems(rows, collection), collection, template.fields)!;
    expect(groups.columns[0].items.map((row) => row.title)).toEqual(["Alpha"]);
    expect(groups.unsorted.map((row) => row.title)).toEqual(["Excluded", "Last day", "Undated", "Zulu"]);
  });
  it("uses production system sort keys, stable multi-sort and pin priority", () => {
    const input = [
      { title: "A", updatedAt: "2026-09-01", fields: { rank: 1 } },
      { title: "B", updatedAt: "2026-09-03", fields: { rank: 1 } },
      { title: "C", updatedAt: "2026-09-02", fields: { rank: 2 }, pinned: true },
    ];
    expect(queryCollectionItems(input, null).map((row) => row.title)).toEqual(["C", "B", "A"]);
    expect(queryCollectionItems(input, { filters: [], sort: [{ field: "content.fields.rank", direction: "asc" }, { field: "updatedAt", direction: "desc" }] }).map((row) => row.title)).toEqual(["C", "B", "A"]);
  });
  it("counts every dated item for the heatmap and includes the last day", () => {
    const collection = { ...template.collection, layout: "heatmap" as const };
    const groups = collectionDateGroups(queryCollectionItems(rows, collection), collection, template.fields)!;
    const days = collectionHeatmapDays(new Map([...groups.byDay].map(([key, items]) => [key, items.length])), new Date(2026, 7, 31));
    expect(days.find((day) => day.key === "2026-08-29")?.count).toBe(2);
    expect(days.at(-1)).toEqual({ key: "2026-08-31", count: 1 });
  });
});
