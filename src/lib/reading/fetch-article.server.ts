import { fetchPublicResource } from "@/lib/bookmark-fetch";
import { readBoundedBytes, readBoundedText } from "@/lib/http/bounded-json";
import { extractPDFText, MAX_CAPTURE_PDF_BYTES } from "./pdf-extraction.server";
import { extractArticleMarkdown } from "./article-extraction";
import { remoteMarkdownImageUrls } from "@/lib/markdown-images";
import type { ArticleCapture, ArticleCaptureMedia } from "@/lib/vault/article-capture";
import { createHash } from "node:crypto";

const MAX_ARCHIVED_IMAGE_BYTES = 1_000_000;

function absoluteImageSources(html: string, base: string): string {
  return html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix: string, quote: string, value: string) => {
      try {
        const url = new URL(value, base);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return match;
        return `${prefix}${quote}${url.href}${quote}`;
      } catch { return match; }
    });
}

async function boundedImage(response: Response, remoteURL: string): Promise<ArticleCaptureMedia | null> {
  if (!response.ok) { await response.body?.cancel(); return null; }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ARCHIVED_IMAGE_BYTES) { await response.body?.cancel(); return null; }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_ARCHIVED_IMAGE_BYTES) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  const ascii = (offset: number, length: number) => bytes.subarray(offset, offset + length).toString("ascii");
  const kind = bytes[0] === 137 && ascii(1, 3) === "PNG" ? { extension: "png", contentType: "image/png" as const }
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? { extension: "jpg", contentType: "image/jpeg" as const }
      : ["GIF87a", "GIF89a"].includes(ascii(0, 6)) ? { extension: "gif", contentType: "image/gif" as const }
        : ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP" ? { extension: "webp", contentType: "image/webp" as const }
          : null;
  if (!kind || bytes.length === 0) return null;
  const fingerprint = createHash("sha256").update(remoteURL).digest("hex").slice(0, 16);
  return { filename: `article-${fingerprint}.${kind.extension}`, contentType: kind.contentType,
    data: bytes.toString("base64"), remoteURL };
}

/** No cookies, scripts, browser process, or content writes. The caller saves
 * the result through its normal file revision checks. */
export async function fetchArticle(sourceURL: string, fetcher = fetchPublicResource, signal?: AbortSignal): Promise<ArticleCapture> {
  const url = new URL(sourceURL);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw new Error("Choose a public HTTP or HTTPS link without credentials.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { accept: "text/html,application/xhtml+xml,application/pdf", "user-agent": "TextText/1 article reader" } });
    const contentType = response?.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (response?.ok && ["application/pdf", "application/x-pdf"].includes(contentType ?? "")) {
      const result = await readBoundedBytes(response as unknown as Request, MAX_CAPTURE_PDF_BYTES);
      if ("error" in result) { await response.body?.cancel().catch(() => {}); throw new Error("This PDF is too large to capture. Open the original PDF instead."); }
      return { sourceURL: url.href, markdown: await extractPDFText(result.value, controller.signal), capturedAt: new Date().toISOString(), media: [] };
    }
    if (!response?.ok || !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType ?? "")) {
      await response?.body?.cancel();
      throw new Error("This page could not be read. Your saved link is still available.");
    }
    // Request and Response share the headers/body stream interface used here.
    const result = await readBoundedText(response as unknown as Request, 2_000_000);
    if ("error" in result) throw new Error("This page is too large to capture. Open the original link instead.");
    const pageURL = response.url || url.href;
    const markdown = extractArticleMarkdown(absoluteImageSources(result.value, pageURL));
    if (!markdown) throw new Error("No readable article was found. Open the original link instead.");
    const media: ArticleCaptureMedia[] = [];
    const imageURL = remoteMarkdownImageUrls(markdown)[0];
    if (imageURL) {
      try {
        const image = await fetcher(imageURL, { signal: controller.signal,
          headers: { accept: "image/png,image/jpeg,image/gif,image/webp", "user-agent": "TextText/1 article reader" } });
        if (image) {
          const archived = await boundedImage(image, imageURL);
          if (archived) media.push(archived);
        }
      } catch { /* Text remains useful when media is unavailable. */ }
    }
    return { sourceURL: url.href, markdown, capturedAt: new Date().toISOString(), media };
  } finally { signal?.removeEventListener("abort", abort); controller.abort(); clearTimeout(timeout); }
}
