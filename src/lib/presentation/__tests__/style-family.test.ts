import { describe, expect, it } from "vitest";

import { DOCUMENT_ENGINE_CSS } from "@/lib/presentation/styles";
import {
  ALL_RESOLVABLE_TEMPLATES,
  BUILTIN_TEMPLATES,
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
describe("style families", () => {
  it("gives Timeline the same family as Article", () => {
    expect(styleFamilyFor("texttext.timeline")).toBe("article");
    expect(styleFamilyFor("texttext.article")).toBe("article");
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
    const styled = [
      ...DOCUMENT_ENGINE_CSS.matchAll(/data-template="(texttext\.[a-z]+)"/g),
    ].map((match) => match[1]);
    expect([...new Set(styled)].filter((id) => !resolvable.has(id))).toEqual([]);
  });
});
