import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import {
  applyArticleCapture,
  articleNeedsEnrichment,
  articleSource,
  type ArticleCapture,
} from "@/lib/vault/article-capture";
import { VaultError, type VaultFile, type VaultTransport } from "./bridge";
import { readDocument, writePayload } from "./model";

export type ArticleEnrichmentOutcome = "skipped" | "written" | "failed";
const QUEUE_PREFIX = "texttext:article-enrichment:v1:";
export const ARTICLE_ENRICHMENT_EVENT = "texttext:article-enrichment-queued";
type QueueStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): QueueStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

function queueKey(root: string): string { return QUEUE_PREFIX + encodeURIComponent(root); }

export function readArticleEnrichmentQueue(root: string, storage: QueueStorage | undefined = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(queueKey(root)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((path): path is string => typeof path === "string" && path.length > 0 && path.length <= 4096))].slice(-128);
  } catch { return []; }
}

function writeArticleEnrichmentQueue(root: string, paths: readonly string[], storage: QueueStorage | undefined = browserStorage()): void {
  if (!storage) return;
  try { storage.setItem(queueKey(root), JSON.stringify([...new Set(paths)].slice(-128))); }
  catch { /* The TextPack pending status and explicit retry remain available. */ }
}

/** Queue only a link whose TextPack create already succeeded. */
export function queueArticleEnrichment(root: string, path: string, storage?: QueueStorage): void {
  const target = storage ?? browserStorage();
  if (!target || !root || !path || path.length > 4096) return;
  const paths = readArticleEnrichmentQueue(root, target).filter((entry) => entry !== path);
  writeArticleEnrichmentQueue(root, [...paths, path], target);
  if (!storage && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ARTICLE_ENRICHMENT_EVENT, { detail: { root } }));
}

export function removeArticleEnrichment(root: string, path: string, storage?: QueueStorage): void {
  const target = storage ?? browserStorage();
  writeArticleEnrichmentQueue(root, readArticleEnrichmentQueue(root, target).filter((entry) => entry !== path), target);
}

function sameCapture(current: DocumentSnapshot, base: DocumentSnapshot): boolean {
  return articleSource(current) === articleSource(base) &&
    current.content.fields.capturedAt === base.content.fields.capturedAt &&
    current.content.fields.capturedSourceBody === base.content.fields.capturedSourceBody;
}

async function currentAfterConflict(path: string, error: unknown, request: VaultTransport,
  signal?: AbortSignal): Promise<VaultFile | null> {
  if (!(error instanceof VaultError) || error.code !== "conflict") throw error;
  return error.current ?? await request("read", { path }, signal) as VaultFile;
}

async function saveFailure(path: string, base: DocumentSnapshot, request: VaultTransport,
  signal?: AbortSignal): Promise<void> {
  let current = await request("read", { path }, signal) as VaultFile;
  for (let attempt = 0; attempt < 2; attempt++) {
    const document = readDocument(current);
    if (!sameCapture(document, base) || !articleNeedsEnrichment(document)) return;
    const fields = document.content.fields.captureStatus === "complete"
      ? { ...document.content.fields, captureMediaStatus: "failed" }
      : { ...document.content.fields, captureStatus: "failed" };
    const failed = validateDocumentSnapshot({ ...document,
      content: { ...document.content, fields } });
    try {
      await request("write", { ...writePayload(current, failed) }, signal);
      return;
    } catch (error) {
      current = await currentAfterConflict(path, error, request, signal) ?? current;
    }
  }
}

/** Enrich one already durable TextPack. Every merge and write uses the current
 * file revision, so edits made while extraction runs remain authoritative. */
export async function enrichArticleFile(path: string, request: VaultTransport,
  signal?: AbortSignal): Promise<ArticleEnrichmentOutcome> {
  const baseFile = await request("read", { path }, signal) as VaultFile;
  const base = readDocument(baseFile);
  if (!articleNeedsEnrichment(base)) return "skipped";
  const sourceURL = articleSource(base);
  if (!sourceURL) return "skipped";
  let capture: ArticleCapture;
  try {
    capture = await request("extractArticle", { sourceURL }, signal) as ArticleCapture;
  } catch (error) {
    if (signal?.aborted) throw error;
    await saveFailure(path, base, request, signal);
    return "failed";
  }
  if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
  let current = await request("read", { path }, signal) as VaultFile;
  for (let attempt = 0; attempt < 2; attempt++) {
    const document = readDocument(current);
    if (!articleNeedsEnrichment(document) || !sameCapture(document, base)) return "skipped";
    const merged = applyArticleCapture(document, base, capture, { archiveMedia: true }).document;
    try {
      await request("write", {
        ...writePayload(current, merged),
        addedAssets: capture.media ?? [],
      }, signal);
      return "written";
    } catch (error) {
      current = await currentAfterConflict(path, error, request, signal) ?? current;
    }
  }
  return "skipped";
}

export type ArticleEnrichmentTick = {
  cursor: number;
  scanned: number;
  outcome?: ArticleEnrichmentOutcome;
  path?: string;
};

/** Drain at most one explicitly queued path per tick. No folder-wide reads. */
export async function runArticleEnrichmentTick(paths: readonly string[], request: VaultTransport,
  options: { cursor?: number; maxScanned?: number; skipPath?: string; signal?: AbortSignal } = {}): Promise<ArticleEnrichmentTick> {
  if (!paths.length) return { cursor: 0, scanned: 0 };
  const start = Math.max(0, options.cursor ?? 0) % paths.length;
  const limit = Math.min(paths.length, Math.max(1, options.maxScanned ?? 8));
  let scanned = 0;
  for (; scanned < limit; scanned++) {
    const index = (start + scanned) % paths.length;
    const path = paths[index];
    if (path === options.skipPath) continue;
    try {
      const outcome = await enrichArticleFile(path, request, options.signal);
      return { cursor: (index + 1) % paths.length, scanned: scanned + 1, outcome, path };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw error;
    }
  }
  return { cursor: (start + scanned) % paths.length, scanned };
}
