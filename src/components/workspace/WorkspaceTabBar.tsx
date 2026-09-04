"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspacePoolPost } from "@/lib/pool/types";

/**
 * The open documents. Selecting one navigates the workspace to it, so the
 * document on screen is always the real editable view - a tab is a shortcut
 * back to a document, not a lesser copy of it.
 *
 * A preview tab is drawn in italics and is the one a plain open replaces, as
 * in Sublime; double-clicking it makes it permanent.
 */
export function WorkspaceTabBar({
  activePostId,
  posts,
  previewPostId,
  onClose,
  onMove,
  onPromote,
  onSelect,
}: {
  activePostId: string | null;
  posts: readonly WorkspacePoolPost[];
  previewPostId: string | null;
  onClose: (postId: string) => void;
  onMove: (from: number, to: number) => void;
  onPromote: (postId: string) => void;
  onSelect: (postId: string) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  // The id lives in a REF, not only in state: drop can fire before a state
  // update has flushed (a fast drag, or events dispatched back to back), and
  // then the drop reads null and does nothing. State is for the styling only.
  const draggingRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    // Keep the open document's tab in view when the strip has scrolled.
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePostId]);

  if (posts.length === 0) return null;

  return (
    <div className="workspace-tab-bar" role="tablist" aria-label="Open items">
      {posts.map((post, index) => {
        const active = post.id === activePostId;
        const title = post.title?.trim() || "Untitled";
        return (
          <div
            key={post.id}
            ref={active ? activeRef : undefined}
            className={`workspace-tab${active ? " is-active" : ""}${
              post.id === previewPostId ? " is-preview" : ""
            }${dragging === post.id ? " is-dragging" : ""}${
              dropIndex === index && dragging && dragging !== post.id
                ? " is-drop-target"
                : ""
            }`}
            draggable
            onDragStart={(event) => {
              draggingRef.current = post.id;
              setDragging(post.id);
              event.dataTransfer.effectAllowed = "move";
              // Firefox refuses to start a drag without payload.
              event.dataTransfer.setData("text/plain", post.id);
            }}
            onDragOver={(event) => {
              if (!draggingRef.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropIndex(index);
            }}
            onDrop={(event) => {
              const moving = draggingRef.current;
              if (!moving) return;
              event.preventDefault();
              const from = posts.findIndex((entry) => entry.id === moving);
              if (from >= 0 && from !== index) onMove(from, index);
              draggingRef.current = null;
              setDragging(null);
              setDropIndex(null);
            }}
            onDragEnd={() => {
              draggingRef.current = null;
              setDragging(null);
              setDropIndex(null);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="workspace-tab-select"
              onClick={() => onSelect(post.id)}
              onDoubleClick={() => onPromote(post.id)}
              // Middle click closes, as in every editor and browser.
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(post.id);
              }}
              title={title}
            >
              {title}
            </button>
            <button
              type="button"
              className="workspace-tab-close"
              aria-label={`Close ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(post.id);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
