import { fetchReadingPage, type ReadingListPage } from "./client";

export type SavedLibraryView = { handle: string; folderPath: string; query: string; state: "saved" | "read" | "bookmarked" };
export const savedLibraryKey = (view: SavedLibraryView) => JSON.stringify([view.handle, view.folderPath, view.query, view.state]);
export const savedLibraryScope = (view: SavedLibraryView) => ({ folderPath: view.folderPath, query: view.query, includeDescendants: true, state: view.state, dateBasis: view.state === "read" ? "read" as const : "received" as const });

/** Replace the loaded window with currently authorized rows, including older pages. */
export async function refreshSavedLibrary(view: SavedLibraryView, loadedCount: number): Promise<ReadingListPage> {
  const count = Math.max(40, Math.min(500, loadedCount));
  let page = await fetchReadingPage({ handle: view.handle, scope: savedLibraryScope(view), limit: Math.min(100, count) });
  let items = page.items;
  while (page.nextCursor && items.length < count) {
    page = await fetchReadingPage({ handle: view.handle, scope: savedLibraryScope(view), cursor: page.nextCursor, limit: Math.min(100, count - items.length) });
    items = [...items, ...page.items];
  }
  return { ...page, items };
}
