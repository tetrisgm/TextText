import { describe, expect, it } from "vitest";

delete process.env.DATABASE_URL;

const { DEMO_BLOG, DEMO_POSTS } = await import("@/lib/demo");
const { getPublicPostLocations } = await import("@/lib/store");
const { GET: sitemap } = await import(
  "@/app/t/[handle]/sitemap.xml/route"
);
const { GET: postsJson } = await import(
  "@/app/t/[handle]/posts.json/route"
);

describe("public URL side channels", () => {
  it("uses one published-only location set", async () => {
    const locations = await getPublicPostLocations(DEMO_BLOG.handle);

    expect(locations.length).toBeGreaterThan(0);
    expect(locations.every(({ post }) => post.visibility === "public")).toBe(true);
    expect(locations.every(({ post }) => post.status === "published")).toBe(true);
    expect(
      locations.every(({ post }) => post.type !== "note" && post.type !== "bookmark"),
    ).toBe(true);
  });

  it("keeps every draft and private title out of sitemap and JSON listings", async () => {
    const privateTitles = DEMO_POSTS.filter(
      (post) => post.status !== "published" || post.type === "note" || post.type === "bookmark",
    ).map((post) => post.title);
    const params = { params: Promise.resolve({ handle: DEMO_BLOG.handle }) };
    const [sitemapResponse, jsonResponse] = await Promise.all([
      sitemap(new Request("https://demo.texttext.app/sitemap.xml"), params),
      postsJson(new Request("https://demo.texttext.app/posts.json"), params),
    ]);
    const sitemapBody = await sitemapResponse.text();
    const jsonBody = await jsonResponse.text();

    for (const title of privateTitles) {
      expect(sitemapBody).not.toContain(title);
      expect(jsonBody).not.toContain(title);
    }
    expect(sitemapBody).toContain("https://demo.texttext.app/blog/");
    expect(jsonBody).toContain("https://demo.texttext.app/blog/");
    expect(sitemapBody).not.toContain("/t/demo/");
    expect(jsonBody).not.toContain("/t/demo/");
  });
});
