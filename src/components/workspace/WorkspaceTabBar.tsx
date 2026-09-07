"use client";

import { MotionTab, useRetainedTabs, useTabLayout } from "@/lib/motion/tabs";

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
  const retained = useRetainedTabs(posts);
  const barRef = useRef<HTMLDivElement>(null);
  useTabLayout(barRef, retained.entries);
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

  // Keyboard navigation and focus-after-close must see only the tabs that are
  // really there. A tab that is springing out stays in the DOM until it rests,
  // and it is inert, so focusing it would silently drop focus to the body.
  const presentTabs = () =>
    barRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-motion-tab]:not([inert]) [role="tab"]',
    );

  const close = (postId: string) => {
    const index = posts.findIndex(post => post.id === postId);
    const next = posts[index + 1] ?? posts[index - 1];
    const buttons = presentTabs();
    if (next) buttons?.[index + 1 < posts.length ? index + 1 : index - 1]?.focus();
    else {
      const target = document.querySelector<HTMLElement>('.post-editor-content, main, [role="main"]');
      if (target) {
        if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.tabIndex = -1;
        target.focus();
      }
    }
    onClose(postId);
  };

  if (retained.entries.length === 0) return null;

  return (
    <div ref={barRef} className="workspace-tab-bar" role="tablist" aria-label="Open items">
      <span id="workspace-tabs-help" className="ac-sr-only">Use arrow keys to switch items. Press Delete to close, F2 to keep a preview, or Alt with an arrow to reorder.</span>
      {retained.entries.map(({ item: post, present }) => {
        const index = posts.findIndex((item) => item.id === post.id);
        // A tab on its way out has no index in posts. It stays mounted so its
        // exit spring can run and report back, and until it does it takes no
        // part in selection, keyboard or reorder arithmetic.
        const active = present && post.id === activePostId;
        const title = post.title?.trim() || "Untitled";
        return (
          <MotionTab
            key={post.id}
            shown={present}
            selected={active}
            onExited={() => retained.remove(post.id)}
            activeRef={active ? activeRef : undefined}
            className={`workspace-tab${active ? " is-active" : ""}${
              post.id === previewPostId ? " is-preview" : ""
            }${dragging === post.id ? " is-dragging" : ""}${
              dropIndex === index && dragging && dragging !== post.id
                ? " is-drop-target"
                : ""
            }`}
            draggable={present}
            onDragStart={(event) => {
              if (!present || index < 0) return;
              draggingRef.current = post.id;
              setDragging(post.id);
              event.dataTransfer.effectAllowed = "move";
              // Firefox refuses to start a drag without payload.
              event.dataTransfer.setData("text/plain", post.id);
            }}
            onDragOver={(event) => {
              if (!present || index < 0) return;
              if (!draggingRef.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropIndex(index);
            }}
            onDrop={(event) => {
              if (!present || index < 0) return;
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
              id={`workspace-tab-${post.id}`}
              aria-controls={active ? "workspace-item-panel" : undefined}
              aria-selected={active}
              tabIndex={active || (!posts.some(entry => entry.id === activePostId) && index === 0) ? 0 : -1}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (event.key === "Delete") { event.preventDefault(); close(post.id); return; }
                if (event.key === "F2") { event.preventDefault(); onPromote(post.id); return; }
                if (!delta && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? posts.length - 1 : (index + delta + posts.length) % posts.length;
                if (event.altKey && delta) { onMove(index, next); return; }
                onSelect(posts[next].id);
                presentTabs()?.[next]?.focus();
              }}
              className="workspace-tab-select"
              onClick={() => onSelect(post.id)}
              onDoubleClick={() => onPromote(post.id)}
              // Middle click closes, as in every editor and browser.
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                close(post.id);
              }}
              title={title}
              aria-describedby="workspace-tabs-help"
            >
              {title}
              {post.id === previewPostId && <span className="workspace-tab-preview-label"> (Preview)</span>}
            </button>
            <button
              type="button"
              className="workspace-tab-close"
              tabIndex={active ? 0 : -1}
              aria-label={`Close ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                close(post.id);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </MotionTab>
        );
      })}
    </div>
  );
}
