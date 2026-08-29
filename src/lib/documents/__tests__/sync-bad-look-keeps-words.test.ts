import { describe, expect, it } from "vitest";

import { parseSyncDocumentEnvelope } from "@/lib/documents/sync";

/**
 * A look the server cannot read must never cost someone their writing.
 *
 * The template was validated as part of the whole envelope, so an unreadable
 * look threw in parseSyncDocumentEnvelope, the PUT route caught it and
 * returned 400, and the document never reached the save. The comment at that
 * route promised "a malformed or unwelcome look must not fail the write: the
 * person's words are the thing being saved" and the code did precisely the
 * opposite. Found by adversarial review, not by any test.
 *
 * This matters more than an ordinary validation bug because a `.textpack`
 * lives outside the database and never expires, so the ingress boundary meets
 * looks written by builds that no longer exist.
 */
const WORDS = "# Kept\n\nThe words survive a look the server cannot read.\n";

function envelope(template: unknown): string {
  return JSON.stringify({
    schema: "texttext.sync-document.v1",
    markdown: WORDS,
    document: {
      schemaVersion: 1,
      content: { title: "Kept", body: "", fields: {}, tags: [], assets: [] },
      presentation: { template: { id: "custom.unreadable", version: 1 }, theme: {} },
    },
    template,
  });
}

describe("a look the server cannot parse", () => {
  it("does not stop the words being saved", () => {
    const parsed = parseSyncDocumentEnvelope(
      envelope({ id: "custom.unreadable", version: 1, thisIsNotATemplate: true }),
    );
    expect(parsed.markdown).toBe(WORDS);
    expect(parsed.document.content.title).toBe("Kept");
    expect(parsed.template).toBeUndefined();
  });

  it("survives a look that is not even an object", () => {
    for (const bad of ["a string", 42, [], null]) {
      const parsed = parseSyncDocumentEnvelope(envelope(bad));
      expect(parsed.markdown).toBe(WORDS);
      expect(parsed.template).toBeUndefined();
    }
  });

  it("survives a look carrying a render node that no longer exists", () => {
    const parsed = parseSyncDocumentEnvelope(
      envelope({
        schemaVersion: 1,
        engineVersion: 1,
        id: "custom.future",
        version: 1,
        name: "From a later build",
        fields: [],
        item: { type: "stack", children: [{ type: "somethingNewerThanThisBuild" }] },
        collection: { layout: "list", item: { type: "stack", children: [] } },
        theme: {},
      }),
    );
    expect(parsed.markdown).toBe(WORDS);
    expect(parsed.template).toBeUndefined();
  });

  it("still carries a look it CAN read", () => {
    const good = {
      schemaVersion: 1,
      engineVersion: 1,
      id: "custom.fine",
      version: 1,
      name: "Fine",
      fields: [],
      item: {
        type: "stack",
        children: [{ type: "text", bind: "content.title", role: "title" }],
      },
      collection: {
        layout: "list",
        item: {
          type: "stack",
          children: [{ type: "text", bind: "content.title", role: "title" }],
        },
      },
      theme: {},
    };
    const parsed = parseSyncDocumentEnvelope(envelope(good));
    expect(parsed.template?.id).toBe("custom.fine");
  });
});
