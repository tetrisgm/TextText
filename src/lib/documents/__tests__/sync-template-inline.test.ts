import { describe, expect, it } from "vitest";

import {
  parseSyncDocumentEnvelope,
  renderSyncDocumentEnvelope,
  serializeSyncDocumentEnvelope,
} from "@/lib/documents/sync";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import type { Post } from "@/lib/content";

/**
 * The container is the document. A synced textpack that names a template id
 * and version says nothing to anyone outside the workspace that stores it, so
 * the definition itself travels too. Optional, so a workspace that predates
 * this and a document pinned to a deleted look both still sync.
 */
const template = BUILTIN_TEMPLATES.find((entry) => entry.id === "texttext.todo")!;

const post = {
  slug: "launch-week",
  title: "Launch week",
  body: "Everything before Tuesday.",
  type: "note",
  status: "draft",
  document: {
    schemaVersion: 1,
    content: {
      title: "Launch week",
      subtitle: undefined,
      body: "Everything before Tuesday.",
      fields: { area: "work" },
      tags: [],
      assets: [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  },
} as unknown as Post;

describe("a synced document carries its look", () => {
  it("inlines the definition, not just the reference", () => {
    const envelope = renderSyncDocumentEnvelope({
      markdown: "# Launch week\n",
      post,
      template,
    });
    expect(envelope.template?.id).toBe(template.id);
    expect(envelope.template?.fields.length).toBe(template.fields.length);
    // The reference stays: a workspace that knows the look uses its own copy.
    expect(envelope.document.presentation.template).toEqual({
      id: template.id,
      version: template.version,
    });
  });

  it("survives serialize and parse unchanged", () => {
    const serialized = serializeSyncDocumentEnvelope(
      renderSyncDocumentEnvelope({ markdown: "# Launch week\n", post, template }),
    );
    const parsed = parseSyncDocumentEnvelope(serialized);
    expect(parsed.template).toEqual(template);
    expect(parsed.document.content.fields).toEqual({ area: "work" });
  });

  it("omits the key entirely when there is no look to send", () => {
    const envelope = renderSyncDocumentEnvelope({ markdown: "# x\n", post });
    expect("template" in envelope).toBe(false);
    // And an envelope without it still parses, which is what lets an older
    // server and a deleted look both keep working.
    expect(() =>
      parseSyncDocumentEnvelope(serializeSyncDocumentEnvelope(envelope)),
    ).not.toThrow();
  });

  it("changes the file hash, so a client refetches once and then settles", () => {
    const withLook = serializeSyncDocumentEnvelope(
      renderSyncDocumentEnvelope({ markdown: "# x\n", post, template }),
    );
    const without = serializeSyncDocumentEnvelope(
      renderSyncDocumentEnvelope({ markdown: "# x\n", post }),
    );
    expect(withLook).not.toBe(without);
  });
});
