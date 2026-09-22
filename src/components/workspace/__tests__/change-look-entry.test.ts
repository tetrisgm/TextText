import { beforeEach, describe, expect, it, vi } from "vitest";
import { readEditableType } from "../TypeDesignerContext";
import { itemTypeBlueprintSchema } from "@/lib/presentation/item-type-blueprint";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/app/editor/item-type-actions", () => ({ readItemTypeForEditAction: read }));
beforeEach(() => read.mockReset());

describe("shared type designer entry", () => {
  it("preserves the exact version used for optimistic concurrency", async () => {
    const blueprint = itemTypeBlueprintSchema.parse({ name: "Review", fields: [], collection: { layout: "list" } });
    read.mockResolvedValue({ ok: true, version: 7, blueprint, state: "authored", retired: false });
    await expect(readEditableType("mira", "review")).resolves.toEqual({ templateId: "review", baseVersion: 7, blueprint });
    expect(read).toHaveBeenCalledWith("mira", "review");
  });
  it.each([
    ["needs-migration", "older designer version"],
    ["unreadable", "could not be read"],
    ["assembled", "no editable design"],
  ])("explains %s without opening an empty design", async (state, message) => {
    read.mockResolvedValue({ ok: true, version: 1, blueprint: null, state, retired: false });
    await expect(readEditableType("mira", "review")).rejects.toThrow(message);
  });
  it("rejects retired types and propagates access failures", async () => {
    read.mockResolvedValueOnce({ ok: true, retired: true }).mockResolvedValueOnce({ ok: false, error: "Not allowed" });
    await expect(readEditableType("mira", "review")).rejects.toThrow("retired");
    await expect(readEditableType("mira", "review")).rejects.toThrow("Not allowed");
  });
});
