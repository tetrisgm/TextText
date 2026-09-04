import { describe, expect, it, vi } from "vitest";

// The command table imports the editor's server actions; the hints do not
// care what they do.
vi.mock("@/app/editor/actions", () => ({
  createWorkspacePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  toggleEditablePostStarredAction: vi.fn(),
}));
import { commandTip, hintPhrase, keyHintsFor } from "@/lib/commands/hints";
import {
  WORKSPACE_COMMANDS,
  workspaceShortcutRows,
} from "@/lib/commands/workspace";
import type { CommandContext } from "@/lib/commands/types";

const workspace = (over: Record<string, unknown> = {}) =>
  ({
    viewLevel: "section",
    canCreate: true,
    canEdit: true,
    canManagePost: true,
    selectedPostId: "a",
    selectedPostIds: ["a"],
    activePostId: null,
    getPost: () => ({ id: "a", type: "note" }),
    getVisiblePostIds: () => ["a"],
    closeActiveTab: () => {},
    cycleTab: () => {},
    openInNewTab: () => {},
    reopenClosedTab: () => {},
    ...over,
  }) as unknown as CommandContext["workspace"];

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    workspace: workspace(over),
    pool: null,
    openPalette: () => {},
    openShortcuts: () => {},
    toast: () => {},
  }) as unknown as CommandContext;

describe("keyHintsFor", () => {
  it("offers list keys on a list and document keys in a document", () => {
    const list = keyHintsFor(ctx()).map((h) => h.id);
    expect(list).toContain("selection.select-all");
    const doc = keyHintsFor(ctx({ viewLevel: "edit", activePostId: "a" })).map(
      (h) => h.id,
    );
    expect(doc).not.toContain("selection.select-all");
  });

  it("never advertises a key that would do nothing", () => {
    expect(
      keyHintsFor({ workspace: null } as unknown as CommandContext),
    ).toEqual([]);
    const doc = keyHintsFor(ctx({ viewLevel: "post", activePostId: "a" }));
    expect(doc.every((h) => h.id !== "selection.select-all")).toBe(true);
  });

  it("carries a real key label for every hint, and respects the limit", () => {
    const hints = keyHintsFor(ctx(), 3);
    expect(hints.length).toBeLessThanOrEqual(3);
    expect(hints.every((h) => h.keys.length > 0)).toBe(true);
    expect(hints.every((h) => h.label.length > 0)).toBe(true);
  });
});

describe("hintPhrase", () => {
  it("lowers an ordinary sentence-case label so the bar reads as a sentence", () => {
    expect(hintPhrase("Open focused item")).toBe("open focused item");
    expect(hintPhrase("Select all items")).toBe("select all items");
  });

  it("leaves a label alone when lowering it would be wrong", () => {
    expect(hintPhrase("AI settings")).toBe("AI settings");
    expect(hintPhrase("TextText help")).toBe("TextText help");
  });
});

// The three teaching surfaces - the hint bar, the hover tooltip and the
// shortcut sheet - must all read the command table rather than carry their
// own copy of a label or a key, or a rebind reaches one of them and not the
// others. commandTip is what the tooltip reads; this pins it to the table.
describe("commandTip", () => {
  it("takes the label and keys from the command itself", () => {
    for (const id of ["navigation.back", "post.previous", "post.next"]) {
      const command = WORKSPACE_COMMANDS.find((entry) => entry.id === id);
      expect(command, `command ${id} should exist`).toBeDefined();
      expect(commandTip(id)).toEqual({
        label: command!.label,
        keys: expect.any(String),
      });
    }
  });

  it("returns null for an id no command claims, rather than inventing one", () => {
    expect(commandTip("navigation.sideways")).toBeNull();
  });
});

// The shortcut sheet is the exhaustive surface, which is exactly why it has
// to stay readable: nine rows that differ only by an ordinal are one idea.
describe("workspaceShortcutRows", () => {
  it("lists a numbered family once, as its range", () => {
    const rows = workspaceShortcutRows();
    const targets = rows.filter((row) =>
      row.label.startsWith("Open navigation target"),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].label).toBe("Open navigation target 1-9");
    expect(targets[0].shortcut).toBe("⌘1 to ⌘9");
  });

  it("says one action once, with every key that reaches it", () => {
    const rows = workspaceShortcutRows();
    const back = rows.filter(
      (row) => row.group === "Navigate" && row.label === "Go back",
    );
    expect(back).toHaveLength(1);
    expect(back[0].shortcut.split(", ")).toEqual(
      expect.arrayContaining(["⌘[", "Backspace"]),
    );
  });
});
