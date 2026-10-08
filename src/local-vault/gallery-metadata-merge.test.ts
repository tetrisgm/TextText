import { describe, expect, it } from "vitest";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { mergeGalleryMetadata } from "./gallery-metadata-merge";

type Content = DocumentSnapshot["content"];
const original = (): Content => ({ title: "Collection", body: "Original body", tags: [], fields: { sourceUrl: "https://example.com" }, assets: [
  { id: "first", kind: "image", src: "assets/first.jpg", summary: "Old", tags: ["original"] },
  { id: "second", kind: "image", src: "assets/second.jpg", caption: "Neighbor" },
] });
const edit = (content: Content): Content => ({ ...content, assets: content.assets.map(asset => asset.id === "first" ? { ...asset, summary: "My summary" } : asset) });
describe("gallery metadata concurrent writes", () => {
  it("preserves concurrent body, other fields, other photos, added photos and asset ordering", () => {
    const baseline = original(), desired = edit(baseline);
    const current: Content = { ...baseline, body: "Agent body", fields: { ...baseline.fields, rating: 5 }, assets: [
      { ...baseline.assets[1], caption: "Other person's caption" },
      { ...baseline.assets[0], tags: ["new tag"] },
      { id: "third", kind: "image", src: "assets/new.jpg" },
    ] };
    const merged = mergeGalleryMetadata(baseline, desired, current);
    expect(merged).toEqual({ ...current, assets: current.assets.map(asset => asset.id === "first" ? { ...asset, summary: "My summary" } : asset) });
    expect(baseline.assets[0].summary).toBe("Old");
  });
  it("refuses competing edits to the same field, including repeated save attempts", () => {
    const baseline = original(), current = original(); current.assets[0].summary = "Someone else's summary";
    for (let attempt = 0; attempt < 2; attempt++) expect(() => mergeGalleryMetadata(baseline, edit(baseline), current)).toThrow("Your draft is kept");
  });
  it("allows an already-applied identical change without discarding unrelated metadata", () => {
    const baseline = original(), current = edit(baseline); current.assets[0].caption = "Added caption";
    expect(mergeGalleryMetadata(baseline, edit(baseline), current)).toEqual(current);
  });
  it.each(["removed", "replaced", "duplicate"])("refuses metadata writes onto a %s image", kind => {
    const baseline = original(), current = original();
    if (kind === "removed") current.assets.shift();
    if (kind === "replaced") current.assets[0].src = "assets/replacement.jpg";
    if (kind === "duplicate") current.assets.push({ ...current.assets[0] });
    expect(() => mergeGalleryMetadata(baseline, edit(baseline), current)).toThrow("This image changed");
  });
  it("merges separate custom fields but rejects competing values", () => {
    const baseline = original(), desired = { ...baseline, fields: { ...baseline.fields, rating: 4 } };
    expect(mergeGalleryMetadata(baseline, desired, { ...baseline, fields: { ...baseline.fields, author: "Friend" } }).fields).toEqual({ ...desired.fields, author: "Friend" });
    expect(() => mergeGalleryMetadata(baseline, desired, { ...baseline, fields: { ...baseline.fields, rating: 2 } })).toThrow("Your draft is kept");
  });
  it("cannot add, remove or replace image bytes through a metadata delta", () => {
    const baseline = original(), desired = edit(baseline); desired.assets[0].src = "assets/other.jpg";
    expect(() => mergeGalleryMetadata(baseline, desired, baseline)).toThrow("cannot replace image files");
  });
});
