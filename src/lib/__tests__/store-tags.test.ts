import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: null }));
import { DEMO_BLOG, DEMO_POSTS } from "@/lib/demo";
import { getPostsForTag } from "@/lib/store";

const snapshots = DEMO_POSTS.map((post) => ({
  post,
  status: post.status,
  visibility: post.visibility,
  tags: post.tags,
}));

afterEach(() => {
  for (const snapshot of snapshots) {
    snapshot.post.status = snapshot.status;
    snapshot.post.visibility = snapshot.visibility;
    snapshot.post.tags = snapshot.tags;
  }
});

describe("getPostsForTag", () => {
  it("keeps private kinds unlisted and honors the published guard", async () => {
    const tag = "privacy-gate-test";
    const publicPost = DEMO_POSTS.find((post) => post.type === "article")!;
    const draftPost = DEMO_POSTS.find(
      (post) => post.type === "project" || post.type === "talk",
    )!;
    const note = DEMO_POSTS.find((post) => post.type === "note")!;
    const bookmark = DEMO_POSTS.find((post) => post.type === "bookmark")!;
    publicPost.tags = [tag];
    draftPost.tags = [tag];
    draftPost.status = "draft";
    draftPost.visibility = "private";
    note.tags = [tag];
    bookmark.tags = [tag];

    const published = await getPostsForTag(DEMO_BLOG.handle, tag, {
      publishedOnly: true,
    });
    expect(published.map((post) => post.slug)).toEqual([publicPost.slug]);

    const ownerVisibleKinds = await getPostsForTag(DEMO_BLOG.handle, tag, {
      publishedOnly: false,
    });
    expect(ownerVisibleKinds.map((post) => post.slug)).toEqual(
      expect.arrayContaining([publicPost.slug, draftPost.slug]),
    );
    expect(ownerVisibleKinds.some((post) => post.type === "note")).toBe(false);
    expect(ownerVisibleKinds.some((post) => post.type === "bookmark")).toBe(
      false,
    );
    expect(ownerVisibleKinds.every((post) => post.starred === undefined)).toBe(
      true,
    );
  });
});
