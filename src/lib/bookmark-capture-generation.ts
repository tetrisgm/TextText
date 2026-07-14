import type {
  BookmarkCapture,
  BookmarkCaptureAsset,
  BookmarkCaptureScreenshotTile,
} from "./content";

const PENDING_GENERATION_KEY = "__writePendingGeneration" as const;
const COMPLETED_GENERATION_KEY = "__writeCompletedGeneration" as const;

export type BookmarkCaptureGeneration = {
  id: string;
  startedAt: string;
  capture: BookmarkCapture;
  readableMarkdown?: string;
  screenshotCount?: number;
};

export type StoredBookmarkCapture = BookmarkCapture & {
  [PENDING_GENERATION_KEY]?: BookmarkCaptureGeneration;
  [COMPLETED_GENERATION_KEY]?: string;
  htmlUrl?: unknown;
};

export type CaptureGenerationMutation =
  | { ok: true; storage: StoredBookmarkCapture; generation: BookmarkCaptureGeneration }
  | { ok: false; reason: "stale" | "invalid"; message: string };

export type CaptureGenerationFinalization =
  | {
      ok: true;
      capture: BookmarkCapture;
      readableMarkdown?: string;
    }
  | { ok: false; reason: "stale" | "incomplete"; message: string };

function validAssets(
  assets: BookmarkCaptureAsset[] | undefined,
): BookmarkCaptureAsset[] {
  const byOriginalUrl = new Map<string, BookmarkCaptureAsset>();
  for (const asset of assets ?? []) {
    if (asset.originalUrl?.trim() && asset.url?.trim()) {
      byOriginalUrl.set(asset.originalUrl, asset);
    }
  }
  return [...byOriginalUrl.values()];
}

function validTiles(
  tiles: BookmarkCaptureScreenshotTile[] | undefined,
): BookmarkCaptureScreenshotTile[] {
  const byIndex = new Map<number, BookmarkCaptureScreenshotTile>();
  for (const tile of tiles ?? []) {
    if (Number.isInteger(tile.index) && tile.index >= 0 && tile.url?.trim()) {
      byIndex.set(tile.index, tile);
    }
  }
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}

function cleanCapture(capture: BookmarkCapture): BookmarkCapture {
  const cleaned = { ...capture } as StoredBookmarkCapture;
  delete cleaned[PENDING_GENERATION_KEY];
  delete cleaned[COMPLETED_GENERATION_KEY];

  const assets = validAssets(cleaned.assets);
  if (assets.length > 0) cleaned.assets = assets;
  else delete cleaned.assets;

  const screenshotTiles = validTiles(cleaned.screenshotTiles);
  if (screenshotTiles.length > 0) {
    cleaned.screenshotTiles = screenshotTiles;
    cleaned.screenshotUrl = screenshotTiles[0]?.url ?? cleaned.screenshotUrl;
  } else {
    delete cleaned.screenshotTiles;
  }
  return cleaned;
}

export function publicBookmarkCapture(
  capture: BookmarkCapture | null | undefined,
): BookmarkCapture | undefined {
  if (!capture) return undefined;
  return cleanCapture(capture);
}

export function captureGeneration(
  capture: BookmarkCapture | null | undefined,
): BookmarkCaptureGeneration | undefined {
  if (!capture) return undefined;
  const generation = (capture as StoredBookmarkCapture)[PENDING_GENERATION_KEY];
  if (!generation?.id || !generation.capture?.url) return undefined;
  return {
    ...generation,
    capture: cleanCapture(generation.capture),
    screenshotCount:
      Number.isInteger(generation.screenshotCount) &&
      (generation.screenshotCount ?? 0) >= 0
        ? generation.screenshotCount
        : undefined,
  };
}

export function completedCaptureGeneration(
  capture: BookmarkCapture | null | undefined,
): string | undefined {
  if (!capture) return undefined;
  const generation = (capture as StoredBookmarkCapture)[COMPLETED_GENERATION_KEY];
  return typeof generation === "string" && generation.trim()
    ? generation
    : undefined;
}

function retainCompletedGeneration(
  capture: BookmarkCapture,
  previousStorage: BookmarkCapture | null | undefined,
): StoredBookmarkCapture {
  const completedGeneration = completedCaptureGeneration(previousStorage);
  return completedGeneration
    ? {
        ...cleanCapture(capture),
        [COMPLETED_GENERATION_KEY]: completedGeneration,
      }
    : cleanCapture(capture);
}

export function completeCaptureGeneration(
  capture: BookmarkCapture,
  generationId: string,
): StoredBookmarkCapture {
  return {
    ...cleanCapture(capture),
    [COMPLETED_GENERATION_KEY]: generationId,
  };
}

export function startCaptureGeneration(
  existing: BookmarkCapture | null | undefined,
  params: { id: string; url: string; startedAt: string },
): StoredBookmarkCapture {
  const stable = publicBookmarkCapture(existing) ?? ({ url: params.url } as BookmarkCapture);
  return {
    ...retainCompletedGeneration(stable, existing),
    url: stable.url || params.url,
    [PENDING_GENERATION_KEY]: {
      id: params.id,
      startedAt: params.startedAt,
      capture: { url: params.url },
    },
  };
}

export function retainCaptureGeneration(
  stable: BookmarkCapture,
  previousStorage: BookmarkCapture | null | undefined,
): StoredBookmarkCapture {
  const generation = captureGeneration(previousStorage);
  const retained = retainCompletedGeneration(stable, previousStorage);
  return generation
    ? { ...retained, [PENDING_GENERATION_KEY]: generation }
    : retained;
}

