import { describe, expect, it, vi } from "vitest";
import type { fetchPublicResource } from "@/lib/bookmark-fetch";
import { fetchArticle } from "../fetch-article.server";
const html = `<article><h1>Readable story</h1>${"<p>A useful article contains enough words and detail to provide readers with a complete and meaningful account of the topic at hand.</p>".repeat(3)}<script>alert(1)</script></article>`;
describe("bounded article fetch", () => {
  it("uses the existing public-address fetcher and returns inert Markdown", async () => {
    const fetcher = vi.fn<typeof fetchPublicResource>(async () => new Response(html, { headers: { "Content-Type": "text/html" } }));
    const result = await fetchArticle("https://example.com/article", fetcher);
    expect(result.markdown).toContain("# Readable story");
    expect(result.markdown).not.toContain("alert");
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("credentials");
  });
  it("archives one bounded article image and resolves it against the page", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const withImage = `<article><h1>Readable story</h1><p><img src="/hero.png" alt="Hero">A useful article contains enough words and detail to provide readers with a complete and meaningful account of the topic at hand.</p>${"<p>A second paragraph carries enough words to make this a readable article rather than a small link card.</p>".repeat(3)}</article>`;
    const fetcher = vi.fn<typeof fetchPublicResource>(async (url) => String(url).endsWith("hero.png")
      ? new Response(png, { headers: { "Content-Type": "image/png" } })
      : new Response(withImage, { headers: { "Content-Type": "text/html" } }));
    const result = await fetchArticle("https://example.com/story", fetcher);
    expect(result.markdown).toContain("![Hero](https://example.com/hero.png)");
    expect(result.media).toEqual([expect.objectContaining({
      contentType: "image/png", data: Buffer.from(png).toString("base64"), remoteURL: "https://example.com/hero.png",
    })]);
    expect(result.media?.[0]?.filename).toMatch(/^article-[a-f0-9]{16}\.png$/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("aborts unread oversized responses when the declared size exceeds the limit", async () => {
    let signal: AbortSignal | undefined;
    await expect(fetchArticle("https://example.com/", async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Response("pending", { headers: { "Content-Type": "text/html", "Content-Length": "3000000" } });
    })).rejects.toThrow(/too large/);
    expect(signal?.aborted).toBe(true);
  });
  it("rejects credentials before fetching", async () => {
    const fetcher = vi.fn();
    await expect(fetchArticle("https://user:secret@example.com/", fetcher)).rejects.toThrow(/without credentials/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects non-articles, network refusal, and oversized streamed responses", async () => {
    await expect(fetchArticle("https://example.com/", async () => null)).rejects.toThrow(/could not be read/);
    await expect(fetchArticle("https://example.com/", async () => new Response("Hi", { headers: { "Content-Type": "text/html" } }))).rejects.toThrow(/No readable/);
    await expect(fetchArticle("https://example.com/", async () => new Response("x".repeat(2_000_001), { headers: { "Content-Type": "text/html" } }))).rejects.toThrow(/too large/);
  });
});
