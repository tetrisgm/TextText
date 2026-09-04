"use client";

import { useEffect, useState } from "react";
import { keyHintsFor, type KeyHint } from "@/lib/commands/hints";
import type { CommandContext } from "@/lib/commands/types";

/**
 * The keys worth knowing right now, along the bottom of the workspace.
 *
 * Every hint is derived from the command table and filtered by the same
 * `when` the keyboard uses, so the bar can never offer a key that would do
 * nothing. It re-reads on the events that change what is possible rather than
 * on a timer: a selection, a navigation, a keystroke.
 */
export function WorkspaceKeyHints({
  commandContext,
  revision,
}: {
  commandContext: () => CommandContext;
  /** Changes whenever the view, selection or tabs change. */
  revision: string;
}) {
  const [hints, setHints] = useState<KeyHint[]>([]);

  useEffect(() => {
    const read = () => {
      try {
        setHints(keyHintsFor(commandContext()));
      } catch {
        setHints([]);
      }
    };
    read();
    // A frame later as well: the surface a hint depends on can register just
    // after the view changes.
    const frame = window.requestAnimationFrame(read);
    return () => window.cancelAnimationFrame(frame);
  }, [commandContext, revision]);

  if (hints.length === 0) return null;

  return (
    <div className="workspace-key-hints" aria-hidden="true">
      {hints.map((hint) => (
        <span key={hint.id} className="workspace-key-hint">
          <kbd className="workspace-key-hint-keys">{hint.keys}</kbd>
          <span className="workspace-key-hint-label">{hint.label}</span>
        </span>
      ))}
    </div>
  );
}
