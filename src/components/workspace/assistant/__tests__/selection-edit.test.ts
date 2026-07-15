import { describe, expect, it } from "vitest";
import {
  createWorkspaceItemTextEdit,
  createWorkspaceItemTextSelection,
  locateWorkspaceItemTextSelection,
  patchOpenWorkspaceItemDraftIfCurrent,
  readOpenWorkspaceItemDraft,
  registerOpenWorkspaceItemDraft,
  resolveWorkspaceItemTextEdit,
  setOpenWorkspaceItemSelection,
  type WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";

function item(body: string): WorkspaceItemTextSnapshot {
  return { title: "Draft", excerpt: "", body };
}

describe("assistant selection edits", () => {
  it("applies and undoes only the selected source range", () => {
    const source = "Keep this rough phrase and this ending.";
    const start = source.indexOf("rough phrase");
    const edit = createWorkspaceItemTextEdit({
      after: "clear sentence",
      end: start + "rough phrase".length,
      field: "body",
      source,
      start,
    });

    expect(edit).not.toBeNull();
    const apply = resolveWorkspaceItemTextEdit(item(source), edit!, "apply");
    expect(apply).toEqual({
      ok: true,
      expected: { body: source },
      patch: {
        body: "Keep this clear sentence and this ending.",
      },
    });
    if (!apply.ok) throw new Error("Expected an applicable edit");

    const undo = resolveWorkspaceItemTextEdit(
      { ...item(source), ...apply.patch },
      edit!,
      "undo",
    );
    expect(undo).toEqual({
      ok: true,
      expected: { body: "Keep this clear sentence and this ending." },
      patch: { body: source },
    });
  });

  it("rejects apply and undo after the guarded field changes", () => {
    const source = "A rough phrase.";
    const edit = createWorkspaceItemTextEdit({
      after: "A clear phrase.",
      end: source.length,
      field: "body",
      source,
      start: 0,
    });

    expect(
      resolveWorkspaceItemTextEdit(
        item(`${source} User edit.`),
        edit!,
        "apply",
      ),
    ).toEqual({ ok: false, reason: "stale" });
    expect(
      resolveWorkspaceItemTextEdit(
        item("A clear phrase. User edit."),
        edit!,
        "undo",
      ),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("invalidates a live selection when its underlying text changes", () => {
    let current = item("Select this phrase.");
    const unregister = registerOpenWorkspaceItemDraft("post-selection", {
      read: () => current,
      apply: (patch) => {
        current = { ...current, ...patch };
      },
    });
    const selection = createWorkspaceItemTextSelection(
      "body",
      current.body,
      7,
      11,
    );

    expect(setOpenWorkspaceItemSelection("post-selection", selection)).toBe(
      true,
    );
    expect(readOpenWorkspaceItemDraft("post-selection")?.selection?.text).toBe(
      "this",
    );
    current = item("Select that phrase.");
    expect(readOpenWorkspaceItemDraft("post-selection")?.selection).toBeNull();
    current = item("Select this phrase.");
    expect(readOpenWorkspaceItemDraft("post-selection")?.selection).toBeNull();
    unregister();
  });

  it("conditionally patches the open draft and fails closed when stale", () => {
    let current = item("Original body");
    const unregister = registerOpenWorkspaceItemDraft("post-guard", {
      read: () => current,
      apply: (patch) => {
        current = { ...current, ...patch };
      },
    });

    expect(
      patchOpenWorkspaceItemDraftIfCurrent(
        "post-guard",
        { body: "Replacement" },
        { body: "Original body" },
      ),
    ).toBe("applied");
    current = item("User changed this");
    expect(
      patchOpenWorkspaceItemDraftIfCurrent(
        "post-guard",
        { body: "Wrong replacement" },
        { body: "Replacement" },
      ),
    ).toBe("stale");
    expect(current.body).toBe("User changed this");
    unregister();
  });

  it("maps only unambiguous contenteditable text back to Markdown", () => {
    expect(
      locateWorkspaceItemTextSelection(
        "body",
        "First phrase. Second phrase.",
        "Second phrase",
      ),
    ).toMatchObject({ start: 14, end: 27, text: "Second phrase" });
    expect(
      locateWorkspaceItemTextSelection(
        "body",
        "Repeat here. Repeat here.",
        "Repeat",
      ),
    ).toBeNull();
    expect(
      locateWorkspaceItemTextSelection(
        "body",
        "Repeat here. Repeat there.",
        "Repeat",
        { beforeText: "Repeat here. ", afterText: " there." },
      ),
    ).toMatchObject({ start: 13, end: 19 });
  });
});
