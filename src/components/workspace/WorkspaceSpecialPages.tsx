"use client";

// Trash, Shared and Starred pages and the multi-select toolbar.
// Extracted from the PostWorkspaceShell monolith.

import {
  useCallback,
  useState,
} from "react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import { SharedWithMe } from "@/components/workspace/SharedWithMe";
import {
  WorkspacePostOption,
} from "@/components/workspace/WorkspacePostOption";
import type {
  Blog,
  Folder,
} from "@/lib/content";
import {
  folderPathForPoolPost,
  starredPoolPosts,
} from "@/lib/pool/selectors";
import {
  moveFolderToTrash,
  movePostToTrash,
  removeTrashedFolder,
  removeTrashedPost,
  refreshWorkspacePool,
  restoreFolderFromTrash,
  restorePostFromTrash,
} from "@/lib/pool/store";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import {
  blogPostPath,
  blogWorkspacePostPath,
} from "@/lib/public-paths";
import { shortcutLabelForCommand } from "@/lib/commands/workspace";
import {
  workspaceActionErrorMessage,
} from "@/lib/workspace/local-view";
import { projectTrashView } from "@/lib/trash-view";
import { homeFolderModeForPostType } from "@/lib/workspace-item-presentation";



export type TrashApiOperation =
  | "empty"
  | "trash-posts"
  | "restore-post"
  | "restore-folder"
  | "delete-post"
  | "delete-folder";

export async function runTrashOperation(
  operation: TrashApiOperation,
  handle: string,
  target?: string | readonly string[],
): Promise<void> {
  const targets = Array.isArray(target)
    ? { targetIds: target }
    : { targetId: target };
  const response = await fetch("/api/workspace/trash", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, handle, ...targets }),
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  throw new Error(payload?.error || "Trash operation failed");
}


export type TrashDeleteTarget =
  | { kind: "post"; id: string; label: string }
  | { kind: "folder"; id: string; label: string };

