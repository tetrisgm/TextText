import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { posts, publicUrlTombstones } from "@/lib/db/schema";

describe("public URL schema", () => {
  it("scopes live slug uniqueness to a folder", () => {
    const config = getTableConfig(posts);
    const index = config.indexes.find((candidate) => candidate.config.name === "posts_folder_slug_idx");

    expect(index).toBeDefined();
    expect(
      index?.config.columns.map((column) =>
        "name" in column ? column.name : null,
      ),
    ).toEqual([
      "folder_id",
      "slug",
    ]);
    expect(posts.folderId.notNull).toBe(true);
  });

  it("keeps one durable owner for each previously exposed path", () => {
    const config = getTableConfig(publicUrlTombstones);
    const index = config.indexes.find(
      (candidate) => candidate.config.name === "public_url_tombstones_blog_path_idx",
    );

    expect(index?.config.unique).toBe(true);
    expect(
      index?.config.columns.map((column) =>
        "name" in column ? column.name : null,
      ),
    ).toEqual([
      "blog_id",
      "path",
    ]);
  });
});
