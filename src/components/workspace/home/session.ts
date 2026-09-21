import type { HomeNews, ReadingOverview, ReadingListItem } from "@/lib/reading/client";
import type { TimelineFilter, TimelinePage } from "@/lib/workspace/timeline";

type View = { mode: "forYou" | "latest"; topic: string | null };
const keyOf = (view: View) => `${view.mode}:${view.topic ?? ""}`;

/** Content snapshots stay in memory; view preferences survive in tab-session storage. */
export class HomeSession {
  bookmarks = { folderPath: "", later: false, search: "", query: "" };
  writing: { folderId: string | null; kind: "all" | "note" | "article"; limit: number } = { folderId: null, kind: "all", limit: 60 };
  constructor(private workspaceId?: string) {
    if (!workspaceId || typeof window === "undefined") return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(`texttext:views:${workspaceId}`) ?? "null");
      const bookmarks = saved?.bookmarks;
      if (bookmarks && typeof bookmarks.folderPath === "string" && typeof bookmarks.later === "boolean" && typeof bookmarks.search === "string" && typeof bookmarks.query === "string") {
        this.bookmarks = { folderPath: bookmarks.folderPath, later: bookmarks.later, search: bookmarks.search.slice(0, 200), query: bookmarks.query.slice(0, 200) };
      }
      const writing = saved?.writing;
      if (writing && (writing.folderId === null || typeof writing.folderId === "string") && ["all", "note", "article"].includes(writing.kind)) {
        this.writing = { folderId: writing.folderId, kind: writing.kind, limit: 60 };
      }
    } catch { /* Storage is optional; navigation remains usable. */ }
  }
  rememberViews() {
    if (!this.workspaceId || typeof window === "undefined") return;
    try { window.sessionStorage.setItem(`texttext:views:${this.workspaceId}`, JSON.stringify({ bookmarks: this.bookmarks, writing: this.writing })); } catch { /* Best effort. */ }
  }
  saveBookmarks(value: HomeSession["bookmarks"]) { this.bookmarks = value; this.rememberViews(); }
  saveWriting(value: HomeSession["writing"]) { this.writing = value; this.rememberViews(); }
  private pages = new Map<string, HomeNews>();
  private timelines = new Map<TimelineFilter, TimelinePage>();
  personalFilter: TimelineFilter | "news" = "all";
  accessDenied = false;
  setAccessDenied(value: boolean) {
    if (value) this.clear();
    this.accessDenied = value;
  }
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
  clear() { this.pages.clear(); this.timelines.clear(); this.personalNews = []; this.overview = null; this.checkedAt = 0; }
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
