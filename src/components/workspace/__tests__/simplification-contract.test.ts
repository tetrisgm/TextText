// The 2026-08-08 simplification pass removed competing surfaces from the
// workspace. These assertions keep the removals from creeping back.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const folderSource = readFileSync(
  new URL("../../FolderPage.tsx", import.meta.url),
  "utf8",
);
const gallerySource = readFileSync(
  new URL("../../document/TemplateGallery.tsx", import.meta.url),
  "utf8",
);
const landingSource = readFileSync(
  new URL("../../../app/page.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("../../LandingHeader.tsx", import.meta.url),
  "utf8",
);
const broadsheetStyles = readFileSync(
  new URL("../../../styles/broadsheet.css", import.meta.url),
  "utf8",
);

describe("workspace simplification contract", () => {
  it("prints the library item count once, in the filter row", () => {
    expect(shellSource).toContain("{itemCounts[value]}");
    expect(shellSource).not.toMatch(
      /workspace-library-header[\s\S]{0,240}?pool\.posts\.length/,
    );
    expect(broadsheetStyles).not.toMatch(
      /\.workspace-library-header \{[^}]*border-bottom/,
    );
  });

  it("keeps the sidebar to workspace places, with no link out to the catalog", () => {
    expect(shellSource).not.toContain('href="/templates"');
    expect(shellSource).not.toContain("TemplatesIcon");
  });

  it("has no second in-app template surface", () => {
    expect(
      existsSync(new URL("../../WorkspaceTemplateStrip.tsx", import.meta.url)),
    ).toBe(false);
    expect(broadsheetStyles).not.toContain("workspace-template-strip");
  });

  it("calls a template a look everywhere the reader sees one", () => {
    expect(gallerySource).toContain("Choose a look");
    expect(gallerySource).toContain("All looks");
    expect(gallerySource).toContain("Use this look");
    // Comparing looks means stepping between them, not returning to the grid.
    expect(gallerySource).toContain('aria-label="Next look"');
    expect(gallerySource).toContain('aria-label="Previous look"');
    expect(gallerySource).not.toContain("theme<");
    expect(gallerySource).not.toContain("Continue");
  });

  it("gives every empty state an action instead of pointing at the composer", () => {
    expect(folderSource).toContain("Nothing here yet.");
    expect(folderSource).not.toContain("to create the first item");
    expect(shellSource).toContain("Nothing here yet.");
    expect(shellSource).not.toContain("Create your first item above");
    expect(shellSource).toContain("Show all items");
  });

  it("offers exactly one action on the landing surface", () => {
    // There is one way in and it is signing in. The secondary action used to
    // be "Try it without an account", a throwaway guest workspace; it and the
    // seeded /@demo blog were removed, so the hero has no competing click and
    // the nav has nothing to compete with.
    expect(headerSource).not.toContain('href="/try"');
    expect(landingSource).toContain("texttext-landing-primary");
    expect(landingSource.match(/texttext-landing-secondary/g) ?? []).toHaveLength(
      0,
    );
    expect(landingSource).not.toContain('"/try"');
    expect(landingSource).not.toContain("/@demo");
  });
});
