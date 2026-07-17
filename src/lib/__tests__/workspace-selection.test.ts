import { describe, expect, it } from "vitest";
import {
  extendSelectionByKeyboard,
  marqueeSelectionIds,
  selectionFromClick,
} from "@/lib/workspace-selection";

const ordered = ["a", "b", "c", "d"];

describe("workspace multi-selection", () => {
  it("opens a plain click and toggles membership with Cmd or Ctrl click", () => {
    const plain = selectionFromClick({
      anchorId: null,
      orderedIds: ordered,
      range: false,
      selectedIds: new Set(),
      targetId: "b",
      toggle: false,
    });
    expect(plain.open).toBe(true);
    expect([...plain.selectedIds]).toEqual(["b"]);

    const added = selectionFromClick({
      anchorId: plain.anchorId,
      orderedIds: ordered,
      range: false,
      selectedIds: plain.selectedIds,
      targetId: "d",
      toggle: true,
    });
    expect(added.open).toBe(false);
    expect([...added.selectedIds]).toEqual(["b", "d"]);

    const removed = selectionFromClick({
      anchorId: added.anchorId,
      orderedIds: ordered,
      range: false,
      selectedIds: added.selectedIds,
      targetId: "b",
      toggle: true,
    });
    expect([...removed.selectedIds]).toEqual(["d"]);
  });

  it("range-selects from the anchor with Shift click", () => {
    const selected = selectionFromClick({
      anchorId: "b",
      orderedIds: ordered,
      range: true,
      selectedIds: new Set(["b"]),
      targetId: "d",
      toggle: false,
    });
    expect([...selected.selectedIds]).toEqual(["b", "c", "d"]);
    expect(selected.anchorId).toBe("b");
    expect(selected.open).toBe(false);
  });

  it("extends and contracts a range with Shift Arrow keys", () => {
    const extended = extendSelectionByKeyboard({
      activeId: "b",
      anchorId: "b",
      direction: 1,
      orderedIds: ordered,
    });
    expect([...extended.selectedIds]).toEqual(["b", "c"]);
    const contracted = extendSelectionByKeyboard({
      activeId: extended.activeId,
      anchorId: extended.anchorId,
      direction: -1,
      orderedIds: ordered,
    });
    expect([...contracted.selectedIds]).toEqual(["b"]);
  });

  it("extends to a geometry-selected target in a grid", () => {
    const selected = extendSelectionByKeyboard({
      activeId: "b",
      anchorId: "b",
      direction: 1,
      orderedIds: ordered,
      targetId: "d",
    });
    expect(selected.activeId).toBe("d");
    expect([...selected.selectedIds]).toEqual(["b", "c", "d"]);
  });

  it("selects intersecting rows with a marquee and preserves additive ids", () => {
    const selected = marqueeSelectionIds({
      additiveIds: ["a"],
      rectangle: { left: 40, top: 40, right: 140, bottom: 140 },
      items: [
        { id: "b", rectangle: { left: 50, top: 50, right: 90, bottom: 90 } },
        { id: "c", rectangle: { left: 150, top: 150, right: 180, bottom: 180 } },
      ],
    });
    expect([...selected]).toEqual(["a", "b"]);
  });
});
