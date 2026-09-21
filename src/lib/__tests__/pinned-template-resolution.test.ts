import { describe, expect, it } from "vitest";
import { templateForPoolPost, workspacePoolFromParts } from "@/lib/pool/selectors";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import type { Blog } from "@/lib/content";

describe("pinned template resolution", () => {
  it("resolves retired or historical versions without offering them for creation", () => {
    const pinned = { ...requireBuiltinTemplate("texttext.note"), id: "book-review", version: 1 };
    const current = { ...pinned, version: 2 };
    const pool = workspacePoolFromParts({ blog: {} as Blog, blogId: "workspace", counts: {}, folders: [], posts: [], templates: [current] });
    pool.pinnedTemplates = [pinned];
    const post = { type: "note" as const, template: { id: pinned.id, version: 1 } };
    expect(templateForPoolPost(pool, post)).toEqual(pinned);
    expect(templateForPoolPost({ templates: [], pinnedTemplates: [pinned] }, post)).toEqual(pinned);
    expect(pool.templates).toEqual([current]);
  });
});
