"use client";

import { useEffect, useState } from "react";
import {
  hintPhrase,
  keyHintsFor,
  metaKeyHintsFor,
  type KeyHint,
} from "@/lib/commands/hints";
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
  const [metaHeld, setMetaHeld] = useState(false);

  // Holding Cmd asks "what does this modifier do here", and the bar answers.
  //
  // The layer must never stick. The app is often brought forward with Cmd
  // held (Cmd-Tab, a Cmd-click on the Dock), so the webview sees the keydown
  // and never the keyup; a bar that then opened on the Cmd layer read as the
  // wrong default. So: any event that carries metaKey=false clears it, so do
  // blur and hiding, and a held layer expires on its own.
  useEffect(() => {
    let timer: number | null = null;
    const set = (held: boolean) => {
      setMetaHeld(held);
      if (timer !== null) window.clearTimeout(timer);
      timer = held ? window.setTimeout(() => setMetaHeld(false), 4000) : null;
    };
    const fromKey = (event: KeyboardEvent) => set(event.metaKey);
    const fromPointer = (event: MouseEvent) => {
      if (!event.metaKey) set(false);
    };
    const clear = () => set(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") set(false);
    };
    window.addEventListener("keydown", fromKey);
    window.addEventListener("keyup", fromKey);
    window.addEventListener("pointerdown", fromPointer);
    window.addEventListener("pointermove", fromPointer);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("keydown", fromKey);
      window.removeEventListener("keyup", fromKey);
      window.removeEventListener("pointerdown", fromPointer);
      window.removeEventListener("pointermove", fromPointer);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const read = () => {
      try {
        const ctx = commandContext();
        setHints(metaHeld ? metaKeyHintsFor(ctx) : keyHintsFor(ctx));
      } catch {
        setHints([]);
      }
    };
    read();
    // A frame later as well: the surface a hint depends on can register just
    // after the view changes.
    const frame = window.requestAnimationFrame(read);
    return () => window.cancelAnimationFrame(frame);
  }, [commandContext, metaHeld, revision]);

  if (hints.length === 0) return null;

  return (
    <div
      className={`workspace-key-hints${metaHeld ? " is-modifier-layer" : ""}`}
      aria-hidden="true"
    >
      {/* One sentence rather than a legend: the lead-in is said once, and
          each hint after the first continues it. */}
      <span className="workspace-key-hint-lead">
        {metaHeld ? "Hold Command and hit" : "Hit"}
      </span>
      {hints.map((hint) => (
        <span key={hint.id} className="workspace-key-hint">
          <kbd className="workspace-key-hint-keys">{hint.keys}</kbd>
          <span className="workspace-key-hint-label">
            to {hintPhrase(hint.label)}
          </span>
        </span>
      ))}
    </div>
  );
}
