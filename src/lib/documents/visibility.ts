import type { FolderMode } from "@/lib/content";
import type { DocumentVisibility } from "@/lib/documents/model";

/**
 * What a reader is allowed to see, decided by the folder the item lives in.
 *
 * This used to ask whether the item's TYPE was "note" or "bookmark", through a
 * parameter the code itself called `compatibilityType`. That rule only holds
 * while the set of kinds is closed, and it is not: item types are designed by
 * the assistant, so a workspace can hold kinds nobody has named yet. "Is a
 * runs-9eef4c private?" has no answer. "Is the folder it lives in private?"
 * always does, and it is also the question the person actually answered when
 * they filed the thing.
 *
 * Fail closed at every step. No folder means private, no request means
 * private, and a private folder overrides an explicit request to publish.
 */
export function resolveDocumentVisibility({
  requested,
  existing,
  folderMode,
}: {
  requested?: DocumentVisibility;
  existing?: DocumentVisibility;
  /** Undefined when the folder is unknown, which resolves private. */
  folderMode?: FolderMode;
}): DocumentVisibility {
  if (!folderMode) return "private";
  if (folderMode !== "blog") return "private";
  return requested ?? existing ?? "private";
}
