import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";

const template = getBuiltinTemplate("texttext.note")!;

function render(body: string): string {
  const document = {
    schemaVersion: 1,
    content: { title: "Doc", subtitle: "", body, fields: {}, tags: [], assets: [] },
    presentation: { template: { id: template.id, version: template.version }, theme: {} },
  } as unknown as DocumentSnapshot;
  return renderToStaticMarkup(
    React.createElement(DocumentRenderer, { document, template }),
  );
}

/**
 * The tree transform is unit tested next door. This checks the thing that
 * actually matters: that a highlight survives the whole renderer and reaches
 * the page as a real mark, rather than being stripped somewhere downstream.
 */
describe("a highlight in a document body", () => {
  it("reaches the page as a mark", () => {
    const html = render("The alert fired and ==nobody believed it== that day.");
    expect(html).toContain("<mark");
    expect(html).toContain("tt-mark");
    expect(html).toContain("nobody believed it");
    // The markers themselves are gone: they are syntax, not content.
    expect(html).not.toContain("==nobody");
  });

  it("leaves an ordinary paragraph without one", () => {
    const html = render("Nothing marked at all.");
    expect(html).not.toContain("<mark");
  });

  it("does not mark a comparison inside code", () => {
    const html = render("Check `if (a ==b)` before running it.");
    expect(html).not.toContain("<mark");
  });

  it("works where a person would actually put one", () => {
    // Headings, bold, links and table cells all carry text nodes, so a
    // highlight has to survive each of them rather than only plain paragraphs.
    expect(render("## The ==important== part")).toContain("<mark");
    expect(render("**bold with ==a highlight== inside**")).toContain("<mark");
    expect(render("See [the ==key== page](https://example.com).")).toContain("<mark");
    expect(
      render("| a | b |\n| --- | --- |\n| ==marked== | plain |"),
    ).toContain("<mark");
  });

  it("leaves markdown that merely contains equals signs alone", () => {
    // A table separator, a comparison, a run of equals, and a setext underline
    // are all things a document really contains.
    for (const body of [
      "| a | b |\n| --- | --- |\n| x | y |",
      "Compare a == b for equality.",
      "A line of ==== signs.",
      "Heading\n=======\n\nWords.",
      "The value is 4 ==",
    ]) {
      expect(render(body)).not.toContain("<mark");
    }
  });
});
