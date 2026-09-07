import { describe, expect, it } from "vitest";
import { spotlightEligible } from "@/app/api/sync/v1/sync";
import type { Post, Folder } from "@/lib/content";
describe("Spotlight privacy policy", () => {
  it.each([undefined, "private"] as const)("excludes %s visibility", visibility => {
    expect(spotlightEligible({ visibility } as Post, { mode: "blog" } as Folder)).toBe(false);
  });
  it.each(["notes", "bookmarks"])("excludes %s even with stale public metadata", mode => {
    expect(spotlightEligible({ visibility: "public" } as Post, { mode } as Folder)).toBe(false);
  });
  it("excludes missing folders", () => expect(spotlightEligible({ visibility: "public" } as Post)).toBe(false));
  it.each(["public", "link"] as const)("includes accessible %s blog content", visibility => {
    expect(spotlightEligible({ visibility } as Post, { mode: "blog" } as Folder)).toBe(true);
  });
});
