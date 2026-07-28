import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  applyDocumentMutation,
  applyDocumentSnapshot,
  applyDocumentBaseline,
  documentTheme,
  documentSnapshotFromYDoc,
  encodeDocumentBaseline,
} from "@/lib/collab/document";
import { evaluateMultiClientCollaboration } from "@/lib/collab/evaluation";
import type { DocumentSnapshot } from "@/lib/documents/model";

const snapshot: DocumentSnapshot = {
  schemaVersion: 1,
  content: {
    title: "Shared draft",
    subtitle: "One document",
    body: "A body everyone can edit.",
    fields: { cover: "/asset/cover.jpg", rating: 5 },
    tags: ["collaboration"],
    assets: [{ id: "cover", kind: "image", src: "/asset/cover.jpg" }],
  },
  presentation: {
    template: { id: "texttext.article", version: 1 },
    theme: { accent: "#0071e3", measure: "wide" },
  },
};

describe("canonical collaboration document", () => {
  it("encodes a deterministic full-document baseline", () => {
    expect(Array.from(encodeDocumentBaseline(snapshot, "post:7"))).toEqual(
      Array.from(encodeDocumentBaseline(snapshot, "post:7")),
    );
  });

  it("round-trips content, fields, assets, and presentation", () => {
    const doc = new Y.Doc();
    applyDocumentBaseline(doc, snapshot, "post:7");
    expect(documentSnapshotFromYDoc(doc)).toEqual(snapshot);
    doc.destroy();
  });

  it("reads the legacy atomic theme representation", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshot);
    const presentation = doc
      .getMap("document")
      .get("presentation") as Y.Map<unknown>;
    presentation.set("theme", { accent: "#FF375F", density: "compact" });
    expect(documentSnapshotFromYDoc(doc).presentation.theme).toEqual({
      accent: "#FF375F",
      density: "compact",
    });
    doc.destroy();
  });

  it("preserves the shared theme map when applying a later snapshot", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshot);
    const theme = documentTheme(doc);
    applyDocumentSnapshot(doc, {
      ...snapshot,
      presentation: {
        ...snapshot.presentation,
        theme: { accent: "#FF375F", density: "compact" },
      },
    });
    expect(documentTheme(doc)).toBe(theme);
    expect(documentSnapshotFromYDoc(doc).presentation.theme).toEqual({
      accent: "#FF375F",
      density: "compact",
    });
    doc.destroy();
  });

  it("applies constrained agent mutations without replacing presentation", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshot);
    const theme = documentTheme(doc);
    applyDocumentMutation(doc, {
      title: "Agent-maintained draft",
      subtitle: null,
      appendBody: "A release note appended while the document is open.",
      tags: ["collaboration", "changelog"],
    });
    const result = documentSnapshotFromYDoc(doc);
    expect(result.content).toMatchObject({
      title: "Agent-maintained draft",
      body:
        "A body everyone can edit.\n\n" +
        "A release note appended while the document is open.",
      tags: ["collaboration", "changelog"],
    });
    expect(result.content.subtitle).toBeUndefined();
    expect(documentTheme(doc)).toBe(theme);
    expect(result.presentation).toEqual(snapshot.presentation);
    doc.destroy();
  });

  it("applies an identified append only once across retries", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshot);

    expect(
      applyDocumentMutation(doc, {
        appendBody: "Release 0.138",
        operationId: "release:0.138",
      }),
    ).toBe(true);
    expect(
      applyDocumentMutation(doc, {
        appendBody: "Release 0.138",
        operationId: "release:0.138",
      }),
    ).toBe(false);

    expect(documentSnapshotFromYDoc(doc).content.body).toBe(
      "A body everyone can edit.\n\nRelease 0.138",
    );
    doc.destroy();
  });

  it("preserves a concurrent human edit while an agent appends", () => {
    const human = new Y.Doc();
    const agent = new Y.Doc();
    const baseline = encodeDocumentBaseline(snapshot, "post:live");
    Y.applyUpdate(human, baseline);
    Y.applyUpdate(agent, baseline);

    const humanBody = (
      human.getMap("document").get("body") as Y.Text
    );
    humanBody.insert(humanBody.length, " Human edit.");
    applyDocumentMutation(agent, {
      appendBody: "Agent milestone.",
      operationId: "milestone:1",
    });

    Y.applyUpdate(human, Y.encodeStateAsUpdate(agent));
    Y.applyUpdate(agent, Y.encodeStateAsUpdate(human));
    const humanResult = documentSnapshotFromYDoc(human).content.body;
    const agentResult = documentSnapshotFromYDoc(agent).content.body;
    expect(humanResult).toBe(agentResult);
    expect(humanResult).toContain("Human edit.");
    expect(humanResult).toContain("Agent milestone.");
    human.destroy();
    agent.destroy();
  });

  it("converges browser, native, agent, and offline edits", () => {
    expect(evaluateMultiClientCollaboration()).toMatchObject({
      status: "pass",
      clients: 4,
      awarenessStates: 4,
      assets: 2,
    });
  });
});
