import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/editor/actions", () => ({ createWorkspacePostAction: vi.fn(), movePostToFolderAction: vi.fn(), setEditablePostStatusAction: vi.fn(), toggleEditablePostStarredAction: vi.fn() }));
import { nativeMenuEntries, runNativeMenuCommand } from "../native-menu";
import { WORKSPACE_COMMANDS } from "../workspace";
import type { CommandContext, CommandWorkspaceSurface } from "../types";
function context(workspace: Partial<CommandWorkspaceSurface> | null = {}): CommandContext {
  return { workspace: workspace === null ? null : { selectedPostIds: [], getNavigationTargetPaths: () => [], getVisiblePostIds: () => [], readerScrollable: () => false, ...workspace } as CommandWorkspaceSurface, pool: null, navigate: vi.fn(), refresh: vi.fn(), openPalette: vi.fn(), openShortcuts: vi.fn(), closePalette: vi.fn(), toast: vi.fn() };
}
describe("native menu command behavior", () => {
  it("includes every menu-visible registered keyboard action", () => {
    const ids = nativeMenuEntries(context()).map(c => c.id);
    for (const command of WORKSPACE_COMMANDS.filter(c => c.shortcut && c.showInPalette !== false)) expect(ids).toContain(command.id);
  });
  it("omits keyboard plumbing and distinguishes the Backspace alias", () => {
    const rows = nativeMenuEntries(context());
    for (const command of WORKSPACE_COMMANDS.filter(c => c.showInPalette === false)) {
      expect(rows.find(c => c.id === command.id)).toBeUndefined();
      expect(runNativeMenuCommand(context(), command.id)).toBe(false);
    }
    expect(rows.find(c => c.id === "navigation.up")?.title).toBe("Go back (Backspace)");
    expect(rows.find(c => c.id === "navigation.back")?.title).toBe("Go back");
  });
  it("provides the Mac creation, search and settings shortcuts", () => {
    const rows = nativeMenuEntries(context());
    for (const [id, menu, key] of [["create.current", "File", "n"], ["native.new-folder", "File", "n"], ["command.palette", "File", "k"], ["workspace.search", "Edit", "f"], ["workspace.settings", "TextText", ","]]) {
      expect(rows.find(c => c.id === id)).toMatchObject({ menu, key });
    }
    expect(rows.find(c => c.id === "native.new-folder")?.modifiers).toEqual(["command", "shift"]);
  });
  it("disables all workspace actions while signed out", () => {
    expect(nativeMenuEntries(context(null)).every(c => !c.enabled)).toBe(true);
  });
  it("disables background actions behind a modal", () => {
    expect(nativeMenuEntries(context({ canCreate: true }), true).every(c => !c.enabled)).toBe(true);
    expect(runNativeMenuCommand(context(), "command.palette", true)).toBe(false);
  });
  it("rechecks permissions at invocation instead of trusting a snapshot", () => {
    const ctx = context({ canCreate: true });
    expect(nativeMenuEntries(ctx).find(c => c.id === "create.current")?.enabled).toBe(true);
    ctx.workspace!.canCreate = false;
    expect(runNativeMenuCommand(ctx, "create.current")).toBe(false);
  });
  it("rejects unknown and malformed command ids", () => {
    expect(runNativeMenuCommand(context(), "executeJavaScript")).toBe(false);
    expect(runNativeMenuCommand(context(), {})).toBe(false);
  });
  it("runs the existing palette action", () => {
    const ctx = context();
    expect(runNativeMenuCommand(ctx, "command.palette")).toBe(true);
    expect(ctx.openPalette).toHaveBeenCalledOnce();
  });
  it("checks the current appearance and uses its existing action", () => {
    const setAppearance = vi.fn();
    const ctx = context({ currentAppearance: () => "dark", setAppearance });
    expect(nativeMenuEntries(ctx).filter(c => c.checked).map(c => c.id)).toEqual(["workspace.appearance.dark"]);
    runNativeMenuCommand(ctx, "workspace.appearance.light");
    expect(setAppearance).toHaveBeenCalledWith("light");
  });
  it("keeps typing keys in the web responder instead of global menu equivalents", () => {
    const rows = nativeMenuEntries(context());
    expect(rows.find(c => c.id === "post.star")?.key).toBe("");
    expect(rows.find(c => c.id === "navigation.item.1")).toBeUndefined();
  });
  it("offers share only for a resolvable active item", () => {
    expect(nativeMenuEntries(context()).find(c => c.id === "native.share")?.enabled).toBe(false);
  });
});

describe("native creation and sharing dispatch", () => {
  it("uses the existing inline folder creation event", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    try {
      runNativeMenuCommand(context({ canCreate: true, activeFolderPath: "Notes/Work" }), "native.new-folder");
      expect(dispatchEvent.mock.calls[0][0].type).toBe("texttext:new-folder");
      expect(dispatchEvent.mock.calls[0][0].detail).toEqual({ parentPath: "Notes/Work" });
    } finally { vi.unstubAllGlobals(); }
  });
  it("shares a same-workspace item link without publishing the item", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", { webkit: { messageHandlers: { textTextApp: { postMessage } } } });
    try {
      runNativeMenuCommand(context({ handle: "me", activePostId: "one", getPost: () => ({ id: "one", slug: "a b", title: "Private" }) as never }), "native.share");
      expect(postMessage).toHaveBeenCalledWith({ action: "nativeShare", path: "/t/me/a%20b" });
    } finally { vi.unstubAllGlobals(); }
  });
});
