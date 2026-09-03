"use client";

// The workspace command bus: row-level actions as module calls, not props.
//
// Every list row used to receive open/select/click/tag/delete as callbacks
// threaded through three component layers; each layer re-declared them, and
// every identity wobble re-rendered every row. The shell registers its
// handlers here once, rows call the bus at event time, and the prop web
// disappears. Handlers read live state (selection store, view refs) when
// invoked, so registration identity does not matter to correctness.
//
// One workspace shell is mounted at a time; the registration is module
// state on purpose, like the selection store beside it.

import type { MouseEvent as ReactMouseEvent } from "react";
import type { Post } from "@/lib/content";

export type WorkspaceRowCommands = {
  /** Click semantics (shift-range, toggle); returns whether to open. */
  itemClick: (postId: string, event: ReactMouseEvent<HTMLElement>) => boolean;
  openPost: (postId: string, mode?: "read" | "edit") => void;
  selectPost: (postId: string) => void;
  openTag: (tag: string) => void;
  requestDeletePost?: (post: Post) => void | Promise<void>;
};

let current: WorkspaceRowCommands | null = null;

export function registerWorkspaceRowCommands(
  commands: WorkspaceRowCommands,
): () => void {
  current = commands;
  return () => {
    if (current === commands) current = null;
  };
}

export function workspaceRowCommands(): WorkspaceRowCommands | null {
  return current;
}
