"use client";

// One workspace list row, extracted from the shell monolith.
//
// The row subscribes to its own slice of the selection store instead of
// receiving selected/active as props: a selection keystroke re-renders the
// two rows whose bits changed and nothing else, whatever the parents do.
// memo() then guards against parent re-renders for everything but a real
// prop change (rows are the widest fan-out in the workspace).

import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { TagChips } from "@/components/TagChips";
import {
  WorkspaceItemActions,
  WorkspaceItemStar,
} from "@/components/workspace/WorkspaceItemActions";
import type { FolderDeleteItem } from "@/components/FolderPage";
import { WorkspaceItemThumbnail } from "@/components/workspace/WorkspaceItemThumbnail";
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
import { plainTextExcerpt } from "@/lib/content";
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
  folderPath,
  handle,
  onDeletePost,
  onItemClick,
  onOpen,
  onOpenTag,
  onSelect,
  owner,
  post,
  showUpdatedAt = false,
}: {
  blog: Blog;
  folderPath: string;
  handle: string;
  onDeletePost?: FolderDeleteItem;
  onItemClick: (postId: string, event: ReactMouseEvent<HTMLElement>) => boolean;
  onOpen: (postId: string) => void;
  onOpenTag?: (tag: string) => void;
  onSelect: (postId: string) => void;
  owner: boolean;
  post: WorkspacePoolPost;
  showUpdatedAt?: boolean;
}) {
  const { selected, active } = useWorkspacePostSelection(post.id);
  return (
    <div
      id={workspacePostOptionDomId(post.id)}
      className={`workspace-item-option${selected ? " is-command-selected" : ""}`}
      data-workspace-post-id={post.id}
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      title={showUpdatedAt ? sidebarDocumentTitle(post) : undefined}
      onFocus={() => {
        onSelect(post.id);
        prefetchPostDocument(post.id);
      }}
      onPointerEnter={() => prefetchPostDocument(post.id)}
      onPointerMove={updateSpatialCardTilt}
      onPointerLeave={resetSpatialCardTilt}
    >
      <WorkspaceItemStar
        handle={handle}
        owner={owner}
        post={postFromPoolPost(post)}
      />
      <button
        type="button"
        className="workspace-item-option-main"
        onMouseDown={(event) => {
          if (shouldSuppressNativeItemSelection(event)) event.preventDefault();
        }}
        onClick={(event) => {
          if (onItemClick(post.id, event)) onOpen(post.id);
        }}
      >
        <WorkspaceItemThumbnail post={post} />
        <span className="workspace-item-option-copy">
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
        onOpenTag={onOpenTag}
        tags={post.tags}
      />
      <WorkspaceItemActions
        blog={blog}
        handle={handle}
        href={blogWorkspacePostPath(blog, folderPath, post)}
        onDeletePost={onDeletePost}
        owner={owner}
        post={postFromPoolPost(post)}
      />
    </div>
  );
});
