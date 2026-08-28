import { describe, expect, it } from "vitest";

import {
  parseSyncDocumentEnvelope,
  renderSyncDocumentEnvelope,
  serializeSyncDocumentEnvelope,
} from "@/lib/documents/sync";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import type { Post } from "@/lib/content";

/**
 * The plan's own test for this: a textpack exported from one workspace and
 * imported into another looks the same in both.
 *
 * The definition travelling OUT was the easy half, and for a while it was the
 * only half: the receiving side read the file, kept the words, and threw the
 * look away. This asserts the whole trip, at the layer both ends share.
 */
const template = compileItemTypeBlueprint(
  {
    name: "Recipe",
    description: "A recipe card with what it takes and how long.",
    fields: [
      { id: "cookTime", label: "Cook time", type: "number" },
      { id: "serves", label: "Serves", type: "number" },
    ],
    item: { shape: "page" },
    collection: { layout: "cards" },
    theme: { typography: "editorial" },
  },
  { id: "custom.recipe" },
);

const post = {
  slug: "weeknight-dal",
  title: "Weeknight dal",
  body: "Ready in 35 minutes.",
  type: "note",
  status: "draft",
  document: {
    schemaVersion: 1,
    content: {
      title: "Weeknight dal",
      subtitle: undefined,
      body: "Ready in 35 minutes.",
      fields: { cookTime: 35, serves: 4 },
      tags: [],
      assets: [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  },
} as unknown as Post;

describe("a textpack carried to another workspace", () => {
  const onTheWire = serializeSyncDocumentEnvelope(
    renderSyncDocumentEnvelope({
      markdown: "# Weeknight dal\n\nReady in 35 minutes.\n",
      post,
      template,
    }),
  );

  it("arrives with the whole look, not a name for one", () => {
    const arrived = parseSyncDocumentEnvelope(onTheWire);
    expect(arrived.template).toBeDefined();
    // The receiving workspace has never seen this id, so a reference alone
    // would leave it with a document pinned to a look it cannot resolve.
    expect(arrived.template!.id).toBe("custom.recipe");
    expect(arrived.template!.fields.map((field) => field.id)).toEqual([
      "cookTime",
      "serves",
    ]);
    expect(arrived.template!.collection.layout).toBe("cards");
    expect(arrived.template!.theme.typography).toBe("editorial");
  });

  it("lands at the exact version the document is pinned to", () => {
    const arrived = parseSyncDocumentEnvelope(onTheWire);
    // installDocumentTemplate stores it under this id and version rather than
    // the next free one, or the pin below would point at nothing.
    expect({
      id: arrived.template!.id,
      version: arrived.template!.version,
    }).toEqual(arrived.document.presentation.template);
  });

  it("is a look the receiving workspace can actually store", () => {
    const arrived = parseSyncDocumentEnvelope(onTheWire);
    expect(() => validateTemplateDefinition(arrived.template)).not.toThrow();
  });

  it("keeps the values the look is there to display", () => {
    const arrived = parseSyncDocumentEnvelope(onTheWire);
    expect(arrived.document.content.fields).toEqual({ cookTime: 35, serves: 4 });
    expect(arrived.markdown).toContain("Ready in 35 minutes.");
  });

  it("renders the same on both sides, field for field", () => {
    const arrived = parseSyncDocumentEnvelope(onTheWire);
    // What the reader sees is the look's fields resolved against the values.
    const shown = (definition: typeof template, fields: Record<string, unknown>) =>
      definition.fields.map((field) => `${field.label}=${fields[field.id] ?? ""}`);
    expect(
      shown(arrived.template as typeof template, arrived.document.content.fields),
    ).toEqual(shown(template, { cookTime: 35, serves: 4 }));
  });
});
