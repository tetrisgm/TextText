import type {
  CollectionRenderSpec,
  CollectionViewSpec,
} from "@/lib/presentation/schema";

export type CollectionDisplayMode = "list" | "column" | "grid";

/**
 * Resolve one named folder view without mutating the validated template. The
 * item renderer and theme remain shared; only the safe collection query and
 * layout fields vary.
 */
export function selectCollectionView(
  collection: CollectionRenderSpec,
  viewId: string,
): CollectionRenderSpec {
  const view = collection.views.find((candidate) => candidate.id === viewId);
  if (!view) return collection;
  return {
    ...collection,
    layout: view.layout,
    columns: view.columns,
    groupBy: view.groupBy,
    dateBy: view.dateBy,
    sort: view.sort,
    filters: view.filters,
  };
}

export function displayModeForCollectionView(
  view: CollectionViewSpec | undefined,
  fallback: CollectionDisplayMode,
): CollectionDisplayMode {
  if (!view) return fallback;
  if (view.layout === "cards") return "grid";
  if (view.layout === "single") return "column";
  return "list";
}
