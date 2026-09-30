import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";

/** Capture provenance lives in the same pack as authored content. A later
 * extraction never has authority to replace a user's edit or selected look. */
export type ArticleCapture = { sourceURL: string; markdown: string; capturedAt: string };
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

export function applyArticleCapture(current: DocumentSnapshot, base: DocumentSnapshot, capture: ArticleCapture): CaptureApplication {
  const source = articleSource(current);
  if (!source || source !== articleSource(base) || source !== capture.sourceURL) throw new Error("The source link changed during capture. Read the current link before retrying.");
  if (!capture.markdown.trim() || capture.markdown.length > 2_000_000 || !Number.isFinite(Date.parse(capture.capturedAt))) throw new Error("The captured article is invalid.");
  const previous = base.content.fields.capturedSourceBody;
  // Initial link placeholder or the last captured article can be refreshed.
  // User-authored body, including edits made while fetching, is never replaced.
  const untouched = current.content.body === base.content.body &&
    (isLinkPlaceholder(base.content.body, source) || base.content.body.trim() === "" ||
      (typeof previous === "string" && base.content.body === previous));
  // A later capture or source edit has precedence over this late callback.
  if (current.content.fields.capturedSourceBody !== previous ||
    current.content.fields.capturedAt !== base.content.fields.capturedAt) throw new Error("A newer capture is already saved. Keep the current article.");
  const document = validateDocumentSnapshot({ ...current, content: { ...current.content,
    body: untouched ? capture.markdown : current.content.body,
    fields: { ...current.content.fields, capturedSourceBody: capture.markdown, capturedAt: capture.capturedAt, captureStatus: "complete" },
  } });
  return { document, appliedToBody: untouched };
}
