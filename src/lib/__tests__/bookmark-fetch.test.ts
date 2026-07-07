import { describe, expect, it } from "vitest";
import { extractPageMeta, isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";

describe("isFetchableBookmarkUrl (SSRF floor)", () => {
  const ok = (u: string) => expect(isFetchableBookmarkUrl(new URL(u))).toBe(true);
  const no = (u: string) => expect(isFetchableBookmarkUrl(new URL(u))).toBe(false);

  it("allows normal public hosts", () => {
    ok("https://example.com/article");
    ok("http://news.site.co.uk/x?y=1");
    ok("https://93.184.216.34/"); // public IP literal
  });

  it("refuses loopback and local names", () => {
    no("http://localhost/admin");
    no("http://localhost:3000/");
    no("https://printer.local/");
    no("http://intranet/"); // bare hostname
  });

  it("refuses private and link-local IP literals", () => {
    no("http://127.0.0.1/");
    no("http://10.0.0.5/");
    no("http://172.16.0.1/");
    no("http://172.31.255.255/");
    no("http://192.168.1.1/");
    no("http://169.254.169.254/latest/meta-data"); // cloud metadata
    no("http://0.0.0.0/");
  });

  it("allows 172.x outside the private block", () => {
    ok("http://172.15.0.1/");
    ok("http://172.32.0.1/");
  });

  it("refuses IPv6 literals and non-http schemes", () => {
    no("http://[::1]/");
    no("ftp://example.com/");
  });
});

describe("extractPageMeta", () => {
  it("prefers og tags and decodes entities", () => {
    const html = `<html><head>
      <title>Fallback &amp; title</title>
      <meta property="og:title" content="Real &quot;Title&quot;" />
      <meta property="og:description" content="A&#039;s description" />
      <meta property="og:site_name" content="Example &lt;Site&gt;" />
    </head><body></body></html>`;
    const meta = extractPageMeta(html);
    expect(meta.title).toBe('Real "Title"');
    expect(meta.description).toBe("A's description");
    expect(meta.siteName).toBe("Example <Site>");
  });

  it("falls back to the title tag and tolerates junk", () => {
    expect(extractPageMeta("<title>Just a page</title>").title).toBe(
      "Just a page",
    );
    expect(extractPageMeta("no tags at all")).toEqual({
      title: undefined,
      description: undefined,
      siteName: undefined,
    });
  });

  it("handles reversed attribute order", () => {
    const html =
      '<meta content="Reversed" property="og:title"><title>x</title>';
    expect(extractPageMeta(html).title).toBe("Reversed");
  });
});
