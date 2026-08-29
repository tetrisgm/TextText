import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";

import { DOCUMENT_ENGINE_CSS } from "@/lib/presentation/styles";
import {
  ALL_RESOLVABLE_TEMPLATES,
  BUILTIN_TEMPLATES,
  getBuiltinTemplate,
  styleFamilyFor,
} from "@/lib/presentation/templates";

/**
 * Presentation was keyed to the template id, so a look got a built-in's
 * treatment only if it WAS that built-in.
 *
 * Timeline is Article with a different id - the same document field for field,
 * listed as a timeline instead of as cards - and the renderer emits the id, so
 * none of Article's fourteen style rules matched it. Anyone choosing Timeline
 * got a visibly poorer Article, and had since the look was added.
 */

/**
 * The rendered markup with the embedded stylesheet removed.
 *
 * The renderer inlines DOCUMENT_ENGINE_CSS, which now CONTAINS
 * [data-style-family="article"] as a selector. So asserting on the whole
 * output matched the stylesheet rather than the element, and the test passed
 * with the attribute deleted from the renderer. That is the second time the
 * embedded stylesheet has made a marker assertion vacuous in this repository.
 */
function markupOnly(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, "");
}

function renderDocument(id: string, extra: Record<string, unknown> = {}): string {
  const template = getBuiltinTemplate(id)!;
  return markupOnly(
    renderToStaticMarkup(
      React.createElement(DocumentRenderer, {
        template,
        document: {
          schemaVersion: 1,
          content: { title: "T", subtitle: "", body: "Words.", fields: {}, tags: [], assets: [] },
          presentation: { template: { id, version: template.version }, theme: {} },
        },
        ...extra,
      } as never),
    ),
  );
}

describe("style families", () => {
  it("gives Timeline the same family as Article", () => {
    expect(styleFamilyFor("texttext.timeline")).toBe("article");
    expect(styleFamilyFor("texttext.article")).toBe("article");
  });

  it.each(["texttext.article", "texttext.timeline"])(
    "puts the family on the %s element, not just in the map",
    (id) => {
      expect(renderDocument(id)).toContain('data-style-family="article"');
    },
  );

  it("puts it on a collection entry too, where a folder index draws it", () => {
    expect(renderDocument("texttext.timeline", { collection: true })).toContain(
      'data-style-family="article"',
    );
  });

  it("does not claim a family for a look that has none", () => {
    // Guards the assertion itself: if markupOnly were stripping too much, or
    // the attribute were hard-coded, this would fail.
    expect(renderDocument("texttext.brief")).not.toContain("data-style-family");
  });

  it("leaves a look with no shared family alone", () => {
    // Not everything belongs to a family, and inventing one for every look
    // would be a second name for the id it already has.
    expect(styleFamilyFor("texttext.brief")).toBeUndefined();
    expect(styleFamilyFor("recipes-a1b2c3")).toBeUndefined();
  });

  it("stopped keying Article's rules on Article's id", () => {
    // The rules that used to say [data-template="texttext.article"] now say
    // [data-style-family="article"], which both looks carry.
    expect(DOCUMENT_ENGINE_CSS).not.toContain('data-template="texttext.article"');
    expect(DOCUMENT_ENGINE_CSS).toContain('data-style-family="article"');
  });

  it("every built-in either has its own rules or a family that does", () => {
    // The check that would have caught Timeline. A built-in with neither is
    // rendering on the shared base alone, which is what "poorer Article" was.
    const unstyled = BUILTIN_TEMPLATES.filter((template) => {
      const own = DOCUMENT_ENGINE_CSS.includes(`data-template="${template.id}"`);
      const family = styleFamilyFor(template.id);
      const viaFamily = family
        ? DOCUMENT_ENGINE_CSS.includes(`data-style-family="${family}"`)
        : false;
      return !own && !viaFamily;
    }).map((template) => template.id);
    expect(unstyled).toEqual([]);
  });

  it("styles nothing that cannot be resolved at all", () => {
    // Retired looks KEEP their styling on purpose: they are no longer offered,
    // but documents pinned to them still render and must still look right.
    // texttext.newsletter is one, which is why "eleven ids have styling" read
    // as full coverage while an active built-in had none.
    //
    // What would be a real fault is styling for an id that resolves to nothing.
    const resolvable = new Set(
      ALL_RESOLVABLE_TEMPLATES.map((template) => template.id),
    );
    // [a-z] alone truncated an id like texttext.article-old to
    // texttext.article, which resolves, so a dead selector passed.
    const styled = [
      ...DOCUMENT_ENGINE_CSS.matchAll(/data-template="(texttext\.[a-z0-9.-]+)"/g),
    ].map((match) => match[1]);
    expect([...new Set(styled)].filter((id) => !resolvable.has(id))).toEqual([]);
  });
});
