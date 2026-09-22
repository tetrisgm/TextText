import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TemplateGallery } from "../TemplateGallery";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import type { TemplateLibraryEntry } from "@/lib/presentation/template-library";

const definition = { ...requireBuiltinTemplate("texttext.note", 1), id: "custom.review", name: "Reading review" };
const library: TemplateLibraryEntry[] = [{ definition, scope: "personal", createdAt: null,
  versions: [{ definition, createdAt: null }], impact: { itemCount: 3, folderCount: 1, folderNames: ["Notes"] } }];
function render(targetItemCount: number) {
  return renderToStaticMarkup(React.createElement(TemplateGallery, {
    document: emptyDocumentSnapshot(), library, targetItemCount,
    onApply: () => {}, onClose: () => {}, onImport: async () => definition,
    onDuplicate: async () => definition, onRestoreVersion: async () => definition,
    onRetire: async () => {}, onExport: async () => "{}",
  }));
}
describe("shared type library rendering", () => {
  it.each([0, 1])("shows the authoritative ownership and import controls for target count %s", (count) => {
    const html = render(count);
    expect(html).toContain("Reading review");
    expect(html).toMatch(/Mine[\s\S]*?1/);
    expect(html).toContain('type="file"');
    expect(html).toContain("Import");
    expect(html).not.toContain("Not available");
  });
});
