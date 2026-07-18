import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS, normalizeTag, normalizeTags } from "@/lib/tags";
import { allTagsInPool, poolPostsForTag } from "@/lib/pool/selectors";
import type { WorkspacePoolPost } from "@/lib/pool/types";

describe("normalizeTags", () => {
  it("trims, strips hashes, lowercases, and keeps first-seen order", () => {
    expect(
      normalizeTags(["  #Design ", "Notes", "design", "", 12, "# Deep  Work "]),
    ).toEqual(["design", "notes", "deep work"]);
  });

  it("accepts a comma string and ignores unsupported values", () => {
    expect(normalizeTags("One, #Two, one")).toEqual(["one", "two"]);
    expect(normalizeTags({ tags: ["hidden"] })).toEqual([]);
    expect(normalizeTag("### Focus ")).toBe("focus");
  });

  it("caps both tag count and tag length", () => {
    const tags = normalizeTags(
      Array.from({ length: MAX_TAGS + 8 }, (_, index) =>
        `${index}-${"x".repeat(MAX_TAG_LENGTH + 10)}`,
      ),
    );
    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags.every((tag) => tag.length <= MAX_TAG_LENGTH)).toBe(true);
  });
});

describe("tag pool selectors", () => {
  const post = (id: string, tags: string[]): WorkspacePoolPost => ({
    id,
    blogId: "blog-1",
    type: "article",
    slug: id,
    title: id,
    status: "draft",
    pinned: false,
    tags,
  });

  it("finds cross-folder items and lists every workspace tag", () => {
    const pool = {
      posts: [post("one", ["Design", "notes"]), post("two", ["design", "work"])],
    };
    expect(poolPostsForTag(pool, "#DESIGN").map((item) => item.id)).toEqual([
      "one",
      "two",
    ]);
    expect(allTagsInPool(pool)).toEqual(["design", "notes", "work"]);
  });
});
