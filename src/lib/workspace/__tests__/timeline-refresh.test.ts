import { describe, expect, it } from "vitest";
import { reconcileTimeline, type TimelineEntry, type TimelinePage } from "../timeline";

const entry = (id: string, at: string, title = id): TimelineEntry => ({ id, at, kind: "created", post: { id, blogId: "workspace", slug: id, title, type: "note", status: "draft", createdAt: at, updatedAt: at } });
const page = (entries: TimelineEntry[], nextCursor: string | null = null): TimelinePage => ({ entries, nextCursor, snapshot: "2026-09-21T00:00:00Z" });
describe("timeline refresh", () => {
  it("updates renamed entries and removes deleted entries without staging them", () => {
    const result = reconcileTimeline(page([entry("a", "3"), entry("b", "2")]), page([entry("a", "3", "Renamed")]));
    expect(result.visible.entries.map((item) => item.post.title)).toEqual(["Renamed"]);
    expect(result.pending).toBeNull();
  });
  it("stages new arrivals while retaining older loaded pages outside the refreshed range", () => {
    const result = reconcileTimeline(page([entry("a", "3"), entry("b", "2"), entry("c", "1")], "old-cursor"), page([entry("new", "4"), entry("b", "2")], "new-cursor"));
    expect(result.visible.entries.map((item) => item.id)).toEqual(["b", "c"]);
    expect(result.visible.nextCursor).toBe("old-cursor");
    expect(result.pending?.entries[0].id).toBe("new");
  });
  it("clears an exhausted timeline after all items are removed", () => {
    expect(reconcileTimeline(page([entry("a", "3")], "cursor"), page([])).visible).toMatchObject({ entries: [], nextCursor: null });
  });
  it("removes unverified older rows when the whole loaded window is revalidated", () => {
    const result = reconcileTimeline(page([entry("a", "3"), entry("revoked", "1")], "old-cursor"), page([entry("a", "3"), entry("new", "2")], "fresh-cursor"), true);
    expect(result.visible.entries.map((item) => item.id)).toEqual(["a"]);
    expect(result.visible.nextCursor).toBe("fresh-cursor");
    expect(result.pending?.entries.map((item) => item.id)).toEqual(["a", "new"]);
  });
});