function mergeGenerationCapture(
  existing: BookmarkCapture,
  incoming: BookmarkCapture,
): BookmarkCapture {
  const merged = cleanCapture({ ...existing, ...incoming });
  const assets = validAssets([...(existing.assets ?? []), ...(incoming.assets ?? [])]);
  if (assets.length > 0) merged.assets = assets;
  const screenshotTiles = validTiles([
    ...(existing.screenshotTiles ?? []),
    ...(incoming.screenshotTiles ?? []),
  ]);
  if (screenshotTiles.length > 0) {
    merged.screenshotTiles = screenshotTiles;
    merged.screenshotUrl = screenshotTiles[0]?.url ?? merged.screenshotUrl;
  }
  return merged;
}

export function stageCaptureGeneration(
  storage: BookmarkCapture | null | undefined,
  generationId: string,
  incoming: BookmarkCapture,
  options: {
    startedAt: string;
    readableMarkdown?: string;
    screenshotCount?: number;
  },
): CaptureGenerationMutation {
  const current = captureGeneration(storage);
  if (completedCaptureGeneration(storage) === generationId) {
    return {
      ok: false,
      reason: "stale",
      message: `Capture generation ${generationId} has already completed`,
    };
  }
  if (current && current.id !== generationId) {
    return {
      ok: false,
      reason: "stale",
      message: `Capture generation ${generationId} is no longer current`,
    };
  }
  if (
    options.screenshotCount !== undefined &&
    (!Number.isInteger(options.screenshotCount) || options.screenshotCount < 0)
  ) {
    return {
      ok: false,
      reason: "invalid",
      message: "Screenshot count must be a non-negative integer",
    };
  }
  if (
    current?.screenshotCount !== undefined &&
    options.screenshotCount !== undefined &&
    current.screenshotCount !== options.screenshotCount
  ) {
    return {
      ok: false,
      reason: "invalid",
      message: "Screenshot count changed within one capture generation",
    };
  }

  const generation: BookmarkCaptureGeneration = {
    id: generationId,
    startedAt: current?.startedAt ?? options.startedAt,
    capture: mergeGenerationCapture(
      current?.capture ?? { url: incoming.url },
      incoming,
    ),
    readableMarkdown:
      options.readableMarkdown !== undefined
        ? options.readableMarkdown
        : current?.readableMarkdown,
    screenshotCount: options.screenshotCount ?? current?.screenshotCount,
  };
  const stable = publicBookmarkCapture(storage) ?? ({ url: incoming.url } as BookmarkCapture);
  const retained = retainCompletedGeneration(stable, storage);
  return {
    ok: true,
    generation,
    storage: { ...retained, [PENDING_GENERATION_KEY]: generation },
  };
}

export function remoteMarkdownImageUrls(markdown: string | undefined): string[] {
  if (!markdown) return [];
  const pattern =
    /!\[[^\]]*]\(\s*<?(https?:\/\/[^\s<>)]+)>?(?:\s+["'][^)]*["'])?\s*\)/gi;
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of markdown.matchAll(pattern)) {
    const url = match[1]?.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

export function finalizeCaptureGeneration(
  storage: BookmarkCapture | null | undefined,
  generationId: string,
): CaptureGenerationFinalization {
  const generation = captureGeneration(storage);
  if (!generation || generation.id !== generationId) {
    return {
      ok: false,
      reason: "stale",
      message: `Capture generation ${generationId} is no longer current`,
    };
  }

  const tiles = validTiles(generation.capture.screenshotTiles);
  if (generation.screenshotCount !== undefined) {
    const complete =
      tiles.length === generation.screenshotCount &&
      tiles.every((tile, index) => tile.index === index);
    if (!complete) {
      return {
        ok: false,
        reason: "incomplete",
        message: `Capture has ${tiles.length} of ${generation.screenshotCount} screenshot tiles`,
      };
    }
  }

  const assets = validAssets(generation.capture.assets);
  const savedOriginalUrls = new Set(assets.map((asset) => asset.originalUrl));
  const missingImages = remoteMarkdownImageUrls(generation.readableMarkdown).filter(
    (url) => !savedOriginalUrls.has(url),
  );
  if (missingImages.length > 0) {
    return {
      ok: false,
      reason: "incomplete",
      message: `Capture is missing ${missingImages.length} readable image asset${
        missingImages.length === 1 ? "" : "s"
      }`,
    };
  }

  const capture = cleanCapture(generation.capture);
  if (assets.length > 0) capture.assets = assets;
  if (tiles.length > 0) {
    capture.screenshotTiles = tiles;
    capture.screenshotUrl = tiles[0]?.url;
  }
  delete capture.error;
  return {
    ok: true,
    capture,
    readableMarkdown: generation.readableMarkdown,
  };
}

export function failCaptureGeneration(
  storage: BookmarkCapture | null | undefined,
  generationId: string,
  failure: BookmarkCapture,
): CaptureGenerationFinalization {
  if (completedCaptureGeneration(storage) === generationId) {
    return {
      ok: false,
      reason: "stale",
      message: `Capture generation ${generationId} has already completed`,
    };
  }
  const generation = captureGeneration(storage);
  if (generation && generation.id !== generationId) {
    return {
      ok: false,
      reason: "stale",
      message: `Capture generation ${generationId} is no longer current`,
    };
  }
  const stable = publicBookmarkCapture(storage) ?? ({ url: failure.url } as BookmarkCapture);
  return {
    ok: true,
    capture: cleanCapture({ ...stable, ...failure }),
  };
}
