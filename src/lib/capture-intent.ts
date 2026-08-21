import { parseItemInput } from "@/lib/item-creation";

export type CaptureFolder = {
  mode: string;
  path: string;
};

export type CaptureIntent = {
  body: string;
  kind: "bookmark" | "note";
  preferredFolderMode: "bookmarks" | "notes";
  sourceUrl: string | null;
  title: string;
};

function bookmarkTitle(sourceUrl: string): string {
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./i, "");
    return host || "Saved link";
  } catch {
    return "Saved link";
  }
}

/**
 * Turn the one thing somebody wants to keep into a private TextText item.
 * This is the routing contract shared by quick capture surfaces: links go to
 * Bookmarks and every other piece of text goes to Notes.
 */
export function captureIntent(value: string): CaptureIntent {
  const parsed = parseItemInput(value);
  if (parsed.sourceUrl) {
    const title = bookmarkTitle(parsed.sourceUrl);
    return {
      body: `[${title}](${parsed.sourceUrl})`,
      kind: "bookmark",
      preferredFolderMode: "bookmarks",
      sourceUrl: parsed.sourceUrl,
      title,
    };
  }
  return {
    body: parsed.body,
    kind: "note",
    preferredFolderMode: "notes",
    sourceUrl: null,
    title: parsed.title,
  };
}

/** Pick the shallowest matching folder so a workspace's primary inbox wins. */
export function captureFolderPath(
  folders: readonly CaptureFolder[],
  mode: CaptureIntent["preferredFolderMode"],
): string | null {
  const candidates = folders
    .filter((folder) => folder.mode === mode)
    .sort((left, right) => {
      const depth =
        left.path.split("/").length - right.path.split("/").length;
      return depth || left.path.localeCompare(right.path);
    });
  return candidates[0]?.path ?? null;
}
