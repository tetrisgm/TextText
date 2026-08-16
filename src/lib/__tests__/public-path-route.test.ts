import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blog, Post } from "@/lib/content";

const mocks = vi.hoisted(() => ({
  getBlog: vi.fn(),
  resolvePublicPostPath: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getBlog: mocks.getBlog,
  resolvePublicPostPath: mocks.resolvePublicPostPath,
}));

import { GET } from "@/app/t/[handle]/public-assets/markdown/[...path]/route";

const blog: Blog = {
  handle: "workspace",
  name: "Workspace",
  author: "Writer",
  homeLayout: "grid",
};
const post: Post = {
  id: "public-id",
  type: "article",
  slug: "field-notes",
  title: "Field notes",
  body: "Public body",
  visibility: "public",
  status: "published",
  revision: 1,
};

const request = (path: string[]) =>
  GET(
    new Request(
      `https://workspace.texttext.app/${path.join("/")}/index.md`,
    ),
    { params: Promise.resolve({ handle: blog.handle, path }) },
  );

describe("folder-qualified public route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlog.mockResolvedValue(blog);
  });

  it("serves only the exact published location with its folder canonical", async () => {
    mocks.resolvePublicPostPath.mockResolvedValue({
      kind: "exact",
      folderPath: "blog/research",
      post,
    });

    const response = await request(["blog", "research", post.slug]);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      'canonical: "https://workspace.texttext.app/blog/research/field-notes"',
    );
    expect(body).not.toContain("syncRevision:");
  });

  it("makes a private note byte-identical to a never-existing path", async () => {
    mocks.resolvePublicPostPath.mockResolvedValue({ kind: "missing" });

    const privateResponse = await request(["notes", "private-title"]);
    const missingResponse = await request(["blog", "never-existed"]);

    expect(privateResponse.status).toBe(404);
    expect(missingResponse.status).toBe(404);
    expect(await privateResponse.text()).toBe(await missingResponse.text());
  });

  it("returns the generic 404 after a tombstone target stops being public", async () => {
    mocks.resolvePublicPostPath.mockResolvedValue({ kind: "missing" });

    const response = await request(["blog", "old-public-location"]);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
