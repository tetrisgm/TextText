import type { HomeNews, ReadingOverview, ReadingListItem } from "@/lib/reading/client";
import type { TimelineFilter, TimelinePage } from "@/lib/workspace/timeline";

type View = { mode: "forYou" | "latest"; topic: string | null };
const keyOf = (view: View) => `${view.mode}:${view.topic ?? ""}`;

/** Owned by one mounted workspace, never shared across people or persisted. */
export class HomeSession {
  private pages = new Map<string, HomeNews>();
  private timelines = new Map<TimelineFilter, TimelinePage>();
  personalFilter: TimelineFilter | "news" = "all";
  personalNews: ReadingListItem[] = [];
  getTimeline(filter: TimelineFilter) { return this.timelines.get(filter) ?? null; }
  saveTimeline(filter: TimelineFilter, page: TimelinePage) {
    if (page.entries.length <= 500) this.timelines.set(filter, page);
  }
  overview: ReadingOverview | null = null;
  checkedAt = 0;
  saveOverview(overview: ReadingOverview) { this.overview = overview; }
  markChecked(at: number) { this.checkedAt = at; }

  get(view: View) { return this.pages.get(keyOf(view)) ?? null; }
  save(page: HomeNews) {
    const key = keyOf(page);
    this.pages.delete(key);
    this.pages.set(key, page);
    // Each server snapshot is capped at 300 candidates; retain eight views.
    while (this.pages.size > 8) this.pages.delete(this.pages.keys().next().value!);
  }
  clear() { this.pages.clear(); this.timelines.clear(); this.personalNews = []; }
  patch(ids: string[], update: (item: ReadingListItem) => ReadingListItem) {
    const wanted = new Set(ids);
    const apply = (item: ReadingListItem) => wanted.has(item.id) ? update(item) : item;
    for (const [key, page] of this.pages) {
      const units = (values: HomeNews["units"]) => values.map((unit) => unit.kind === "article"
        ? { ...unit, item: apply(unit.item) }
        : { ...unit, members: unit.members.map(apply), representative: apply(unit.representative), unread: unit.members.map(apply).filter((item) => !item.read).length });
      this.pages.set(key, { ...page, units: units(page.units), headlines: units(page.headlines) });
    }
  }
}
