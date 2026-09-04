"use client";

// One workspace list row, extracted from the shell monolith.
//
// The row subscribes to its own slice of the selection store instead of
// receiving selected/active as props: a selection keystroke re-renders the
// two rows whose bits changed and nothing else, whatever the parents do.
// memo() then guards against parent re-renders for everything but a real
// prop change (rows are the widest fan-out in the workspace).

import { memo } from "react";
import { TagChips } from "@/components/TagChips";
import {
  WorkspaceItemActions,
  WorkspaceItemStar,
} from "@/components/workspace/WorkspaceItemActions";
import {
  WorkspaceItemThumbnail,
  thumbnailIsIcon,
} from "@/components/workspace/WorkspaceItemThumbnail";
import {
  resetSpatialCardTilt,
  updateSpatialCardTilt,
} from "@/components/workspace/spatial-card";
import { prefetchPostDocument } from "@/lib/pool/store";
import { postFromPoolPost } from "@/lib/pool/selectors";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { blogWorkspacePostPath } from "@/lib/public-paths";
import { sidebarDocumentTitle } from "@/lib/workspace-activity";
import { shouldSuppressNativeItemSelection } from "@/lib/workspace-selection";
import { useWorkspacePostSelection } from "@/lib/workspace/selection-store";
import { workspaceRowCommands } from "@/lib/workspace/command-bus";
import { plainTextExcerpt } from "@/lib/content";
import {
  changedRecently,
  chipForPost,
  type ChipCensus,
} from "@/lib/workspace/item-labels";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { Blog } from "@/lib/content";

export function workspacePostOptionDomId(postId: string): string {
  return `workspace-root-post-${domSafeId(postId)}`;
}

export function domSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export function itemPreview(post: {
  excerpt?: string;
  bodyPreview?: string;
}): string {
  return plainTextExcerpt(post.excerpt) || plainTextExcerpt(post.bodyPreview);
}

export const WorkspacePostOption = memo(function WorkspacePostOption({
  blog,
  chips,
  folderPath,
  handle,
  owner,
  pool,
  post,
  showUpdatedAt = false,
}: {
  blog: Blog;
  /** What the whole visible list looks like, so a row can tell whether its
   * kind or folder is unusual enough to be worth saying. See chipForPost. */
  chips?: ChipCensus;
  folderPath: string;
  handle: string;
  owner: boolean;
  /** Only needed to name the folder a chip points at. */
  pool?: WorkspacePoolPayload;
  post: WorkspacePoolPost;
  showUpdatedAt?: boolean;
}) {
  const { selected, active } = useWorkspacePostSelection(post.id);
  const chip = chips && pool ? chipForPost(post, pool, chips) : null;
  const fresh = changedRecently(post);
  // Facts the CSS used to ask for with `:has()`. A row that states them is a
  // row whose style does not depend on walking its own subtree.
  const hasTags = (post.tags?.length ?? 0) > 0;
  const iconThumb = thumbnailIsIcon(post);
  return (
    <div
      id={workspacePostOptionDomId(post.id)}
      className={`workspace-item-option${selected ? " is-command-selected" : ""}`}
      data-workspace-post-id={post.id}
      data-tags={hasTags ? "" : undefined}
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      title={showUpdatedAt ? sidebarDocumentTitle(post) : undefined}
      onFocus={() => {
        workspaceRowCommands()?.selectPost(post.id);
        prefetchPostDocument(post.id);
      }}
      onPointerEnter={() => prefetchPostDocument(post.id)}
      onPointerMove={updateSpatialCardTilt}
      onPointerLeave={resetSpatialCardTilt}
    >
      {/* The gutter carries three marks that are about the row rather than
          about the document: whether it is selected, whether it changed in
          the last day, and whether it is starred. */}
      {/* One slot in the gutter, three states. Selected shows the tick,
          hovering shows the star (hovering is when you want to star), and a
          row that is neither but changed today shows a dot. */}
      {fresh && <span className="workspace-item-fresh" aria-hidden="true" />}
      <span
        className="workspace-item-tick"
        aria-hidden="true"
        data-selected={selected ? "true" : undefined}
      >
        <svg viewBox="0 0 14 14" focusable="false">
          <path
            d="M3 7.4l2.8 2.8L11 4.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <WorkspaceItemStar
        handle={handle}
        owner={owner}
        post={postFromPoolPost(post)}
      />
      <button
        type="button"
        className="workspace-item-option-main"
        data-icon-thumb={iconThumb ? "" : undefined}
        onMouseDown={(event) => {
          if (shouldSuppressNativeItemSelection(event)) event.preventDefault();
        }}
        onClick={(event) => {
          const bus = workspaceRowCommands();
          if (!bus) return;
          if (bus.itemClick(post.id, event)) bus.openPost(post.id);
        }}
      >
        <WorkspaceItemThumbnail post={post} />
        <span className="workspace-item-option-copy">
          {chip && (
            <span className="workspace-item-chip" data-chip={chip.kind}>
              {chip.label}
            </span>
          )}
          <strong>{sidebarDocumentTitle(post)}</strong>
          {/* The icon already says what kind of item this is, so the row
              carries the title and whatever the document actually says. The
              preview is prose, not Markdown: a document that opens with a
              heading or a code fence used to put ## and ``` on the card. */}
          {itemPreview(post) && (
            <span className="workspace-item-option-detail">
              <small>{itemPreview(post)}</small>
            </span>
          )}
        </span>
        {showUpdatedAt && (
          <time>
            {post.updatedAt
              ? new Intl.DateTimeFormat(undefined, {
                  day: "numeric",
                  month: "short",
                }).format(new Date(post.updatedAt))
              : ""}
          </time>
        )}
      </button>
      <TagChips
        blog={blog}
        className="workspace-item-option-tags"
        onOpenTag={(tag) => workspaceRowCommands()?.openTag(tag)}
        tags={post.tags}
      />
      <WorkspaceItemActions
        blog={blog}
        handle={handle}
        href={blogWorkspacePostPath(blog, folderPath, post)}
        onDeletePost={(target) =>
          workspaceRowCommands()?.requestDeletePost?.(target)
        }
        owner={owner}
        post={postFromPoolPost(post)}
      />
    </div>
  );
});
