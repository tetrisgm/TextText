// Regression: edits made before the collab provider is ready must survive a
// remote baseline arriving first.
//
// The failing sequence, reproduced live before the fix: create a document,
// type into a field within ~1.5s, the provider pulls the server baseline
// while starting, the incoming update overwrites the only copy of the local
// edit, and the ready-merge compares the clobbered state against `initial`
// and keeps nothing. content.fields materialized empty in posts.document.
//
// The fix keeps pre-ready local edits in a ledger remote updates never touch,
// and the ready-merge overlays the LEDGER onto the authoritative baseline.
// These tests pin the overlay's semantics.

import { describe, expect, it } from "vitest";
import { overlayPreReadyEdits } from "../UnifiedDocumentEditor";
import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";

const snapshot = (
  fields: Record<string, unknown> = {},
  overrides: Partial<{ tags: string[]; title: string }> = {},
): DocumentSnapshot =>
  validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: overrides.title ?? "Launch week",
      body: "",
      fields,
      tags: overrides.tags ?? [],
      assets: [],
    },
    presentation: { template: { id: "texttext.todo", version: 1 }, theme: {} },
  });

describe("overlayPreReadyEdits", () => {
  it("keeps a pre-ready field edit over a baseline that lacks it", () => {
    const initial = snapshot({});
    const ledger = snapshot({
      items: [{ done: false, task: "Persist me", when: null, priority: null }],
    });
    const remoteBaseline = snapshot({}); // the server state that clobbered documentRef

    const merged = overlayPreReadyEdits(ledger, initial, remoteBaseline);
    expect(merged).not.toBeNull();
    expect(merged?.content.fields.items).toEqual([
      { done: false, task: "Persist me", when: null, priority: null },
    ]);
  });

  it("keeps pre-ready tag and presentation changes the same way", () => {
    const initial = snapshot({});
    const ledger = validateDocumentSnapshot({
      ...snapshot({}, { tags: ["launch"] }),
      presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
    });
    const merged = overlayPreReadyEdits(ledger, initial, snapshot({}));
    expect(merged?.content.tags).toEqual(["launch"]);
    expect(merged?.presentation.template.id).toBe("texttext.note");
  });

  it("returns null when local made no changes, so the baseline wins untouched", () => {
    const initial = snapshot({});
    expect(overlayPreReadyEdits(snapshot({}), initial, snapshot({}))).toBeNull();
  });

  it("does not resurrect initial state over newer remote content it never touched", () => {
    // Local changed only fields; the remote baseline carries a newer title.
    // The overlay must keep the remote title while restoring the local field.
    const initial = snapshot({});
    const ledger = snapshot({ rating: 5 });
    const remote = snapshot({}, { title: "Renamed elsewhere" });
    const merged = overlayPreReadyEdits(ledger, initial, remote);
    expect(merged?.content.title).toBe("Renamed elsewhere");
    expect(merged?.content.fields.rating).toBe(5);
  });
});
