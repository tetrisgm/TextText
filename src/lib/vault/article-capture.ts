import { validateDocumentSnapshot, type DocumentAsset, type DocumentSnapshot } from "@/lib/documents/model";
import { localizeRemoteMarkdownImages } from "@/lib/markdown-images";

/** Capture provenance lives in the same pack as authored content. A later
 * extraction never has authority to replace a user's edit or selected look. */
export type ArticleCaptureMedia = {
  filename: string;
  contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
  remoteURL: string;
};
export type ArticleCapture = {
  sourceURL: string;
  markdown: string;
  capturedAt: string;
  media?: ArticleCaptureMedia[];
};
export type CaptureApplication = { document: DocumentSnapshot; appliedToBody: boolean };

export function articleSource(document: DocumentSnapshot): string | null {
  const source = document.content.fields.sourceUrl;
  if (typeof source !== "string") return null;
  try {
    const url = new URL(source);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function isLinkPlaceholder(body: string, source: string): boolean {
  try { return /^https?:\/\/\S+$/i.test(body.trim()) && new URL(body.trim()).href === source; }
  catch { return false; }
}

export function articleNeedsEnrichment(document: DocumentSnapshot): boolean {
  if (!articleSource(document)) return false;
  const capture = document.content.fields.captureStatus;
  const media = document.content.fields.captureMediaStatus;
  if (capture === "pending") return true;
  if (capture === "complete") return media === "pending";
  return false;
}

function validatedMedia(capture: ArticleCapture): ArticleCaptureMedia[] {
  if (!capture.media) return [];
  if (!Array.isArray(capture.media) || capture.media.length > 1) throw new Error("The captured article media is invalid.");
  return capture.media.map((media) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(media.filename) ||
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(media.contentType) ||
        typeof media.data !== "string" || media.data.length > 1_400_000 ||
        media.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(media.data) ||
        media.data.indexOf("=") >= 0 && !/^[^=]*={1,2}$/.test(media.data)) {
      throw new Error("The captured article media is invalid.");
    }
    const url = new URL(media.remoteURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("The captured article media is invalid.");
    return { ...media, remoteURL: url.href };
  });
}

function archiveMedia(document: DocumentSnapshot, capture: ArticleCapture): { document: DocumentSnapshot; markdown: string } {
  const media = validatedMedia(capture);
  const replacements = new Map(media.map((asset) => [asset.remoteURL, `assets/${asset.filename}`]));
  const additions: DocumentAsset[] = media.map((asset) => ({
    id: asset.filename.slice(0, 120), kind: "image", src: `assets/${asset.filename}`,
    contentType: asset.contentType,
  }));
  const existing = new Set(document.content.assets.map((asset) => asset.src));
  return {
    markdown: localizeRemoteMarkdownImages(capture.markdown, replacements),
    document: { ...document, content: { ...document.content,
      assets: [...document.content.assets, ...additions.filter((asset) => !existing.has(asset.src))],
    } },
  };
}

export function applyArticleCapture(current: DocumentSnapshot, base: DocumentSnapshot, capture: ArticleCapture,
  options: { archiveMedia?: boolean } = {}): CaptureApplication {
  const source = articleSource(current);
  if (!source || source !== articleSource(base) || source !== capture.sourceURL) throw new Error("The source link changed during capture. Read the current link before retrying.");
  if (!capture.markdown.trim() || capture.markdown.length > 2_000_000 || !Number.isFinite(Date.parse(capture.capturedAt))) throw new Error("The captured article is invalid.");
  const prepared = options.archiveMedia ? archiveMedia(current, capture) : { document: current, markdown: capture.markdown };
  const previous = base.content.fields.capturedSourceBody;
  // Initial link placeholder or the last captured article can be refreshed.
  // User-authored body, including edits made while fetching, is never replaced.
  const untouched = current.content.body === base.content.body &&
    (isLinkPlaceholder(base.content.body, source) || base.content.body.trim() === "" ||
      (typeof previous === "string" && base.content.body === previous));
  // A later capture or source edit has precedence over this late callback.
  if (current.content.fields.capturedSourceBody !== previous ||
    current.content.fields.capturedAt !== base.content.fields.capturedAt) throw new Error("A newer capture is already saved. Keep the current article.");
  const document = validateDocumentSnapshot({ ...prepared.document, content: { ...prepared.document.content,
    body: untouched ? prepared.markdown : current.content.body,
    fields: { ...current.content.fields, capturedSourceBody: prepared.markdown, capturedAt: capture.capturedAt,
      captureStatus: "complete", captureMediaStatus: options.archiveMedia || validatedMedia(capture).length === 0 ? "complete" : "pending" },
  } });
  return { document, appliedToBody: untouched };
}
