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

/**
 * The label as it reads inside a sentence.
 *
 * The bar says "Hit Enter to open focused item" rather than listing "Enter -
 * Open focused item", which is the difference between a legend and a person
 * telling you what to do. Only an ordinary sentence-case word is lowered:
 * a label that opens with an acronym or a product name ("AI settings",
 * "TextText help") keeps its capital, because lowering it would be wrong
 * rather than merely informal.
 */
export function hintPhrase(label: string): string {
  const [first = ""] = label.split(" ");
  const ordinary =
    first.length > 1 && first[0] === first[0].toUpperCase() &&
    first.slice(1) === first.slice(1).toLowerCase();
  return ordinary ? label[0].toLowerCase() + label.slice(1) : label;
}

/**
 * A control's teaching text, taken from the command it runs.
 *
 * Tooltips used to carry a hand-written label and a hand-written key string
 * beside every button, which is two more places for a rebind to be forgotten.
 * Naming the command instead means the tooltip, the hint bar and the shortcut
 * sheet all read the same row, and a renamed or rebound command updates all
 * three at once. Returns null for an id no command claims, so a stale id
 * shows nothing rather than a lie.
 */
export function commandTip(
  id: string,
): { label: string; keys: string } | null {
  const command = WORKSPACE_COMMANDS.find((entry) => entry.id === id);
  if (!command) return null;
  return { label: command.label, keys: shortcutText(command) };
}

/** Ordered by how often a person reaches for it, most first. */
const LIST_HINTS = [
  "selection.open",
  "workspace.open-in-new-tab",
  // "/" is this app's answer to type-ahead. Bare-letter type-ahead cannot
  // work here: single letters are commands (c, s, e, m, g, j, k), and a
  // scheme where SOME letters jump to an item and others act on it would be
  // worse than none. Filtering as you type is better than Finder's jump
  // anyway; it only needed to be discoverable.
  "workspace.search",
  "selection.select-all",
  "post.duplicate",
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

function shortcutText(
  command: (typeof WORKSPACE_COMMANDS)[number],
  prefer: "first" | "meta" = "first",
): string {
  const shortcut = command.shortcut;
  if (!shortcut) return "";
  const list = Array.isArray(shortcut) ? shortcut : [shortcut];
  if (prefer === "meta") {
    // While Cmd is held, show the Cmd spelling of a command that has one:
    // "Home" is the wrong answer to "what does Cmd do".
    const withMeta = list.find((entry) => entry.meta);
    if (withMeta) return withMeta.label;
  }
  return list[0]?.label ?? "";
}

/** Which layer the bar is showing: what is pressable now, or what Cmd adds. */
export type HintLayer = "base" | "meta";

function usesMeta(command: (typeof WORKSPACE_COMMANDS)[number]): boolean {
  const shortcut = command.shortcut;
  if (!shortcut) return false;
  const list = Array.isArray(shortcut) ? shortcut : [shortcut];
  return list.some((entry) => entry.meta);
}

/**
 * Everything Cmd does here, for while the key is held - the Superhuman
 * trick: the bar answers "what does this modifier do" at the moment you ask.
 */
export function metaKeyHintsFor(ctx: CommandContext, limit = 7): KeyHint[] {
  const workspace = ctx.workspace;
  if (!workspace) return [];
  const hints: KeyHint[] = [];
  for (const command of WORKSPACE_COMMANDS) {
    if (!usesMeta(command)) continue;
    let available = false;
    try {
      available = command.when(ctx);
    } catch {
      available = false;
    }
    if (!available) continue;
    const keys = shortcutText(command, "meta");
    if (!keys) continue;
    hints.push({ id: command.id, label: command.label, keys });
    if (hints.length >= limit) break;
  }
  return hints;
}

export function keyHintsFor(ctx: CommandContext, limit = 4): KeyHint[] {
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
