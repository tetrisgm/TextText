import { describe, expect, it } from "vitest";
import { dedupePaletteEntries } from "@/lib/commands/palette";

describe("workspace palette", () => {
  it("keeps one row for each stable folder result id", () => {
    const rows = dedupePaletteEntries([
      { id: "folder:bookmarks", label: "Bookmarks" },
      { id: "command:new-note", label: "New note" },
      { id: "folder:bookmarks", label: "Go to Bookmarks" },
    ]);

    expect(rows).toEqual([
      { id: "folder:bookmarks", label: "Bookmarks" },
      { id: "command:new-note", label: "New note" },
    ]);
  });
});
