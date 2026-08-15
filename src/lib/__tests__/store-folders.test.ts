// Where an item lands by kind. The rest of this file used to drive the store's
// database-free branches with the demo seed; demo mode was removed 2026-08-14,
// and the folder queries it covered now need a real database. What survives is
// the mapping itself, which is pure and is what every create path depends on:
// blog kinds share the Blog folder, and the unlisted kinds get their own.

import { describe, expect, it } from "vitest";
import { folderPathForPostType } from "@/lib/store";

describe("folderPathForPostType", () => {
  it("maps blog kinds to blog and unlisted kinds to their folders", () => {
    expect(folderPathForPostType("article")).toBe("blog");
    expect(folderPathForPostType("project")).toBe("blog");
    expect(folderPathForPostType("talk")).toBe("blog");
    expect(folderPathForPostType("note")).toBe("notes");
    expect(folderPathForPostType("bookmark")).toBe("bookmarks");
  });
});
