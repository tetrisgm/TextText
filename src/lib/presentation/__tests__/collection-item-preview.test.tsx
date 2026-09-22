import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateTemplateDefinition } from "../schema";
import { collectionItemPreview } from "../collection-item-preview";
import { requireBuiltinTemplate } from "../templates";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "../item-type-blueprint";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import type { Post } from "@/lib/content";

function item(type: Post["type"], templateId: string): Post {
  const document = emptyDocumentSnapshot({ id: templateId, version: 1 });
  document.content = { ...document.content, title: "Keep this title", body: "Long text ".repeat(100000), fields: { sourceUrl: "https://example.com/article", rating: 5 } };
  return { id: "preview-item", type, slug: "preview-item", title: document.content.title, body: document.content.body, document, tags: [], date: "2026-09-21", status: "draft" };
}
describe("shared collection previews", () => {
  it.each([["note", "texttext.note"], ["article", "texttext.article"], ["bookmark", "texttext.bookmark"]] as const)("renders bounded %s content through the same document engine", (kind, id) => {
    const post = item(kind, id);
    const original = structuredClone(post.document);
    const template = requireBuiltinTemplate(id, 1);
    const preview = collectionItemPreview(post, template);
    expect(preview.document.content.body.length).toBeLessThanOrEqual(1200);
    expect(preview.slots.prose["content.body"].length).toBeLessThanOrEqual(900);
    expect(post.document).toEqual(original);
    const html = renderToStaticMarkup(<DocumentCollectionRenderer document={preview.document} template={template} slots={preview.slots} />);
    expect(html).toContain(`data-template="${id}"`);
    expect(html).toContain("Keep this title");
    expect(html.length).toBeLessThan(10000);
    expect(preview.host).toBe("example.com");
  });
  it("does not repeat an article subtitle as a supplemental excerpt", () => {
    const post = item("article", "texttext.article");
    post.excerpt = "One summary, once.";
    post.document!.content.subtitle = post.excerpt;
    const preview = collectionItemPreview(post, requireBuiltinTemplate("texttext.article", 1));
    expect(preview.excerpt).toBe("");
    const html = renderToStaticMarkup(<DocumentCollectionRenderer document={preview.document} template={requireBuiltinTemplate("texttext.article", 1)} slots={preview.slots} />);
    expect(html.split(post.excerpt)).toHaveLength(2);
  });
  it("keeps a custom type's collection fields and pinned version", () => {
    const blueprint = itemTypeBlueprintSchema.parse({ name: "Review", fields: [{ id: "rating", label: "Rating", type: "number" }], collection: { layout: "cards" } });
    const template = compileItemTypeBlueprint(blueprint, { id: "custom.review", version: 3 });
    const post = item("note", template.id);
    post.document!.presentation.template.version = 3;
    const preview = collectionItemPreview(post, template);
    expect(preview.document.presentation.template).toEqual({ id: template.id, version: 3 });
    expect(preview.document.content.fields.rating).toBe(5);
    expect(preview.excerpt).toBe("");
    expect(post.document!.content.body.length).toBe(1000000);
  });
  it("uses preview media without embedding a player in the collection", () => {
    const base = requireBuiltinTemplate("texttext.talk", 1);
    const template = validateTemplateDefinition({ ...base, collection: { ...base.collection, item: { type: "video", bind: "content.fields.videoUrl", height: "compact" } } });
    const post = item("video_post", template.id);
    post.document!.content.fields.videoUrl = "https://www.youtube.com/watch?v=example";
    const preview = collectionItemPreview(post, template);
    const html = renderToStaticMarkup(<DocumentCollectionRenderer document={preview.document} template={template} slots={preview.slots} />);
    expect(html).toContain("tt-media-still");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<video");
  });
});
