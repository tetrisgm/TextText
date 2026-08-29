import { describe, expect, it } from "vitest";

import {
  describeFrozenPreview,
  driftedItems,
  type FrozenProposalPreview,
} from "@/lib/ai/write-proposal-preview";

const preview: FrozenProposalPreview = {
  kind: "items",
  tool: "delete_items",
  items: [
    { id: "a", title: "Half an idea about caching", folderPath: "notes", visibility: "private", revision: 11 },
    { id: "b", title: "What the outage taught us", folderPath: "blog", visibility: "public", revision: 22 },
  ],
};

/**
 * A proposal is only a confirmation if the person is shown something they can
 * recognise. The existing preview showed ids and truncated fields, which is
 * why nothing destructive was allowed to be staged at all.
 */
describe("what the owner is shown before approving a deletion", () => {
  it("names the items rather than their ids", () => {
    const text = describeFrozenPreview(preview);
    expect(text).toContain("Half an idea about caching");
    expect(text).toContain("What the outage taught us");
    expect(text).not.toContain("revision");
  });

  it("says when something published will stop being visible", () => {
    // Approving the deletion of a draft and of something people can see are
    // different decisions.
    expect(describeFrozenPreview(preview)).toMatch(/1 of them is published/);
  });

  it("says it is restorable, because it is", () => {
    expect(describeFrozenPreview(preview)).toContain("restorable");
  });

  it("names a single item in the singular, with its folder", () => {
    const one = { ...preview, items: [preview.items[0]] };
    expect(describeFrozenPreview(one)).toBe(
      'Move "Half an idea about caching" to Trash, from notes. Everything moved to Trash stays restorable.',
    );
  });

  it("says how many could not be found rather than silently dropping them", () => {
    const withMissing: FrozenProposalPreview = {
      ...preview,
      items: [...preview.items, { id: "c", title: "", folderPath: "", visibility: "private", revision: null, missing: true }],
    };
    expect(describeFrozenPreview(withMissing)).toMatch(/1 could not be found/);
  });
});

describe("whether the world still matches what was approved", () => {
  const unchanged = new Map([
    ["a", { title: "Half an idea about caching", folderPath: "notes", visibility: "private", revision: 11 }],
    ["b", { title: "What the outage taught us", folderPath: "blog", visibility: "public", revision: 22 }],
  ]);

  it("passes when nothing moved", () => {
    expect(driftedItems(preview, unchanged)).toEqual([]);
  });

  it("catches an item someone edited since it was shown", () => {
    const edited = new Map(unchanged);
    edited.set("a", { title: "Half an idea about caching", folderPath: "notes", visibility: "private", revision: 12 });
    expect(driftedItems(preview, edited)).toEqual(["a"]);
  });

  it("catches an item that became public since it was shown", () => {
    // The person approved deleting a draft. Deleting something people can now
    // see is a different act.
    const published = new Map(unchanged);
    published.set("a", { title: "Half an idea about caching", folderPath: "notes", visibility: "public", revision: 11 });
    expect(driftedItems(preview, published)).toEqual(["a"]);
  });

  it("catches a renamed item, because the name is what was approved", () => {
    const renamed = new Map(unchanged);
    renamed.set("b", { title: "Something else entirely", folderPath: "blog", visibility: "public", revision: 22 });
    expect(driftedItems(preview, renamed)).toEqual(["b"]);
  });

  it("catches an item whose folder changed since it was shown", () => {
    // "from notes" was part of what the person read and approved.
    const moved = new Map(unchanged);
    moved.set("a", { title: "Half an idea about caching", folderPath: "archive", visibility: "private", revision: 11 });
    expect(driftedItems(preview, moved)).toEqual(["a"]);
  });

  it("does not call an already-deleted item drift", () => {
    // The outcome the person wanted has already happened.
    const gone = new Map(unchanged);
    gone.delete("a");
    expect(driftedItems(preview, gone)).toEqual([]);
  });

  it("drops only what drifted, keeping what the person still agreed to", () => {
    const partly = new Map(unchanged);
    partly.set("a", { title: "Half an idea about caching", folderPath: "notes", visibility: "private", revision: 99 });
    expect(driftedItems(preview, partly)).toEqual(["a"]);
  });
});
