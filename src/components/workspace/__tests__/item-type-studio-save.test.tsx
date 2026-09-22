import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "@/lib/presentation/item-type-blueprint";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/editor/item-type-actions", () => ({ createItemTypeAction: vi.fn(), updateItemTypeAction: vi.fn(), readItemTypeUsagesAction: vi.fn() }));
vi.mock("@/lib/pool/store", () => ({ refreshWorkspacePool: vi.fn() }));
vi.mock("@/components/document/DocumentRenderer", () => ({ DocumentCollectionRenderer: () => null, DocumentEngineStyles: () => null, DocumentRenderer: () => null }));
import { ItemTypeStudio } from "../ItemTypeStudio";
const blueprint = itemTypeBlueprintSchema.parse({ name: "Tasks", fields: [{ id: "status", label: "Status", type: "text" }], collection: { layout: "list" } });
function render(initialFolderPath = "") {
  return renderToStaticMarkup(<ItemTypeStudio blogId="blog-1" handle="shoku" editing={{ templateId: "tasks", baseVersion: 3, blueprint }} folders={[{ id: "a", path: "A", name: "A" }, { id: "b", path: "B", name: "B" }]} initialFolderPath={initialFolderPath} onClose={() => {}} />);
}
describe("studio edit save scope", () => {
  it("offers saved custom types independently of folder assignment", () => {
    const definition = compileItemTypeBlueprint(blueprint, { id: "custom.tasks", version: 1 });
    const html = renderToStaticMarkup(<ItemTypeStudio blogId="blog-1" handle="shoku"
      availableTypes={[definition, { ...definition, version: 2, name: "Current tasks" },
        { ...definition, id: "texttext.note", name: "Built in" }]}
      folders={[]} onClose={() => {}} />);
    expect(html).toContain('aria-label="Edit saved type"');
    expect(html).toContain('Current tasks');
    expect(html).not.toContain('>Tasks</option>');
    expect(html).not.toContain('Built in');
  });
  it("exposes editable select choices and required properties without AI", () => {
    const choices = itemTypeBlueprintSchema.parse({ name: "Reviews", collection: { layout: "list" }, fields: [
      { id: "genre", label: "Genre", type: "enum", options: [
        { value: "fiction", label: "Science fiction" }, { value: "history", label: "History" },
      ] },
    ] });
    const html = renderToStaticMarkup(<ItemTypeStudio blogId="blog-1" handle="shoku"
      editing={{ templateId: "reviews", baseVersion: 1, blueprint: choices }} folders={[]} onClose={() => {}} />);
    expect(html).toContain('aria-label="Require Genre"');
    expect(html).toContain('aria-label="Genre choice 1"');
    expect(html).toContain('value="Science fiction"');
    expect(html).toContain('aria-label="Remove Genre choice History"');
    expect(html).toContain('Add choice to Genre');
  });
  it("offers all three scopes and defaults to saving only a version without a folder", () => {
    const html = render();
    expect(html).toContain('value="version" selected=""');
    expect(html).toContain("This version only");
    expect(html).toContain("The selected folder");
    expect(html).toContain("All listed usages");
    expect(html).toContain("Save a new version without changing any folder or item.");
    expect(html).not.toContain("Save for later");
    expect(html).not.toContain("Update matching items");
  });
  it("starts with version-only even when opened from a folder", () => {
    const html = render("A");
    expect(html).toContain('value="version" selected=""');
    expect(html).toContain("Save a new version without changing any folder or item.");
    expect(html).not.toContain("Update matching items in the target folders");
  });
  it("wires scope into the action and retains a full receipt before refreshing", () => {
    const source = readFileSync(new URL("../ItemTypeStudio.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/updateItemTypeAction\([\s\S]*?applyToExisting,\s*saveScope,/);
    expect(source.indexOf('setSaved(result)')).toBeLessThan(source.indexOf('await refreshWorkspacePool'));
    expect(source).toContain('if (!("applied" in result)) onClose()');
    expect(source).toContain("busy || saved");
    for (const field of ["itemsLeft", "itemsBeingEdited", "skipped", "conflicted"]) expect(source).toContain(field);
  });
});
