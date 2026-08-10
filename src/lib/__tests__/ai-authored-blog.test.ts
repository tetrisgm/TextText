// "Make me a Medium blog" has to produce three things, not one: a look for a
// post, a look for the folder index that lists the posts, and a folder that
// actually carries it. A look that renders one post beautifully and leaves the
// blog page untouched is the failure this pins.
//
// The model half is measured by scripts/eval-look-authoring.ts, which needs a
// provider key. This is the half that can be checked in milliseconds: given
// the operations a model emits, does the engine carry them all the way to two
// rendered surfaces, and are its refusals specific enough to correct?

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DocumentCollectionRenderer,
  DocumentRenderer,
} from "@/components/document/DocumentRenderer";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import {
  applyTemplateOperations,
  parseTemplateOperations,
} from "@/lib/presentation/operations";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { workspaceAgentToolNamesForView } from "@/lib/ai/agent-tools";

/** What a model emits for "make my blog read like Medium". */
const MEDIUM_BLOG = [
  { op: "set-name", name: "Magazine" },
  {
    op: "set-fields",
    fields: [
      { id: "cover", label: "Cover", type: "image" },
      { id: "readingTime", label: "Reading time", type: "text" },
    ],
  },
  {
    op: "replace-item",
    item: {
      type: "stack",
      gap: "md",
      children: [
        {
          type: "masthead",
          gap: "sm",
          children: [
            {
              type: "text",
              bind: "content.title",
              role: "title",
              fallback: "Untitled",
            },
            {
              type: "text",
              bind: "content.subtitle",
              role: "subtitle",
              showWhen: "content.subtitle",
            },
            { type: "byline" },
          ],
        },
        {
          type: "cover",
          bind: "content.fields.cover",
          alt: "content.title",
          height: "large",
          showWhen: "content.fields.cover",
        },
        { type: "prose", bind: "content.body" },
      ],
    },
  },
  // The index. A look that sets only `item` leaves the folder page unchanged,
  // which is the most common way this request half-lands.
  {
    op: "replace-collection-item",
    item: {
      type: "stack",
      direction: "horizontal",
      gap: "md",
      align: "center",
      children: [
        {
          type: "stack",
          gap: "xs",
          children: [
            {
              type: "text",
              bind: "content.title",
              role: "heading",
              fallback: "Untitled",
            },
            {
              type: "text",
              bind: "content.subtitle",
              role: "caption",
              showWhen: "content.subtitle",
            },
            {
              type: "text",
              bind: "content.fields.readingTime",
              role: "meta",
              showWhen: "content.fields.readingTime",
            },
          ],
        },
        {
          type: "cover",
          bind: "content.fields.cover",
          alt: "content.title",
          height: "compact",
          showWhen: "content.fields.cover",
        },
      ],
    },
  },
  { op: "set-collection-layout", layout: "list", columns: 1, gap: "lg" },
  { op: "set-collection-sort", sort: [{ field: "publishedAt", direction: "desc" }] },
] as const;

const base = requireBuiltinTemplate("texttext.article");

function magazine() {
  return applyTemplateOperations(
    { ...base, id: "acme.magazine", version: 1, name: "Magazine" },
    parseTemplateOperations(structuredClone(MEDIUM_BLOG)),
  );
}

function post(title: string) {
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title,
      body: "The opening paragraph of the piece.",
      tags: [],
      assets: [],
      fields: { readingTime: "6 min read" },
    },
    presentation: {
      template: { id: "acme.magazine", version: 1 },
      theme: {},
    },
  });
}

describe("a look asked for in words reaches both surfaces", () => {
  it("carries the brief into one validated look", () => {
    const template = magazine();
    expect(template.name).toBe("Magazine");
    expect(template.collection.layout).toBe("list");
    expect(template.collection.columns).toBe(1);
    expect(template.collection.gap).toBe("lg");
    expect(template.collection.sort[0]).toMatchObject({
      field: "publishedAt",
      direction: "desc",
    });
  });

  it("renders the item page", () => {
    const html = renderToStaticMarkup(
      DocumentRenderer({ document: post("On slow software"), template: magazine() }),
    );
    expect(html).toContain("On slow software");
    expect(html).toContain("The opening paragraph of the piece.");
  });

  it("renders the folder index from the same look", () => {
    // The index is a different render tree over the same documents. It must
    // show what the brief asked an index to show, and must NOT dump the body.
    const html = renderToStaticMarkup(
      DocumentCollectionRenderer({
        document: post("On slow software"),
        template: magazine(),
      }),
    );
    expect(html).toContain("On slow software");
    expect(html).toContain("6 min read");
    expect(html).not.toContain("The opening paragraph of the piece.");
  });

  it("offers the tools that finish the request, not just the ones that start it", () => {
    // Authoring a look and never applying it is the failure that reads as
    // "the AI said it did it and nothing changed".
    const tools = workspaceAgentToolNamesForView(
      { level: "workspace", folderPath: "blog" },
      "make my blog look like Medium",
    );
    expect(tools).toContain("list_document_templates");
    expect(tools).toContain("preview_document_template");
    expect(tools).toContain("customize_document_template");
    expect(tools).toContain("set_folder_template");
  });

  it("says what is available when a binding names nothing", () => {
    // The rejection is the model's only feedback. "undeclared field x" leaves
    // it guessing; the vocabulary lets it correct on the next call.
    let message = "";
    try {
      applyTemplateOperations(
        base,
        parseTemplateOperations([
          {
            op: "set-fields",
            fields: [{ id: "cover", label: "Cover", type: "image" }],
          },
          {
            op: "replace-item",
            item: { type: "text", bind: "content.fields.byline", role: "body" },
          },
        ]),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("content.fields.byline");
    expect(message).toContain("Available bindings");
    expect(message).toContain("content.fields.cover");
    expect(message).toContain("content.title");
  });

  it("says what a node accepts when the binding is the wrong kind", () => {
    let message = "";
    try {
      applyTemplateOperations(
        base,
        parseTemplateOperations([
          {
            op: "set-fields",
            fields: [{ id: "cover", label: "Cover", type: "image" }],
          },
          {
            op: "replace-item",
            item: {
              type: "prose",
              bind: "content.fields.cover",
            },
          },
        ]),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("content.fields.cover");
    expect(message).toContain("accepts:");
  });

  it("lets a board look carry the field it groups by", () => {
    // Declared, stored, validated and then ignored at render time was the old
    // behaviour: set-collection-layout could not express groupBy at all.
    const template = applyTemplateOperations(
      requireBuiltinTemplate("texttext.todo"),
      parseTemplateOperations([
        {
          op: "set-collection-layout",
          layout: "board",
          groupBy: "content.fields.area",
        },
      ]),
    );
    expect(template.collection.layout).toBe("board");
    expect(template.collection.groupBy).toBe("content.fields.area");
  });
});
