import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../FolderPage.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../../styles/broadsheet.css", import.meta.url),
  "utf8",
);

describe("folder saved views UI", () => {
  it("offers a compact accessible selector and resolves its collection client-side", () => {
    expect(source).toContain('className="post-folder-saved-view"');
    expect(source).toContain('aria-label="Folder view"');
    expect(source).toContain("selectCollectionView(base, selectedSavedView?.id");
    expect(source).toContain("displayModeForCollectionView(");
    expect(styles).toContain(".post-folder-saved-view select");
    expect(styles).toContain("var(--hairline)");
    expect(styles).toContain("var(--bg)");
  });
});
