import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blog, Post } from "@/lib/content";

const mocks = vi.hoisted(() => ({
  getBlog: vi.fn(),
  resolvePostSlug: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getBlog: mocks.getBlog,
  resolvePostSlug: mocks.resolvePostSlug,
}));

import { GET } from "@/app/t/[handle]/[slug]/index.md/route";

const blog: Blog = {
  handle: "publication",
  username: "writer",
  name: "Publication",
  author: "Writer",
  cardStyle: "cover",
  homeLayout: "grid",
};
const post: Post = {
  id: "post-id",
  type: "article",
  slug: "canonical",
  title: "Canonical",
  body: "Body",
  status: "published",
  revision: 42,
};

describe("historical index.md routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlog.mockResolvedValue(blog);
  });

  it("redirects one visible historical alias without permanent caching", async () => {
    mocks.resolvePostSlug.mockResolvedValue({ kind: "history", post });
    const response = await GET(
      new Request("https://TextText.app/@writer/old-name/index.md"),
      { params: Promise.resolve({ handle: blog.handle, slug: "old-name" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      new URL("https://TextText.app/@writer/canonical/index.md").href,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps the internal sync revision out of public Markdown", async () => {
    mocks.resolvePostSlug.mockResolvedValue({ kind: "exact", post });
    const response = await GET(
      new Request("https://TextText.app/@writer/canonical/index.md"),
      { params: Promise.resolve({ handle: blog.handle, slug: post.slug }) },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("syncRevision:");
  });

  it("does not redirect an unlisted historical item", async () => {
    mocks.resolvePostSlug.mockResolvedValue({
      kind: "history",
      post: { ...post, type: "bookmark", status: "draft" },
    });
    const response = await GET(
      new Request("https://TextText.app/@writer/private-old/index.md"),
      { params: Promise.resolve({ handle: blog.handle, slug: "private-old" }) },
    );

    expect(response.status).toBe(404);
  });

  it("fails closed for an ambiguous alias", async () => {
    mocks.resolvePostSlug.mockResolvedValue({ kind: "ambiguous" });
    const response = await GET(
      new Request("https://TextText.app/@writer/shared/index.md"),
      { params: Promise.resolve({ handle: blog.handle, slug: "shared" }) },
    );

    expect(response.status).toBe(404);
  });
});
