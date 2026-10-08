import { describe, expect, it } from "vitest";
import type { VaultListing } from "../bridge";
import { previewLabels, rememberPreviewLabel } from "../preview-labels";

const listing = (root = "vault:first"): VaultListing => ({ root, items: [{ path: "Notes/a.textpack" }] });
describe("home preview labels", () => {
  it("keeps saved display text through remount without retaining image bytes", () => {
    const value = listing();
    rememberPreviewLabel(value, value.items[0].path, { title: "Saved title", excerpt: "Saved text", image: { data: "private-image", contentType: "image/png" } });
    expect(previewLabels(value)).toEqual({ "Notes/a.textpack": { title: "Saved title", excerpt: "Saved text" } });
  });
  it("invalidates on a new listing even when root and paths are unchanged", () => {
    const before = listing();
    rememberPreviewLabel(before, before.items[0].path, { title: "Before edit", excerpt: "" });
    expect(previewLabels(listing())).toEqual({});
    expect(previewLabels(listing("vault:second"))).toEqual({});
    const changed = listing();
    rememberPreviewLabel(changed, changed.items[0].path, { title: "After edit", excerpt: "" });
    expect(previewLabels(changed)[changed.items[0].path].title).toBe("After edit");
  });
  it("ignores absent paths and bounds retained text and item count", () => {
    const value: VaultListing = { root: "vault:first", items: Array.from({ length: 130 }, (_, i) => ({ path: `${i}.textpack` })) };
    rememberPreviewLabel(value, "absent.textpack", { title: "Hidden", excerpt: "" });
    expect(previewLabels(value)).toEqual({});
    for (const item of value.items) rememberPreviewLabel(value, item.path, { title: "t".repeat(1000), excerpt: "e".repeat(1000) });
    const saved = previewLabels(value);
    expect(Object.keys(saved)).toHaveLength(128);
    expect(saved["0.textpack"]).toBeUndefined();
    expect(saved["129.textpack"].title).toHaveLength(240);
    expect(saved["129.textpack"].excerpt).toHaveLength(300);
  });
});
