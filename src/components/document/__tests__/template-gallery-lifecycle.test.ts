import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gallery = readFileSync(
  new URL("../TemplateGallery.tsx", import.meta.url),
  "utf8",
);
const picker = readFileSync(
  new URL("../../workspace/FolderLookPicker.tsx", import.meta.url),
  "utf8",
);

describe("look library lifecycle", () => {
  it("keeps discovery, ownership, and portable look controls visible", () => {
    expect(gallery).toContain('placeholder="Search looks"');
    expect(gallery).toContain('"personal", "Mine"');
    expect(gallery).toContain('"workspace", "Workspace"');
    expect(gallery).toContain('"texttext", "TextText"');
    expect(gallery).toContain("Import");
    expect(gallery).toContain("Export");
  });

  it("makes save-as-new and immutable updates distinct decisions", () => {
    expect(gallery).toContain("Save as new");
    expect(gallery).toContain("Update existing");
    expect(gallery).toContain("Version history");
    expect(gallery).toContain("Restore");
  });

  it("shows impact before applying and wires lifecycle mutations through the folder picker", () => {
    expect(gallery).toContain("Items using it");
    expect(gallery).toContain("Folders using it");
    expect(gallery).toContain("This change");
    expect(picker).toContain("duplicateFolderLookAction");
    expect(picker).toContain("importFolderLookAction");
    expect(picker).toContain("restoreFolderLookVersionAction");
  });

  it("closes without rewriting items when the current look is kept", () => {
    expect(gallery).toContain(
      "isApplied(preview) ? onClose() : onApply(preview)",
    );
  });
});