export function TrashPage({
  handle,
  pool,
  selectedPostId,
  onSelectPost,
}: {
  handle: string;
  pool: WorkspacePoolPayload;
  selectedPostId: string | null;
  onSelectPost: (postId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrashDeleteTarget | null>(
    null,
  );
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trashedFolders = pool.trashedFolders ?? [];
  const trashedPosts = pool.trashedPosts ?? [];
  const { rootFolders: rootTrashedFolders, visiblePosts: visibleTrashedPosts } =
    projectTrashView(trashedFolders, trashedPosts);

  const restoreItem = useCallback(
    (postId: string) => {
      if (busyId) return;
      setBusyId(postId);
      setError(null);
      restorePostFromTrash(postId);
      void runTrashOperation("restore-post", handle, postId)
        .catch((restoreError) => {
          movePostToTrash(postId);
          setError(
            workspaceActionErrorMessage(restoreError, "Could not restore item"),
          );
        })
        .finally(() => setBusyId(null));
    },
    [busyId, handle],
  );

  const restoreFolderItem = useCallback(
    (folderId: string) => {
      if (busyId) return;
      setBusyId(folderId);
      setError(null);
      restoreFolderFromTrash(folderId);
      void runTrashOperation("restore-folder", handle, folderId)
        .catch((restoreError) => {
          moveFolderToTrash(folderId);
          setError(
            workspaceActionErrorMessage(
              restoreError,
              "Could not restore folder",
            ),
          );
        })
        .finally(() => setBusyId(null));
    },
    [busyId, handle],
  );

  const permanentlyDelete = useCallback(() => {
    if (!deleteTarget || busyId) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    setError(null);
    if (target.kind === "post") removeTrashedPost(target.id);
    else removeTrashedFolder(target.id);
    const request = runTrashOperation(
      target.kind === "post" ? "delete-post" : "delete-folder",
      handle,
      target.id,
    );
    void request
      .catch((deleteError) => {
        setError(
          workspaceActionErrorMessage(
            deleteError,
            "Could not delete permanently",
          ),
        );
        void refreshWorkspacePool(handle, pool.blogId);
      })
      .finally(() => setBusyId(null));
  }, [busyId, deleteTarget, handle, pool.blogId]);

  const trashedCount = trashedPosts.length + trashedFolders.length;

  const emptyAll = useCallback(() => {
    if (busyId) return;
    setEmptyTrashOpen(false);
    setBusyId("empty-trash");
    setError(null);
    void runTrashOperation("empty", handle)
      .catch((emptyError) => {
        setError(
          workspaceActionErrorMessage(emptyError, "Could not empty Trash"),
        );
      })
      .finally(() => {
        void refreshWorkspacePool(handle, pool.blogId);
        setBusyId(null);
      });
  }, [busyId, handle, pool.blogId]);

  return (
    <main className="workspace-collection-page workspace-trash-page">
      <header className="workspace-collection-header">
        <h1>Trash</h1>
        {trashedCount > 0 && (
          <button
            type="button"
            className="ac-btn ac-btn-gray is-danger"
            disabled={busyId === "empty-trash"}
            onClick={() => setEmptyTrashOpen(true)}
          >
            Empty Trash
          </button>
        )}
      </header>
      {error && (
        <p className="post-folder-error" role="alert">
          {error}
        </p>
      )}
      {rootTrashedFolders.length === 0 && visibleTrashedPosts.length === 0 ? (
        <p className="workspace-collection-empty">Trash is empty.</p>
      ) : (
        <div className="workspace-trash-list">
          {rootTrashedFolders.map((folder) => (
            <article className="workspace-trash-row is-folder" key={folder.id}>
              <div>
                <strong>{folder.name}</strong>
                <span>Folder</span>
              </div>
              <div className="workspace-trash-actions">
                <button
                  type="button"
                  className="ac-btn ac-btn-gray"
                  disabled={busyId === folder.id}
                  onClick={() => restoreFolderItem(folder.id)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="ac-btn ac-btn-gray is-danger"
                  disabled={busyId === folder.id}
                  onClick={() =>
                    setDeleteTarget({
                      kind: "folder",
                      id: folder.id,
                      label: folder.name,
                    })
                  }
                >
                  Delete permanently
                </button>
              </div>
            </article>
          ))}
          {visibleTrashedPosts.map((post) => {
            const selected = post.id === selectedPostId;
            return (
              <article
                key={post.id}
                className={`workspace-trash-row${selected ? " is-command-selected" : ""}`}
                data-workspace-post-id={post.id}
                tabIndex={selected ? 0 : -1}
                onFocus={() => onSelectPost(post.id)}
              >
                <div>
                  <strong>{post.title.trim() || "Untitled"}</strong>
                  <span>{post.type}</span>
                </div>
                <div className="workspace-trash-actions">
                  <button
                    type="button"
                    className="ac-btn ac-btn-gray"
                    disabled={busyId === post.id}
                    onClick={() => restoreItem(post.id)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="ac-btn ac-btn-gray is-danger"
                    disabled={busyId === post.id}
                    onClick={() =>
                      setDeleteTarget({
                        kind: "post",
                        id: post.id,
                        label: post.title.trim() || "Untitled",
                      })
                    }
                  >
                    Delete permanently
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.label ?? "item"} permanently?`}
        message="This cannot be undone."
        confirmLabel="Delete permanently"
        confirmingLabel="Deleting"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={permanentlyDelete}
      />
      <ConfirmationDialog
        open={emptyTrashOpen}
        title="Empty Trash?"
        message={`This permanently deletes ${trashedCount === 1 ? "1 item" : `${trashedCount} items`}. This cannot be undone.`}
        confirmLabel="Empty Trash"
        confirmingLabel="Emptying"
        onCancel={() => setEmptyTrashOpen(false)}
        onConfirm={emptyAll}
      />
    </main>
  );
}

export function SharedPage({ pool }: { pool: WorkspacePoolPayload }) {
  const entries = pool.sharedEntries ?? [];
  return (
    <main className="workspace-collection-page">
      <header className="workspace-collection-header">
        <h1>Shared with me</h1>
      </header>
      {entries.length > 0 ? (
        <SharedWithMe entries={entries} />
      ) : (
        <p className="workspace-collection-empty">
          Nothing has been shared with you yet.
        </p>
      )}
    </main>
  );
}

export function StarredPage({
  owner,
  pool,
}: {
  owner: boolean;
  pool: WorkspacePoolPayload;
}) {
  const posts = starredPoolPosts(pool);
  return (
    <main className="workspace-collection-page workspace-starred-page">
      <header className="workspace-collection-header">
        <h1>Starred</h1>
      </header>
      {posts.length === 0 ? (
        <p className="workspace-collection-empty">
          Star an item to keep it here.
        </p>
      ) : (
        <div
          className="workspace-recent-list"
          role="listbox"
          aria-label="Starred items"
        >
          {posts.map((post) => (
            <WorkspacePostOption
              key={post.id}
              blog={pool.blog}
              folderPath={folderPathForPoolPost(pool, post)}
              handle={pool.blog.handle}
              post={post}
              showUpdatedAt
              owner={owner}
            />
          ))}
        </div>
      )}
    </main>
  );
}

export function WorkspaceSelectionToolbar({
  blog,
  folders,
  onDelete,
  onMove,
  onToggleStar,
  posts,
}: {
  blog: Blog;
  folders: Folder[];
  onDelete: () => Promise<void> | void;
  onMove: (folderPath: string) => Promise<void> | void;
  onToggleStar: () => void;
  posts: WorkspacePoolPost[];
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (posts.length < 2) return null;
  const commonMode = posts.every(
    (post) =>
      homeFolderModeForPostType(post.type) ===
      homeFolderModeForPostType(posts[0]!.type),
  )
    ? homeFolderModeForPostType(posts[0]!.type)
    : null;
  const moveFolders = commonMode
    ? folders.filter((folder) => folder.mode === commonMode)
    : [];
  const allStarred = posts.every((post) => Boolean(post.starred));

  const share = () => {
    const folderPathById = new Map(
      folders.map((folder) => [folder.id, folder.path]),
    );
    const urls = posts.map((post) => {
      const folderPath = post.folderId
        ? folderPathById.get(post.folderId)
        : undefined;
      const path = folderPath
        ? blogWorkspacePostPath(blog, folderPath, post)
        : blogPostPath(blog, post);
      return new URL(path, window.location.origin).toString();
    });
    void navigator.clipboard.writeText(urls.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  const confirmDelete = () => {
    if (busy) return;
    setDeleteOpen(false);
    setBusy(true);
    void Promise.resolve(onDelete())
      .catch((error) =>
        console.warn("workspace selection delete failed", error),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="workspace-selection-toolbar ac-chrome"
      role="toolbar"
      aria-label="Selection actions"
    >
      <strong>{posts.length} selected</strong>
      <ShortcutTooltip label="Move" keys={shortcutLabelForCommand("post.move")}>
        <select
          aria-label="Move to folder"
          defaultValue=""
          disabled={busy || moveFolders.length === 0}
          onChange={(event) => {
            const path = event.currentTarget.value;
            if (!path) return;
            setBusy(true);
            void Promise.resolve(onMove(path)).finally(() => setBusy(false));
            event.currentTarget.value = "";
          }}
        >
          <option value="">Move to folder</option>
          {moveFolders.map((folder) => (
            <option key={folder.id} value={folder.path}>
              {folder.name}
            </option>
          ))}
        </select>
      </ShortcutTooltip>
      <ShortcutTooltip label="Share">
        <button type="button" disabled={busy} onClick={share}>
          {copied ? "Links copied" : "Share"}
        </button>
      </ShortcutTooltip>
      <ShortcutTooltip
        label={allStarred ? "Unstar" : "Star"}
        keys={shortcutLabelForCommand("post.star")}
      >
        <button type="button" disabled={busy} onClick={onToggleStar}>
          {allStarred ? "Unstar" : "Star"}
        </button>
      </ShortcutTooltip>
      <ShortcutTooltip
        label="Move to Trash"
        keys={shortcutLabelForCommand("post.delete")}
      >
        <button
          type="button"
          className="is-danger"
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
        >
          Move to Trash
        </button>
      </ShortcutTooltip>
      <ConfirmationDialog
        open={deleteOpen}
        title={`Move ${posts.length} items to Trash?`}
        message="You can restore them later from Trash."
        confirmLabel="Move to Trash"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}


