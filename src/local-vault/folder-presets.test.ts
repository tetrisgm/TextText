import { describe, expect, it } from "vitest";
import { FOLDER_PRESETS } from "./folder-presets";
import { createFolderViewPack, readFolderView } from "./folder-view";
import { openPack } from "./pack";

describe("ready-to-use folder designs", () => {
  it.each(FOLDER_PRESETS)("stores $name as a complete ordinary TextPack", (template) => {
    const created = createFolderViewPack("My collection", template);
    const pack = openPack(created.bytes, created.path, "new");
    expect(readFolderView(pack.file)?.template).toEqual(template);
    expect(template.collection.sort).toEqual([]);
    expect(template.collection.filters).toEqual([]);
  });
  it("offers distinct reading, contact sheet and reference layouts", () => {
    expect(FOLDER_PRESETS.map((template) => template.collection.layout)).toEqual(["list", "cards", "index"]);
    expect(FOLDER_PRESETS[1].collection.columns).toBe(4);
  });
});
