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
import { toggleEditablePostStarredAction } from "@/app/editor/actions";

vi.mock("@/app/editor/actions", () => ({
  createWorkspacePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  toggleEditablePostStarredAction: vi.fn(),
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
  it("opens Add agent only on the manageable active item", () => {
    const command = WORKSPACE_COMMANDS.find((entry) => entry.id === "item.add-agent")!;
    const ctx = { ...context({ canManagePost: true, activePostId: "active", selectedPostId: "different", viewLevel: "post" }), openAddAgent: vi.fn() };
    expect(command.when(ctx)).toBe(true);
    command.run(ctx);
    expect(ctx.openAddAgent).toHaveBeenCalledWith("active");
    expect(command.when({ ...ctx, workspace: { ...ctx.workspace!, canManagePost: false } })).toBe(false);
    expect(command.when({ ...ctx, workspace: { ...ctx.workspace!, viewLevel: "settings" } })).toBe(false);
    expect(command.when({ ...ctx, workspace: { ...ctx.workspace!, activePostId: null } })).toBe(false);
  });
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
      { key: "/", label: "/", requiresWorkspace: true, once: true },
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

  it("binds Shift Arrow keys to range extension", () => {
    const directions: number[] = [];
    const previous = WORKSPACE_COMMANDS.find(
      (command) => command.id === "selection.extend-previous",
    );
    const next = WORKSPACE_COMMANDS.find(
      (command) => command.id === "selection.extend-next",
    );
    const ctx = context({
      extendSelection(direction) {
        directions.push(direction);
      },
    });

    expect(shortcutList(previous!)).toEqual([
      { key: "ArrowUp", label: "Shift ↑", shift: true },
    ]);
    expect(shortcutList(next!)).toEqual([
      { key: "ArrowDown", label: "Shift ↓", shift: true },
    ]);
    previous!.run(ctx);
    next!.run(ctx);
    expect(directions).toEqual([-1, 1]);
  });

  it("separates global Cmd-number navigation from plain item numbers", () => {
    const navigation = WORKSPACE_COMMANDS.find(
      (command) => command.id === "navigation.target.2",
    );
    const item = WORKSPACE_COMMANDS.find(
      (command) => command.id === "navigation.item.1",
    );
    const navigate = vi.fn();
    const openItem = vi.fn();
    const ctx = context({
      viewLevel: "root",
      getNavigationTargetPaths: () => ["", "blog", "notes"],
      getVisiblePostIds: () => ["recent-1"],
      navigateToNavTargetByIndex: navigate,
      openItemByIndex: openItem,
    });

    expect(shortcutList(navigation!)).toEqual([
      {
        key: "2",
        meta: true,
        label: "⌘2",
        allowTypingTarget: true,
      },
    ]);
    expect(navigation!.when(ctx)).toBe(true);
    navigation!.run(ctx);
    item!.run(ctx);
    expect(navigate).toHaveBeenCalledWith(1);
    expect(openItem).toHaveBeenCalledWith(0);
  });

  it("uses S to toggle the personal star and delegates a multi-selection", () => {
    const post = {
      id: "post-1",
      blogId: "workspace-1",
      type: "note" as const,
      slug: "post-1",
      title: "Private note",
      body: "Private body",
      status: "draft" as const,
      pinned: true,
      starred: false,
    };
    vi.mocked(toggleEditablePostStarredAction).mockResolvedValue(post);
    const toggleBulk = vi.fn();
    const command = WORKSPACE_COMMANDS.find(
      (candidate) => candidate.id === "post.star",
    );
    const base = {
      canManagePost: true,
      getPost: () => post,
      handle: "writer",
      selectedPostId: post.id,
      toggleStarSelected: toggleBulk,
    };

    command!.run(context({ ...base, selectedPostIds: [post.id] }));
    expect(shortcutList(command!)).toEqual([{ key: "s", label: "S", once: true }]);
    expect(toggleEditablePostStarredAction).toHaveBeenCalledWith(
      "writer",
      post.id,
    );
    expect(post.pinned).toBe(true);

    vi.mocked(toggleEditablePostStarredAction).mockClear();
    command!.run(
      context({ ...base, selectedPostIds: [post.id, "post-2"] }),
    );
    expect(toggleBulk).toHaveBeenCalledOnce();
    expect(toggleEditablePostStarredAction).not.toHaveBeenCalled();
  });

  it("passes every selected item to the keyboard trash action", () => {
    const requestDeleteTarget = vi.fn();
    const command = WORKSPACE_COMMANDS.find(
      (candidate) => candidate.id === "post.delete",
    );
    const ctx = context({
      canManagePost: true,
      getPost: (postId) =>
        ({
          id: postId,
          blogId: "workspace-1",
          type: "note",
          slug: postId,
          title: postId,
          status: "draft",
        }) as WorkspacePoolPayload["posts"][number],
      requestDeleteTarget,
      selectedPostId: "post-1",
      selectedPostIds: ["post-1", "post-2", "post-3"],
    });

    command!.run(ctx);

    expect(requestDeleteTarget).toHaveBeenCalledWith([
      "post-1",
      "post-2",
      "post-3",
    ]);
    expect(shortcutList(command!)).toEqual([
      { key: "Delete", label: "Del", once: true },
      { key: "Backspace", meta: true, label: "⌘Delete", once: true },
      { key: "Delete", ctrl: true, label: "Ctrl Delete", once: true },
    ]);
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
