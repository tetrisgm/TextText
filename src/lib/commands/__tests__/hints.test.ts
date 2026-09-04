import { describe, expect, it, vi } from "vitest";

// The command table imports the editor's server actions; the hints do not
// care what they do.
vi.mock("@/app/editor/actions", () => ({
  createWorkspacePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  toggleEditablePostStarredAction: vi.fn(),
}));
import { keyHintsFor } from "@/lib/commands/hints";
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
