import { fetchPublicResource } from "@/lib/bookmark-fetch";
import { readBoundedText } from "@/lib/http/bounded-json";
import { extractArticleMarkdown } from "./article-extraction";
import type { ArticleCapture } from "@/lib/vault/article-capture";

/** No cookies, scripts, browser process, or content writes. The caller saves
 * the result through its normal file revision checks. */
export async function fetchArticle(sourceURL: string, fetcher = fetchPublicResource): Promise<ArticleCapture> {
  const url = new URL(sourceURL);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw new Error("Choose a public HTTP or HTTPS link without credentials.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { accept: "text/html", "user-agent": "TextText/1 article reader" } });
    if (!response?.ok || !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get("content-type") ?? "")) {
      await response?.body?.cancel();
      throw new Error("This page could not be read. Your saved link is still available.");
    }
    // Request and Response share the headers/body stream interface used here.
    const result = await readBoundedText(response as unknown as Request, 2_000_000);
    if ("error" in result) throw new Error("This page is too large to capture. Open the original link instead.");
    const markdown = extractArticleMarkdown(result.value);
    if (!markdown) throw new Error("No readable article was found. Open the original link instead.");
    return { sourceURL: url.href, markdown, capturedAt: new Date().toISOString() };
  } finally { controller.abort(); clearTimeout(timeout); }
}
