// The gallery node, which is what a Media post renders through.
//
// A Media post is the video-focused blog item. Its old dedicated reader
// (ProjectGallery.tsx, an Embla carousel) was deleted 2026-08-14 because no
// route imported it, leaving this node as the only thing that draws one. The
// node had no test at all, so nothing would have caught the video branch
// regressing into an <img>. That is the whole feature.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";

const template = validateTemplateDefinition({
  schemaVersion: 1,
  engineVersion: 1,
  id: "test.gallery-node",
  version: 1,
  name: "Gallery node",
  fields: [],
  item: {
    type: "stack",
    children: [
      { type: "gallery", id: "gallery-media", bind: "content.assets", columns: 2 },
    ],
  },
  collection: {
    layout: "list",
    item: { type: "text", bind: "content.title", role: "heading" },
  },
});

type Asset = {
  id: string;
  src: string;
  kind: "image" | "video";
  alt?: string;
  caption?: string;
};

function render(assets: Asset[]): string {
  const document = {
    schemaVersion: 1,
    content: {
      title: "Field test",
      subtitle: "",
      body: "",
      fields: {},
      tags: [],
      assets,
    },
    presentation: {
      template: { id: "test.gallery-node", version: 1 },
      theme: {},
    },
  } as unknown as DocumentSnapshot;
  return renderToStaticMarkup(
    React.createElement(DocumentRenderer, { document, template }),
  );
}

describe("gallery node", () => {
  it("gives a video asset a real player, not an image tag", () => {
    const html = render([
      {
        id: "a1",
        src: "https://cdn.example.com/field-test.mp4",
        kind: "video",
        caption: "Shot handheld",
      },
    ]);

    expect(html).toContain("<video");
    expect(html).toContain("controls");
    expect(html).toContain("https://cdn.example.com/field-test.mp4");
    expect(html).not.toContain("<img");
    expect(html).toContain("Shot handheld");
  });

  it("draws images and videos side by side in one gallery", () => {
    const html = render([
      { id: "a1", src: "https://cdn.example.com/one.jpg", kind: "image", alt: "A still" },
      { id: "a2", src: "https://cdn.example.com/two.mp4", kind: "video" },
    ]);

    expect(html).toContain('class="tt-gallery"');
    expect(html).toContain("<img");
    expect(html).toContain("<video");
    expect(html).toContain('alt="A still"');
  });

  it("carries the column count so a template can lay the grid out", () => {
    const html = render([
      { id: "a1", src: "https://cdn.example.com/one.jpg", kind: "image" },
    ]);
    expect(html).toContain("--tt-gallery-columns:2");
  });

  it("refuses a source that is not a safe media URL", () => {
    const html = render([
      { id: "a1", src: "javascript:alert(1)", kind: "video" },
      { id: "a2", src: "https://cdn.example.com/ok.mp4", kind: "video" },
    ]);

    expect(html).not.toContain("javascript:");
    expect(html).toContain("https://cdn.example.com/ok.mp4");
  });

  it("renders nothing at all when the item has no assets", () => {
    // The engine inlines its stylesheet, which mentions .tt-gallery, so this
    // has to look for the element rather than the string.
    expect(render([])).not.toContain('class="tt-gallery"');
  });
});
