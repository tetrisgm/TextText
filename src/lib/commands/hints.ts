// The keys worth knowing right now, the way Superhuman and Raycast show them.
//
// The hints are DERIVED from the command table rather than written out beside
// it: each one names a command id, and the label and keys come from the
// command itself, filtered by the same `when` that decides whether pressing
// the key would do anything. A hint can therefore never advertise a shortcut
// that is not available, and renaming a command renames its hint.

import type { CommandContext } from "@/lib/commands/types";
import { WORKSPACE_COMMANDS } from "@/lib/commands/workspace";

export type KeyHint = { id: string; label: string; keys: string };

/** Ordered by how often a person reaches for it, most first. */
const LIST_HINTS = [
  "selection.open",
  "workspace.open-in-new-tab",
  "selection.select-all",
  "post.delete",
  "create.current",
  "command.palette",
] as const;

const DOCUMENT_HINTS = [
  "document.undo",
  "document.outline",
  "document.replace",
  "workspace.close-tab",
  "post.edit",
  "navigation.up",
] as const;

function shortcutText(command: (typeof WORKSPACE_COMMANDS)[number]): string {
  const shortcut = command.shortcut;
  if (!shortcut) return "";
  return Array.isArray(shortcut) ? (shortcut[0]?.label ?? "") : shortcut.label;
}

export function keyHintsFor(ctx: CommandContext, limit = 5): KeyHint[] {
  const workspace = ctx.workspace;
  if (!workspace) return [];
  const inDocument =
    workspace.viewLevel === "post" || workspace.viewLevel === "edit";
  const wanted = inDocument ? DOCUMENT_HINTS : LIST_HINTS;
  const hints: KeyHint[] = [];
  for (const id of wanted) {
    const command = WORKSPACE_COMMANDS.find(
      (candidate) => candidate.id === id,
    );
    if (!command) continue;
    // The same test the keyboard uses: never advertise a dead key.
    let available = false;
    try {
      available = command.when(ctx);
    } catch {
      available = false;
    }
    if (!available) continue;
    const keys = shortcutText(command);
    if (!keys) continue;
    hints.push({ id: command.id, label: command.label, keys });
    if (hints.length >= limit) break;
  }
  return hints;
}
