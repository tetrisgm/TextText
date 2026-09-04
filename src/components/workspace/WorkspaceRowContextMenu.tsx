"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import type { Folder } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";

export type RowContextMenuTarget = {
  x: number;
  y: number;
  /** The row that was right-clicked. */
  postId: string;
};

/**
 * The menu a right click opens on an item.
 *
 * It acts on the SELECTION, not only the row under the pointer: right
 * clicking one of several selected items and choosing Trash should trash all
 * of them, which is what every file list does. The shell makes sure the
 * clicked row is part of the selection before opening this.
 */
export function WorkspaceRowContextMenu({
  folders,
  moveTargets,
  onClose,
  onDelete,
  onMove,
  onOpen,
  onOpenInNewTab,
  onToggleStar,
  posts,
  target,
}: {
  folders: readonly Folder[];
  /** Folder paths this selection can actually move to. */
  moveTargets: readonly string[];
  onClose: () => void;
  onDelete: () => void;
  onMove: (folderPath: string) => void;
  onOpen: (postId: string) => void;
  onOpenInNewTab: (postId: string) => void;
  onToggleStar: () => void;
  posts: readonly WorkspacePoolPost[];
  target: RowContextMenuTarget;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });

  useLayoutEffect(() => {
    // Keep the whole menu on screen: near the bottom or the right edge it
    // has to open the other way, as every native menu does.
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      target.x,
      Math.max(margin, window.innerWidth - rect.width - margin),
    );
    const top = Math.min(
      target.y,
      Math.max(margin, window.innerHeight - rect.height - margin),
    );
    setPosition({ left, top });
  }, [target]);

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    // Capture, so a click anywhere closes before it does anything else.
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("contextmenu", dismiss, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("contextmenu", dismiss, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Escape goes through the app's escape stack rather than a listener of our
  // own, so it closes this before anything underneath it.
  useEscapeLayer(true, "Item menu", onClose);

  const many = posts.length > 1;
  const allStarred = posts.length > 0 && posts.every((post) => post.starred);
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div
      ref={ref}
      className="workspace-row-context-menu"
      role="menu"
      aria-label={many ? `${posts.length} items` : "Item actions"}
      data-post-edit-menu-open="true"
      style={{ left: position.left, top: position.top }}
    >
      {!many && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => onOpen(target.postId))}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => onOpenInNewTab(target.postId))}
          >
            Open in new tab
          </button>
          <hr />
        </>
      )}
      <button type="button" role="menuitem" onClick={run(onToggleStar)}>
        {allStarred ? "Unstar" : "Star"}
        {many ? ` ${posts.length} items` : ""}
      </button>
      {moveTargets.length > 0 && (
        <>
          <hr />
          <span className="workspace-row-context-heading">Move to</span>
          {moveTargets.map((path) => {
            const folder = folders.find((entry) => entry.path === path);
            return (
              <button
                key={path}
                type="button"
                role="menuitem"
                onClick={run(() => onMove(path))}
              >
                {folder?.name?.trim() || path}
              </button>
            );
          })}
        </>
      )}
      <hr />
      <button
        type="button"
        role="menuitem"
        className="workspace-row-context-danger"
        onClick={run(onDelete)}
      >
        Move to Trash{many ? ` (${posts.length})` : ""}
      </button>
    </div>
  );
}
