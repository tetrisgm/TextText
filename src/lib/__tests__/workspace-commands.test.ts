import { describe, expect, it, vi } from "vitest";
import type {
  CommandContext,
  CommandWorkspaceSurface,
} from "@/lib/commands/types";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import {
  WORKSPACE_COMMANDS,
  shouldSuppressWorkspaceSingleKeyShortcut,
  shortcutList,
} from "@/lib/commands/workspace";

vi.mock("@/app/editor/actions", () => ({
  createWorkspacePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  toggleEditablePostPinnedAction: vi.fn(),
}));

function context(
  workspace: Partial<CommandWorkspaceSurface>,
): CommandContext {
  return {
    pool: { version: 1 } as WorkspacePoolPayload,
    workspace: workspace as CommandWorkspaceSurface,
    navigate() {},
    refresh() {},
    openPalette() {},
    openShortcuts() {},
    closePalette() {},
    toast() {},
  };
}

describe("workspace commands", () => {
  it("uses Cmd-K only for the palette and reserves slash for search", () => {
    const palette = WORKSPACE_COMMANDS.find(
      (command) => command.id === "command.palette",
    );
    const search = WORKSPACE_COMMANDS.find(
      (command) => command.id === "workspace.search",
    );

    expect(shortcutList(palette!).map((shortcut) => shortcut.label)).toEqual([
      "⌘K",
      "Ctrl K",
    ]);
    expect(shortcutList(search!)).toEqual([
      { key: "/", label: "/", requiresWorkspace: true },
    ]);
  });

  it("keeps Backspace available at home so the browser cannot consume it", () => {
    const up = WORKSPACE_COMMANDS.find(
      (command) => command.id === "navigation.up",
    );
    expect(up?.when(context({ viewLevel: "root" }))).toBe(true);
  });

  it("binds J and K to the same spatial movement as the arrow keys", () => {
    const directions: string[] = [];
    const up = WORKSPACE_COMMANDS.find(
      (command) => command.id === "selection.previous",
    );
    const down = WORKSPACE_COMMANDS.find(
      (command) => command.id === "selection.next",
    );
    const ctx = context({
      selectSpatial(direction) {
        directions.push(direction);
      },
    });

    expect(shortcutList(up!).map((shortcut) => shortcut.label)).toEqual([
      "↑",
      "K",
    ]);
    expect(shortcutList(down!).map((shortcut) => shortcut.label)).toEqual([
      "↓",
      "J",
    ]);
    up!.run(ctx);
    down!.run(ctx);
    expect(directions).toEqual(["up", "down"]);
  });

  it("creates a blank bookmark through the workspace create surface", async () => {
    let created: string | null = null;
    const command = WORKSPACE_COMMANDS.find(
      (candidate) => candidate.id === "create.bookmark",
    );
    const ctx = context({
      canCreate: true,
      createItem(kind) {
        created = kind;
      },
    });

    await command!.run(ctx);
    expect(created).toBe("bookmark");
  });

  it("suppresses printable shortcuts while a note is open neutrally", () => {
    const noteContext = context({
      activePostId: "note-1",
      viewLevel: "edit",
      getPost: () => ({
        id: "note-1",
        blogId: "workspace-1",
        type: "note",
        slug: "note-1",
        title: "Note",
        status: "draft",
      }),
    });
    expect(
      shouldSuppressWorkspaceSingleKeyShortcut(noteContext, {
        altKey: false,
        ctrlKey: false,
        key: "c",
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldSuppressWorkspaceSingleKeyShortcut(noteContext, {
        altKey: false,
        ctrlKey: false,
        key: "j",
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldSuppressWorkspaceSingleKeyShortcut(noteContext, {
        altKey: false,
        ctrlKey: false,
        key: "Escape",
        metaKey: false,
      }),
    ).toBe(false);
  });
});
