import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateSelectionEditEnvelope, assertSelectionMatches, createSelectionEnvelope, parseSelectionEnvelope, validateSelectionEnvelope, SELECTION_BUDGET_ERROR, SELECTION_STALE_ERROR } from "../selection-envelope";

const item = { revision: 7, title: "Draft", excerpt: "", body: "Keep this phrase. Keep this phrase." };
const selection = { field: "body" as const, start: 5, end: 16, text: "this phrase" };

describe("AI selection envelope", () => {
  it("preserves complete text, whitespace, UTF-16 offsets and a SHA-256 binding", async () => {
    const text = "  📰 café\n".repeat(400); // 4,000 UTF-16 code units
    expect(text.length).toBe(4_000);
    const envelope = (await createSelectionEnvelope("item", { ...item, body: "xx" + text }, {
      field: "body", start: 2, end: 4002, text,
    }))!;
    expect(envelope.hash).toBe(createHash("sha256").update(JSON.stringify([
      "item", "body", 7, 2, 4002, text,
    ])).digest("hex"));
    expect(await validateSelectionEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
  });

  it.each(["title", "excerpt", "body"] as const)("binds a valid %s selection to its exact field", async (field) => {
    const source = { ...item, [field]: "A passage" };
    const envelope = await createSelectionEnvelope("item", source, { field, start: 2, end: 9, text: "passage" });
    await expect(validateSelectionEditEnvelope(envelope, "item", source, { field, start: 2, end: 9, text: "passage" })).resolves.toEqual(envelope);
  });

  it("rejects 4,001 and 4,022 characters, including the critical trailing clause", async () => {
    for (const text of ["x".repeat(4001), "x".repeat(4000) + " CRITICAL FINAL CLAUSE"]) {
      await expect(createSelectionEnvelope("item", { ...item, body: text }, {
        field: "body", start: 0, end: text.length, text,
      })).rejects.toThrow(SELECTION_BUDGET_ERROR);
      expect(() => parseSelectionEnvelope({ text })).toThrow(SELECTION_BUDGET_ERROR);
    }
  });

  it("rejects malformed ranges and unknown fields without normalizing the passage", async () => {
    const value = (await createSelectionEnvelope("item", item, selection))!;
    for (const patch of [{ start: -1 }, { start: 5.5 }, { end: 4 }, { end: 17 },
      { text: "" }, { field: "tags" }, { revision: -1 }, { revision: 1.2 }, { extra: true }]) {
      await expect(validateSelectionEnvelope({ ...value, ...patch })).rejects.toThrow();
    }
  });

  it("rejects tampering with every bound property", async () => {
    const value = (await createSelectionEnvelope("item", item, selection))!;
    for (const patch of [{ itemId: "other" }, { field: "title" }, { revision: 8 },
      { start: 23, end: 34 }, { text: "that phrase" }, { hash: "0".repeat(64) }]) {
      await expect(validateSelectionEnvelope({ ...value, ...patch })).rejects.toThrow();
    }
  });

  it("refuses legacy selection proposals and proposals whose replacement extent changed", async () => {
    const envelope = (await createSelectionEnvelope("item", item, selection))!;
    await expect(validateSelectionEditEnvelope(undefined, "item", item, selection)).rejects.toThrow();
    await expect(validateSelectionEditEnvelope(envelope, "item", item, selection)).resolves.toEqual(envelope);
    await expect(validateSelectionEditEnvelope(envelope, "item", item, { ...selection, start: 0, end: item.body.length, text: item.body })).rejects.toThrow();
    await expect(validateSelectionEditEnvelope(envelope, "item", { ...item, revision: 8 }, selection)).rejects.toThrow(SELECTION_STALE_ERROR);
  });

  it("refuses stale identity, revision, offsets and text, even if repeated text still exists", async () => {
    const envelope = (await createSelectionEnvelope("item", item, selection))!;
    expect(() => assertSelectionMatches(envelope, "other", item)).toThrow(SELECTION_STALE_ERROR);
    expect(() => assertSelectionMatches(envelope, "item", { ...item, revision: 8 })).toThrow(SELECTION_STALE_ERROR);
    expect(() => assertSelectionMatches(envelope, "item", { ...item, body: "X" + item.body })).toThrow(SELECTION_STALE_ERROR);
    expect(() => assertSelectionMatches(envelope, "item", { ...item, body: item.body.replace("this", "that") })).toThrow(SELECTION_STALE_ERROR);
    expect(() => assertSelectionMatches(envelope, "item", item)).not.toThrow();
    await expect(createSelectionEnvelope("item", { ...item, revision: undefined }, selection)).rejects.toThrow(SELECTION_STALE_ERROR);
  });
});


describe("caret envelopes", () => {
  it.each([0, 5, item.body.length])("accepts and binds an empty body range at %i", async (offset) => {
    const caret = { field: "body" as const, start: offset, end: offset, text: "" };
    const envelope = (await createSelectionEnvelope("item", item, caret))!;
    expect(await validateSelectionEditEnvelope(envelope, "item", item, caret)).toEqual(envelope);
    await expect(validateSelectionEnvelope({ ...envelope, start: offset + 1, end: offset + 1 })).rejects.toThrow();
    await expect(validateSelectionEditEnvelope(envelope, "item", { ...item, revision: 8 }, caret)).rejects.toThrow(SELECTION_STALE_ERROR);
    await expect(validateSelectionEditEnvelope(envelope, "other", item, caret)).rejects.toThrow(SELECTION_STALE_ERROR);
    await expect(validateSelectionEditEnvelope(envelope, "item", item, { ...caret, start: 1, end: 2, text: "x" })).rejects.toThrow();
  });
  it("supports the beginning of an empty body but not empty metadata ranges", async () => {
    await expect(createSelectionEnvelope("item", { ...item, body: "" }, { field: "body", start: 0, end: 0, text: "" })).resolves.toMatchObject({ start: 0, end: 0, text: "" });
    for (const field of ["title", "excerpt"] as const) {
      await expect(createSelectionEnvelope("item", item, { field, start: 0, end: 0, text: "" })).rejects.toThrow();
    }
  });
  it("rejects an out-of-bounds caret even though its slice is empty", async () => {
    await expect(createSelectionEnvelope("item", item, { field: "body", start: 100, end: 100, text: "" })).rejects.toThrow(SELECTION_STALE_ERROR);
    const envelope = (await createSelectionEnvelope("item", item, { field: "body", start: 5, end: 5, text: "" }))!;
    expect(() => assertSelectionMatches(envelope, "item", { ...item, body: "" })).toThrow(SELECTION_STALE_ERROR);
  });
});
