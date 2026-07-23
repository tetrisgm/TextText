import { describe, expect, it } from "vitest";

import { parsePostMarkdownFile } from "@/lib/markdown-files";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import {
  mergeMarkdownIntoDocument,
  parseSyncDocumentEnvelope,
  serializeSyncDocumentEnvelope,
  SYNC_DOCUMENT_SCHEMA,
} from "@/lib/documents/sync";

describe("structured document sync", () => {
  it("serializes envelopes deterministically", () => {
    const document = emptyDocumentSnapshot({
      id: "texttext.gallery",
      version: 1,
    });
    document.content.title = "A document";
    document.content.fields = { zeta: true, alpha: "first" };

    const serialized = serializeSyncDocumentEnvelope({
      schema: SYNC_DOCUMENT_SCHEMA,
      markdown: "# A document\n",
      document,
    });

    expect(serializeSyncDocumentEnvelope(parseSyncDocumentEnvelope(serialized)))
      .toBe(serialized);
    expect(serialized.indexOf('"alpha"')).toBeLessThan(
      serialized.indexOf('"zeta"'),
    );
  });

  it("rejects malformed and open-ended document input", () => {
    expect(() => parseSyncDocumentEnvelope("not JSON")).toThrow(
      "The structured document is not valid JSON",
    );
    expect(() =>
      parseSyncDocumentEnvelope(
        JSON.stringify({
          schema: SYNC_DOCUMENT_SCHEMA,
          markdown: "Body",
          document: {
            ...emptyDocumentSnapshot(),
            executable: "alert(1)",
          },
        }),
      ),
    ).toThrow();
  });

  it("keeps presentation while explicit Markdown content wins", () => {
    const document = emptyDocumentSnapshot({
      id: "texttext.gallery",
      version: 4,
    });
    document.content.title = "Structured title";
    document.content.body = "Structured body";
    document.content.fields = { custom: "kept", cover: "old.jpg" };
    document.presentation.theme = { accent: "#112233", corners: "square" };

    const parsed = parsePostMarkdownFile(
      "---\ntitle: Markdown title\ncover: new.jpg\nunknownPresentation: ignored\n---\n\nMarkdown body\n",
    );
    const merged = mergeMarkdownIntoDocument(document, parsed);

    expect(merged.content.title).toBe("Markdown title");
    expect(merged.content.body.trim()).toBe("Markdown body");
    expect(merged.content.fields).toMatchObject({
      custom: "kept",
      cover: "new.jpg",
    });
    expect(merged.content.fields).not.toHaveProperty("unknownPresentation");
    expect(merged.presentation).toEqual(document.presentation);
  });
});
