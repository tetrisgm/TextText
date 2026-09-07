import type { AppCommand, CommandContext } from "./types";
import { WORKSPACE_COMMANDS, dynamicWorkspaceCommands, shortcutList } from "./workspace";

export type NativeMenuEntry = {
  id: string; title: string; menu: string; key: string;
  modifiers: string[]; enabled: boolean; checked: boolean;
};
const overrides: Record<string, [string, string, string, string[]]> = {
  "native.new-folder": ["File", "New folder", "n", ["command", "shift"]],
  "native.share": ["File", "Share…", "", []],
  "create.current": ["File", "New item", "n", ["command"]],
  "command.palette": ["File", "Open quickly…", "k", ["command"]],
  "workspace.search": ["Edit", "Find…", "f", ["command"]],
  "workspace.settings": ["TextText", "Settings…", ",", ["command"]],
  "navigation.up": ["View", "Go back (Backspace)", "", []],
  "post.delete": ["Edit", "Move to Trash", "Backspace", ["command"]],
};
export function nativeMenuGroup(command: AppCommand): string {
  if (command.id === "command.shortcuts") return "Help";
  if (command.id.includes("tab")) return "Window";
  if (command.id.startsWith("create.")) return "File";
  if (["Edit", "Act", "Item"].includes(command.group) || command.id.startsWith("selection.")) return "Edit";
  return "View";
}
export function nativeCommands(ctx: CommandContext): AppCommand[] {
  const extra: AppCommand[] = [
    { id: "native.new-folder", label: "New folder", group: "Create",
      when: c => Boolean(c.workspace?.canCreate),
      run: c => { window.dispatchEvent(new CustomEvent("texttext:new-folder", { detail: { parentPath: c.workspace?.activeFolderPath ?? "" } })); } },
    { id: "native.share", label: "Share…", group: "File",
      when: c => Boolean(c.workspace?.activePostId && c.workspace.getPost(c.workspace.activePostId)),
      run: c => {
        const post = c.workspace?.activePostId ? c.workspace.getPost(c.workspace.activePostId) : null;
        if (!post || !c.workspace) return;
        const bridge = (window as typeof window & { webkit?: { messageHandlers?: { textTextApp?: { postMessage: (body: unknown) => void } } } }).webkit?.messageHandlers?.textTextApp;
        bridge?.postMessage({ action: "nativeShare", path: `/t/${encodeURIComponent(c.workspace.handle)}/${encodeURIComponent(post.slug)}` });
      } },
  ];
  return [...extra, ...WORKSPACE_COMMANDS, ...dynamicWorkspaceCommands(ctx).filter(c => c.group === "Appearance")]
    .filter(command => command.showInPalette !== false);
}
export function nativeMenuEntries(ctx: CommandContext, blocked = false): NativeMenuEntry[] {
  return nativeCommands(ctx).map(command => {
    const shortcut = shortcutList(command).find(s => s.meta || s.ctrl || s.alt);
    const override = overrides[command.id];
    return {
      id: command.id, menu: override?.[0] ?? nativeMenuGroup(command),
      title: override?.[1] ?? command.label.replace(" (current)", ""),
      key: override?.[2] ?? shortcut?.key ?? "",
      modifiers: override?.[3] ?? (shortcut ? [shortcut.meta && "command", shortcut.ctrl && "control", shortcut.alt && "option", shortcut.shift && "shift"].filter((v): v is string => Boolean(v)) : []),
      enabled: !blocked && Boolean(ctx.workspace) && command.when(ctx),
      checked: command.id === `workspace.appearance.${ctx.workspace?.currentAppearance?.()}`,
    };
  });
}
// Re-resolve at invocation. A menu snapshot is presentation, never authorization.
export function runNativeMenuCommand(ctx: CommandContext, id: unknown, blocked = false): boolean {
  if (blocked || !ctx.workspace || typeof id !== "string") return false;
  const command = nativeCommands(ctx).find(c => c.id === id);
  if (!command?.when(ctx)) return false;
  void Promise.resolve(command.run(ctx)).catch(() => ctx.toast("Could not complete the command"));
  return true;
}
