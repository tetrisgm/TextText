"use client";

import { useEffect, useRef } from "react";
import type { WorkspacePoolPost } from "@/lib/pool/types";

/**
 * The open documents. Selecting one navigates the workspace to it, so the
 * document on screen is always the real editable view - a tab is a shortcut
 * back to a document, not a lesser copy of it.
 */
export function WorkspaceTabBar({
  activePostId,
  posts,
  onClose,
  onSelect,
}: {
  activePostId: string | null;
  posts: readonly WorkspacePoolPost[];
  onClose: (postId: string) => void;
  onSelect: (postId: string) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep the open document's tab in view when the strip has scrolled.
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePostId]);

  if (posts.length === 0) return null;

  return (
    <div className="workspace-tab-bar" role="tablist" aria-label="Open items">
      {posts.map((post) => {
        const active = post.id === activePostId;
        return (
          <div
            key={post.id}
            ref={active ? activeRef : undefined}
            className={`workspace-tab${active ? " is-active" : ""}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="workspace-tab-select"
              onClick={() => onSelect(post.id)}
              // Middle click closes, as in every editor and browser.
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(post.id);
              }}
              title={post.title?.trim() || "Untitled"}
            >
              {post.title?.trim() || "Untitled"}
            </button>
            <button
              type="button"
              className="workspace-tab-close"
              aria-label={`Close ${post.title?.trim() || "Untitled"}`}
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
