import { describe, expect, it } from "vitest";
import {
  ITEM_DRAG_TYPE,
  dragCarriesItems,
  readItemDrag,
  writeItemDrag,
} from "@/lib/workspace/item-drag";

function transfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: "none",
    get types() {
      return Array.from(store.keys());
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer;
}

describe("item drag payload", () => {
  it("round-trips the ids being dragged", () => {
    const t = transfer();
    writeItemDrag(t, ["a", "b"]);
    expect(readItemDrag(t)).toEqual(["a", "b"]);
    expect(dragCarriesItems(t)).toBe(true);
  });

  it("writes nothing for an empty drag", () => {
    const t = transfer();
    writeItemDrag(t, []);
    expect(dragCarriesItems(t)).toBe(false);
    expect(readItemDrag(t)).toEqual([]);
  });

  it("ignores a drag from somewhere else", () => {
    const t = transfer();
    t.setData("text/plain", "a file from the desktop");
    expect(dragCarriesItems(t)).toBe(false);
    expect(readItemDrag(t)).toEqual([]);
  });

  it("survives a malformed payload rather than throwing", () => {
    const t = transfer();
    t.setData(ITEM_DRAG_TYPE, "{not json");
    expect(readItemDrag(t)).toEqual([]);
    expect(readItemDrag(null)).toEqual([]);
  });
});
