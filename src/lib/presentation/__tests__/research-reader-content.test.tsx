import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { compileItemTypeBlueprint, ITEM_TYPE_STARTERS } from "@/lib/presentation/item-type-blueprint";

const blueprint = ITEM_TYPE_STARTERS.find((entry) => entry.id === "research-reader")!.blueprint;
const template = compileItemTypeBlueprint(blueprint, { id: "research-reader" });

describe("research reader on existing content", () => {
  it.each([
    { label: "empty", body: "" },
    { label: "short", body: "A short source paragraph." },
    { label: "long", body: "A longer source paragraph.\n\n".repeat(80) },
  ])("keeps source, commentary, and cited excerpts for a $label body", ({ body }) => {
      const document = validateDocumentSnapshot({
        schemaVersion: 1,
        content: {
          title: "Saved article",
          body,
          fields: {
            sourceUrl: "https://example.com/article",
            commentary: "My assessment survives the look.",
            excerpts: [{ excerpt: "A selected passage", sourceUrl: "https://example.com/article#passage", note: "Why it matters" }],
          },
        },
        presentation: { template: { id: template.id, version: template.version } },
      });
      const html = renderToStaticMarkup(<DocumentRenderer document={document} template={template} />);
      expect(html).toContain("Saved article");
      expect(html).toContain("My assessment survives the look.");
      expect(html).toContain("A selected passage");
      expect(html).toContain("Why it matters");
      if (body) expect(html).toContain(body.startsWith("A short") ? "A short source paragraph." : "A longer source paragraph.");
  });
});
