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
const githubButtonSource = readFileSync(
  new URL("../../GitHubStarButton.tsx", import.meta.url),
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
const workspaceStyles = readFileSync(
  new URL("../../../styles/workspace.css", import.meta.url),
  "utf8",
);
const assistantSidebarStyles = readFileSync(
  new URL("../assistant/AssistantSidebar.module.css", import.meta.url),
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
    expect(shellSource).toContain("Your first TextText loop");
    expect(shellSource).toContain("Save your first thought");
    expect(shellSource).not.toContain("Create your first item above");
    expect(shellSource).toContain("Show all items");
  });

  it("offers one way into the product and a quiet repository link", () => {
    // There is one way into the product and it is signing in. The secondary
    // action used to be "Try it without an account", a throwaway guest
    // workspace; it and the seeded /@demo blog stay removed. The repository
    // link is informational and does not create a competing product path.
    expect(headerSource).not.toContain('href="/try"');
    expect(landingSource).toContain("texttext-landing-primary");
    expect(landingSource).toContain("<GitHubStarButton />");
    expect(githubButtonSource).toContain("texttext-github-button");
    expect(githubButtonSource).toContain("stargazers_count");
    expect(githubButtonSource).toContain('cache: "no-store"');
    expect(githubButtonSource).toContain("https://github.com/tetrisgm/TextText");
    expect(landingSource).not.toContain("https://buttons.github.io/buttons.js");
    expect(landingSource).not.toContain('"/try"');
    expect(landingSource).not.toContain("/@demo");
  });

  it("positions TextText as the fast durable inbox for people and agents", () => {
    expect(landingSource).toContain("Save anything. Bring your AI.");
    expect(landingSource).toContain("compatible, authorized AI");
    expect(landingSource).toContain("Capture now. Find it from anywhere.");
    expect(landingSource).toContain("Quick capture");
    expect(landingSource).toContain("Saved to Notes");
    expect(landingSource).toContain('name: "Capture"');
    expect(landingSource).toContain('name: "Find"');
    expect(landingSource).toContain('name: "Change"');
    expect(landingSource).not.toContain("Claude, ChatGPT, Codex");
  });

  it("keeps tablet capture receipts clear of the assistant overlay", () => {
    expect(assistantSidebarStyles).toContain(
      '@media (min-width: 561px) and (max-width: 900px)',
    );
    expect(assistantSidebarStyles).toContain("width: min(320px, 50vw)");
    expect(workspaceStyles).toContain(
      ".post-editor-shell.has-assistant-open .workspace-root-page",
    );
    expect(workspaceStyles).toContain(
      "padding-right: calc(min(320px, 50vw) + 48px)",
    );
    expect(workspaceStyles).toContain(
      ".post-editor-shell.has-assistant-open .universal-item-receipt",
    );
    expect(workspaceStyles).toContain(".universal-item-receipts");
    expect(workspaceStyles).toContain("flex-wrap: wrap");
    expect(workspaceStyles).toContain(".universal-item-receipt-raw pre");
    expect(workspaceStyles).toContain("overflow-wrap: anywhere");
    expect(workspaceStyles).toContain("white-space: pre-wrap");
  });

  it("keeps Library controls reachable on narrow and touch layouts", () => {
    expect(workspaceStyles).toContain(
      ".post-editor-shell.has-assistant-open .workspace-library-toolbar",
    );
    expect(workspaceStyles).toContain("flex-direction: column");
    expect(workspaceStyles).toContain("flex-wrap: nowrap");
    expect(workspaceStyles).toContain(
      ".workspace-recent.is-view-list .workspace-recent-list",
    );
    expect(workspaceStyles).toContain("padding-left: 22px");
    expect(workspaceStyles).toContain("@media (hover: none)");
    expect(workspaceStyles).toContain(".workspace-item-actions-trigger");
  });
});
