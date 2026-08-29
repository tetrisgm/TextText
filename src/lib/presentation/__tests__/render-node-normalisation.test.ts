import { describe, expect, it } from "vitest";

import { parseSyncDocumentEnvelope } from "@/lib/documents/sync";
import {
  normalizeRenderNode,
  validateTemplateDefinition,
} from "@/lib/presentation/schema";

/**
 * Step 1 is READER-FIRST: both spellings are accepted and both render, and
 * nothing new is emitted.
 *
 * An earlier attempt normalised on parse. That rewrites the object every
 * serializer downstream then writes out, so sync, look export and newly
 * compiled types would all have started emitting the new names immediately. A
 * `.textpack` exported after that cannot be read by an earlier build, and no
 * database migration can reach a bundle already sitting on someone's disk.
 * Reading both and writing neither is what keeps a rollback safe.
 *
 * So the two properties worth pinning are: parse PRESERVES what it was given,
 * and the mapping is correct for the renderer to apply.
 */
function look(item: unknown) {
  return {
    schemaVersion: 1,
    engineVersion: 1,
    id: "custom.normalise",
    version: 1,
    name: "Normalise",
    fields: [{ id: "hero", label: "Hero", type: "image" }],
    item,
    collection: {
      layout: "list",
      item: { type: "stack", children: [{ type: "text", bind: "content.title", role: "title" }] },
    },
    theme: {},
  };
}

const STACK = (children: unknown[]) => ({ type: "stack", children });

describe("parse emits nothing new", () => {
  it("keeps a legacy node exactly as written", () => {
    const parsed = validateTemplateDefinition(
      look(STACK([
        { type: "byline" },
        { type: "divider", size: "lg" },
        { type: "cover", bind: "content.fields.hero" },
      ])),
    );
    const kids = (parsed.item as { children: Array<Record<string, unknown>> }).children;
    // If these ever come back as meta/space/media, step 1 has started emitting
    // the new vocabulary and the rollback floor has moved without anyone
    // saying so.
    expect(kids.map((k) => k.type)).toEqual(["byline", "divider", "cover"]);
  });

  it("accepts the target spellings too, so step 3 can switch", () => {
    const parsed = validateTemplateDefinition(
      look(STACK([{ type: "meta", variant: "metadata" }, { type: "space", rule: true }])),
    );
    const kids = (parsed.item as { children: Array<Record<string, unknown>> }).children;
    expect(kids.map((k) => k.type)).toEqual(["meta", "space"]);
  });

  it("leaves a look arriving inside a textpack untouched as well", () => {
    const raw = JSON.stringify({
      schema: "texttext.sync-document.v1",
      markdown: "# x\n",
      document: {
        schemaVersion: 1,
        content: { title: "x", body: "", fields: {}, tags: [], assets: [] },
        presentation: { template: { id: "custom.normalise", version: 1 }, theme: {} },
      },
      template: look(STACK([{ type: "byline" }])),
    });
    expect(raw).toContain('"type":"byline"');
    const parsed = parseSyncDocumentEnvelope(raw);
    const kids = (parsed.template!.item as { children: Array<Record<string, unknown>> })
      .children;
    expect(kids[0].type).toBe("byline");
  });
});

describe("the mapping the renderer applies", () => {
  it("carries which of the pair it was", () => {
    expect(normalizeRenderNode({ type: "byline" })).toEqual({
      type: "meta",
      variant: "byline",
    });
    expect(normalizeRenderNode({ type: "metadata" })).toEqual({
      type: "meta",
      variant: "metadata",
    });
  });

  it("turns divider and spacer into space, keeping the rule and the size", () => {
    expect(normalizeRenderNode({ type: "divider", size: "lg" })).toEqual({
      type: "space",
      size: "lg",
      rule: true,
    });
    expect(normalizeRenderNode({ type: "spacer", size: "sm" })).toEqual({
      type: "space",
      size: "sm",
      rule: false,
    });
  });

  it("turns cover, image and video into media, keeping which it was", () => {
    // The kind carries both the CSS class (tt-cover / tt-image / tt-video) and
    // the video player branch, so the rendered output is unchanged.
    for (const kind of ["cover", "image", "video"] as const) {
      expect(
        normalizeRenderNode({ type: kind, bind: "content.assets", height: "large" }),
      ).toEqual({ type: "media", kind, bind: "content.assets", height: "large" });
    }
  });

  it("refuses a media-family node that already carries a kind", () => {
    const bad = { type: "cover", bind: "content.assets", kind: "video" };
    expect(normalizeRenderNode(bad)).toBe(bad);
  });

  it("passes anything else through untouched, by identity", () => {
    const text = { type: "text", bind: "content.title", role: "title" };
    expect(normalizeRenderNode(text)).toBe(text);
    expect(normalizeRenderNode({ type: "meta", variant: "byline" })).toEqual({
      type: "meta",
      variant: "byline",
    });
    expect(normalizeRenderNode(null)).toBe(null);
    expect(normalizeRenderNode([1, 2])).toEqual([1, 2]);
  });

  it("refuses to rewrite a legacy node carrying a target-only key", () => {
    // Rewriting would overwrite the key and accept input the strict schema
    // rejects, hiding a faulty producer. Left alone, validation still fails.
    const bad = { type: "byline", variant: "metadata" };
    expect(normalizeRenderNode(bad)).toBe(bad);
    expect(() => validateTemplateDefinition(look(STACK([bad])))).toThrow();
    const bad2 = { type: "divider", rule: false };
    expect(normalizeRenderNode(bad2)).toBe(bad2);
    expect(() => validateTemplateDefinition(look(STACK([bad2])))).toThrow();
  });
});
