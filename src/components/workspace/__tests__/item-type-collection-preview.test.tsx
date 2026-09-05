import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "@/lib/presentation/item-type-blueprint";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { ItemTypeCollectionPreview, collectionPreviewItem } from "../ItemTypeCollectionPreview";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/editor/item-type-actions", () => ({ createItemTypeAction: vi.fn(), updateItemTypeAction: vi.fn(), readItemTypeUsagesAction: vi.fn() }));
vi.mock("@/lib/pool/store", () => ({ refreshWorkspacePool: vi.fn() }));
import { ItemTypeStudio, previewContentForDesign } from "../ItemTypeStudio";

const blueprint = itemTypeBlueprintSchema.parse({ name: "Deadlines", fields: [
  { id: "due", label: "Due", type: "date" }, { id: "created", label: "Created", type: "date" },
  { id: "done", label: "Done", type: "boolean" },
], collection: { layout: "list", views: [{ id: "calendar", name: "Deadlines", layout: "calendar", dateBy: "due", filters: [{ field: "done", op: "eq", value: true }], sort: [{ field: "title", direction: "desc" }] }], defaultView: "calendar" } });
const template = compileItemTypeBlueprint(blueprint, { id: "deadlines" });
function document(title: string, due: string | null, done = true) {
  return validateDocumentSnapshot({ schemaVersion: 1, content: { title, fields: { due, created: "2026-08-19", done } }, presentation: { template: { id: "deadlines", version: 1 } } });
}
function render(documents = [document("Alpha marker", "2026-08-29"), document("Zulu marker", "2026-08-29"), document("Last marker", "2026-08-31"), document("Excluded marker", "2026-08-29", false), document("Undated marker", null)]) {
  return renderToStaticMarkup(<ItemTypeCollectionPreview template={template} items={documents.map((entry) => collectionPreviewItem(entry))} label="Folder preview" />);
}

describe("studio collection preview", () => {
  it("renders the default view, all late-month matches in sort order and undated items", () => {
    const html = render();
    expect(html).toContain('value="calendar" selected=""');
    expect(html).toContain("August 2026");
    const day29 = html.slice(html.indexOf('data-date="2026-08-29"'), html.indexOf('data-date="2026-08-30"'));
    expect(day29).toContain("Zulu marker");
    expect(day29).toContain("Alpha marker");
    expect(day29.indexOf("Zulu marker")).toBeLessThan(day29.indexOf("Alpha marker"));
    expect(html).toContain('data-date="2026-08-31"><small>31</small><strong>Last marker</strong>');
    expect(html).not.toContain("Excluded marker");
    expect(html).toContain('aria-label="Undated preview items"');
    expect(html).toContain("Undated marker");
    expect(html).toContain('aria-label="Next preview month"');
    expect(html).toContain('aria-label="Previous preview month"');
  });
  it("chooses a content month outside August and labels filtered emptiness", () => {
    expect(render([document("Leap day", "2028-02-29")])).toContain("February 2028");
    const html = render([document("Hidden", "2028-02-29", false)]);
    expect(html).toContain("No matching items");
    expect(html).not.toContain("<strong>Hidden</strong>");
  });
  it("queries and renders list cards instead of mapping unfiltered input", () => {
    const list = { ...template, collection: { ...template.collection, layout: "list" as const, views: [], defaultView: undefined } };
    const html = renderToStaticMarkup(<ItemTypeCollectionPreview template={list} items={[document("Alpha list", null), document("Zulu list", null), document("Filtered list", null, false)].map((entry) => collectionPreviewItem(entry))} label="List preview" />);
    expect(html).toContain("Alpha list");
    expect(html).toContain("Zulu list");
    expect(html.indexOf("Zulu list")).toBeLessThan(html.indexOf("Alpha list"));
    expect(html).not.toContain("Filtered list");
  });
  it("renders every board group with distinct card ids, including Unsorted", () => {
    const board = compileItemTypeBlueprint({ name: "Board", fields: [{ id: "status", label: "Status", type: "enum", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }], collection: { layout: "board", groupBy: "status" } }, { id: "board" });
    const items = ["a", "b", "unknown"].map((status) => {
      const entry = document(`Board ${status}`, null);
      return collectionPreviewItem({ ...entry, content: { ...entry.content, fields: { status } } });
    });
    const html = renderToStaticMarkup(<ItemTypeCollectionPreview template={board} items={items} label="Board preview" />);
    const ids = [...html.matchAll(/<article id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(html).toContain("Unsorted");
    for (const item of items) expect(html).toContain(item.title);
  });
  it("keeps every real candidate and its system metadata through retargeting", () => {
    const folders = Array.from({ length: 15 }, (_, index) => ({ folderPath: "Tasks", document: document(`Item ${index}`, "2026-08-31", index === 14), updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}`, pinned: index === 14 }));
    const content = previewContentForDesign({ blueprint, template }, "folder", folders);
    expect(content.collection).toHaveLength(15);
    expect(content.collection[14]).toMatchObject({ updatedAt: "2026-09-15", pinned: true });
    const html = renderToStaticMarkup(<ItemTypeCollectionPreview template={template} items={content.collection} label="All candidates" />);
    expect(html).toContain("Item 14");
    expect(html).not.toContain("<strong>Item 0</strong>");
  });
  it("keeps an empty real folder empty and makes folder loading selectable", () => {
    const content = previewContentForDesign({ blueprint, template }, "folder", []);
    expect(content.collection).toEqual([]);
    const html = renderToStaticMarkup(<ItemTypeStudio blogId="b" handle="shoku" editing={{ templateId: "deadlines", baseVersion: 1, blueprint }} folders={[{ id: "tasks", name: "Tasks", path: "Tasks" }]} initialFolderPath="Tasks" loadPreviewDocuments={async () => []} onClose={() => {}} />);
    expect(html).toContain('<option value="folder">Folder content (0)</option>');
  });
  it("keeps sample and stress dates in the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2029, 10, 4));
    try {
      for (const mode of ["sample", "stress"] as const) {
        const content = previewContentForDesign({ blueprint, template }, mode, []);
        expect(content.collection.every((entry) => String(entry.fields.due).startsWith("2029-11-"))).toBe(true);
      }
    } finally { vi.useRealTimers(); }
  });
  it("opens a legacy row blueprint for correction without crashing or offering Done", () => {
    const legacy = itemTypeBlueprintSchema.parse({ name: "Sources", collection: { layout: "list" }, fields: [{ id: "entries", label: "Entries", type: "rows", fields: [{ id: "tags", label: "Tags", type: "enum", multiple: true, options: [{ value: "a", label: "A" }] }] }] });
    const html = renderToStaticMarkup(<ItemTypeStudio blogId="b" handle="shoku" editing={{ templateId: "sources", baseVersion: 1, blueprint: legacy }} folders={[]} onClose={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("entries.tags");
    expect(html).toContain("Set multiple to false or omit it");
    expect(html).toContain('aria-label="Build this item type"');
    expect(html).not.toContain(">Done</button>");
  });
});
