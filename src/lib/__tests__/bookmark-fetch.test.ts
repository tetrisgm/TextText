import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractPageMeta,
  fetchPublicResource,
  isFetchableBookmarkUrl,
  isPrivateIPv4,
  isPrivateIPv6,
} from "@/lib/bookmark-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    no("http://app.localhost/admin"); // *.localhost resolves to loopback
    no("http://foo.bar.localhost:3000/");
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

describe("isPrivateIPv4 (the DNS-resolution gate's classifier)", () => {
  it("flags every private, loopback, link-local, CGNAT, and reserved range", () => {
    for (const ip of [
      "0.0.0.0",
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(true);
    }
  });

  it("passes real public addresses", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1"]) {
      expect(isPrivateIPv4(ip), ip).toBe(false);
    }
  });

  it("rejects malformed literals defensively", () => {
    expect(isPrivateIPv4("999.1.1.1")).toBe(true);
    expect(isPrivateIPv4("1.2.3")).toBe(true);
  });
});

describe("fetchPublicResource", () => {
  it("refuses a redirect from a public URL to a private address", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchPublicResource("https://93.184.216.34/image.jpg");

    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://93.184.216.34/image.jpg",
    );
  });
});

describe("isPrivateIPv6", () => {
  it("flags loopback, ULA, link-local, and mapped-private-IPv4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIPv6(ip), ip).toBe(true);
    }
  });

  it("passes public v6 and mapped-public-IPv4", () => {
    expect(isPrivateIPv6("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIPv6("::ffff:8.8.8.8")).toBe(false);
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
