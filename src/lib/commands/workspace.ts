"use client";

import {
  createFolderItemAction,
  createWorkspacePostAction,
  deleteEditablePostAction,
  movePostToFolderAction,
  setEditablePostStatusAction,
  toggleEditablePostPinnedAction,
} from "@/app/editor/actions";
import { BLOG_FOLDER_PATH, isPrivatePostType } from "@/lib/content";
import type { Folder, Post } from "@/lib/content";
import {
  addPost,
  movePost,
  removePost,
  updatePost,
} from "@/lib/pool/store";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { blogHomePath, blogPostEditPath } from "@/lib/public-paths";
import type {
  AppCommand,
  CommandContext,
  CommandShortcut,
  CreatePostKind,
} from "@/lib/commands/types";

const DELETE_UNDO_MS = 5000;

function commandTargetPost(ctx: CommandContext): WorkspacePoolPost | null {
  const workspace = ctx.workspace;
  if (!workspace) return null;
  const postId = workspace.selectedPostId ?? workspace.activePostId;
  return postId ? workspace.getPost(postId) : null;
}

function folderForPath(ctx: CommandContext, path: string | null): Folder | null {
  if (!path || !ctx.pool) return null;
  return ctx.pool.folders.find((folder) => folder.path === path) ?? null;
}

function currentCreateKind(ctx: CommandContext): CreatePostKind {
  const folder = folderForPath(ctx, ctx.workspace?.activeFolderPath ?? null);
  if (folder?.mode === "notes") return "note";
  if (folder?.mode === "bookmarks") return "bookmark";
  return "article";
}

function optimisticPost(
  ctx: CommandContext,
  kind: CreatePostKind,
): WorkspacePoolPost | null {
  const workspace = ctx.workspace;
  const pool = ctx.pool;
  if (!workspace || !pool) return null;
  const now = new Date().toISOString();
  const folder = folderForPath(ctx, workspace.activeFolderPath);
  const slug = `untitled-${Date.now().toString(36)}`;
  return {
    id: `optimistic-${kind}-${Date.now().toString(36)}`,
    blogId: pool.blogId,
    folderId:
      folder && (kind !== "article" || folder.mode === "blog")
        ? folder.id
        : undefined,
    type: kind,
    slug,
    title: "",
    excerpt: "",
    status: "draft",
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

function poolPostFromPost(post: Post, blogId: string): WorkspacePoolPost | null {
  if (!post.id) return null;
  return {
    id: post.id,
    blogId,
    folderId: post.folderId,
    type: post.type,
    captureStatus: post.captureStatus,
    capture: post.capture,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    accent: post.accent,
    cover: post.cover,
    coverCaption: post.coverCaption,
    coverHeight: post.coverHeight,
    gallery: post.gallery,
    links: post.links,
    videoUrl: post.videoUrl,
    venue: post.venue,
    duration: post.duration,
    wordCount: post.wordCount,
    readingTime: post.readingTime,
    date: post.date,
    publishedAt: post.status === "published" ? post.date : undefined,
    status: post.status,
    pinned: post.pinned,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function createCommand(kind: CreatePostKind): AppCommand {
  const labels: Record<CreatePostKind, string> = {
    article: "New article",
    note: "New note",
    bookmark: "New bookmark",
  };

  return {
    id: `create.${kind}`,
    label: labels[kind],
    group: "Create",
    when: (ctx) => Boolean(ctx.workspace?.canCreate),
    run: async (ctx) => {
      const workspace = ctx.workspace;
      const pool = ctx.pool;
      if (!workspace || !pool || !workspace.canCreate) return;

      if (kind === "bookmark" && workspace.startBookmarkCreate) {
        workspace.startBookmarkCreate();
        return;
      }

      const temp = optimisticPost(ctx, kind);
      if (temp) {
        addPost(temp);
        workspace.selectPost(temp.id);
      }

      try {
        const activeFolder = workspace.activeFolderPath ?? BLOG_FOLDER_PATH;
        const saved =
          kind === "article"
            ? await createWorkspacePostAction(
                workspace.handle,
                "article",
                activeFolder,
              )
            : await createFolderItemAction(workspace.handle, "notes");
        if (temp) removePost(temp.id);
        const poolPost = poolPostFromPost(saved, pool.blogId);
        if (poolPost) addPost(poolPost);
        ctx.navigate(blogPostEditPath(pool.blog, saved));
      } catch (error) {
        if (temp) removePost(temp.id);
        ctx.toast(error instanceof Error ? error.message : "Could not create");
      }
    },
  };
}

function deleteSelected(ctx: CommandContext) {
  const workspace = ctx.workspace;
  const post = commandTargetPost(ctx);
  if (!workspace || !post?.id || !workspace.canManagePost) return;

  removePost(post.id);
  workspace.afterDelete(post.id);

  let undone = false;
  const timer = window.setTimeout(() => {
    if (undone) return;
    void deleteEditablePostAction(workspace.handle, post.id).catch((error) => {
      addPost(post);
      ctx.toast(error instanceof Error ? error.message : "Could not delete");
      ctx.refresh();
    });
  }, DELETE_UNDO_MS);

  ctx.toast("Deleted", {
    label: "Undo",
    run: () => {
      undone = true;
      window.clearTimeout(timer);
      addPost(post);
      workspace.selectPost(post.id);
    },
  });
}

function togglePinSelected(ctx: CommandContext) {
  const post = commandTargetPost(ctx);
  const workspace = ctx.workspace;
  if (!post?.id || !workspace?.canManagePost) return;
  updatePost(post.id, { pinned: !post.pinned });
  void toggleEditablePostPinnedAction(workspace.handle, post.id).catch((error) => {
    updatePost(post.id, { pinned: post.pinned });
    ctx.toast(error instanceof Error ? error.message : "Could not update pin");
  });
}

function togglePublishSelected(ctx: CommandContext) {
  const post = commandTargetPost(ctx);
  const workspace = ctx.workspace;
  if (!post?.id || !workspace?.canManagePost || isPrivatePostType(post.type)) {
    return;
  }
  const nextStatus = post.status === "published" ? "draft" : "published";
  updatePost(post.id, {
    status: nextStatus,
    publishedAt: nextStatus === "published" ? (post.date ?? post.publishedAt) : undefined,
  });
  void setEditablePostStatusAction(workspace.handle, post.id, nextStatus).catch(
    (error) => {
      updatePost(post.id, {
        status: post.status,
        publishedAt: post.publishedAt,
      });
      ctx.toast(error instanceof Error ? error.message : "Could not publish");
    },
  );
}

function moveSelectedTo(ctx: CommandContext, folder: Folder) {
  const post = commandTargetPost(ctx);
  const workspace = ctx.workspace;
  if (!post?.id || !workspace?.canManagePost) return;
  const previousFolderId = post.folderId;
  movePost(post.id, folder.id);
  void movePostToFolderAction(workspace.handle, post.id, folder.path).catch(
    (error) => {
      movePost(post.id, previousFolderId);
      ctx.toast(error instanceof Error ? error.message : "Could not move");
    },
  );
}

export const WORKSPACE_COMMANDS: AppCommand[] = [
  {
    id: "create.current",
    label: "Create in current folder",
    group: "Create",
    shortcut: { key: "c", label: "C" },
    when: (ctx) => Boolean(ctx.workspace?.canCreate),
    run: (ctx) => {
      const kind = currentCreateKind(ctx);
      return createCommand(kind).run(ctx);
    },
  },
  createCommand("article"),
  createCommand("note"),
  createCommand("bookmark"),
  {
    id: "selection.previous",
    label: "Previous item",
    group: "Navigate",
    shortcut: { key: "k", label: "K" },
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.selectPrevious(),
  },
  {
    id: "selection.next",
    label: "Next item",
    group: "Navigate",
    shortcut: { key: "j", label: "J" },
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.selectNext(),
  },
  {
    id: "selection.open",
    label: "Open selected",
    group: "Navigate",
    shortcut: { key: "Enter", label: "Enter" },
    when: (ctx) => {
      const workspace = ctx.workspace;
      if (!workspace) return false;
      return Boolean(workspace.selectedPostId ?? workspace.activePostId);
    },
    run: (ctx) => {
      const workspace = ctx.workspace;
      const postId = workspace?.selectedPostId ?? workspace?.activePostId;
      if (workspace && postId) workspace.openPost(postId);
    },
  },
  {
    id: "post.edit",
    label: "Edit",
    group: "Post",
    shortcut: { key: "e", label: "E" },
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canEdit),
    run: (ctx) => {
      const post = commandTargetPost(ctx);
      const pool = ctx.pool;
      if (!post || !pool) return;
      ctx.navigate(blogPostEditPath(pool.blog, post));
    },
  },
  {
    id: "post.delete",
    label: "Delete",
    group: "Post",
    shortcut: [
      { key: "x", label: "X" },
      { key: "Delete", label: "Del" },
      { key: "Backspace", label: "Del" },
    ],
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canManagePost),
    run: deleteSelected,
  },
  {
    id: "post.pin",
    label: "Pin or unpin",
    group: "Post",
    shortcut: { key: "p", label: "P" },
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canManagePost),
    run: togglePinSelected,
  },
  {
    id: "post.move",
    label: "Move",
    group: "Post",
    shortcut: { key: "m", label: "M" },
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canManagePost),
    run: (ctx) => ctx.openPalette("/move "),
  },
  {
    id: "post.publish",
    label: "Publish or unpublish",
    group: "Post",
    when: (ctx) => {
      const post = commandTargetPost(ctx);
      return Boolean(
        post &&
          !isPrivatePostType(post.type) &&
          ctx.workspace?.canManagePost,
      );
    },
    run: togglePublishSelected,
  },
  {
    id: "nav.go-to-folder",
    label: "Go to folder",
    group: "Navigate",
    when: (ctx) => Boolean(ctx.pool?.folders.length),
    run: (ctx) => ctx.openPalette("/folder "),
  },
  {
    id: "workspace.settings",
    label: "Settings",
    group: "Workspace",
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => {
      const workspace = ctx.workspace;
      if (workspace) ctx.navigate(blogHomePath(workspace.blog));
    },
  },
];

export function shortcutList(command: AppCommand): CommandShortcut[] {
  if (!command.shortcut) return [];
  return Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut];
}

export function commandShortcutLabel(command: AppCommand): string | undefined {
  const shortcuts = shortcutList(command).map((shortcut) => shortcut.label);
  return shortcuts.length > 0 ? shortcuts.join(", ") : undefined;
}

export function shortcutMatches(
  shortcut: CommandShortcut,
  event: KeyboardEvent,
): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  if (Boolean(shortcut.alt) !== event.altKey) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  if (shortcut.meta && !event.metaKey) return false;
  if (shortcut.ctrl && !event.ctrlKey) return false;
  if (!shortcut.meta && !shortcut.ctrl && (event.metaKey || event.ctrlKey)) {
    return false;
  }
  return true;
}

export function availableWorkspaceCommands(ctx: CommandContext): AppCommand[] {
  return WORKSPACE_COMMANDS.filter((command) => command.when(ctx));
}

export function dynamicWorkspaceCommands(ctx: CommandContext): AppCommand[] {
  const pool = ctx.pool;
  const workspace = ctx.workspace;
  if (!pool || !workspace) return [];
  const target = commandTargetPost(ctx);
  const blogPost = target && !isPrivatePostType(target.type);

  const folderCommands = pool.folders.map((folder) => ({
    id: `folder.open.${folder.id}`,
    label: `Go to ${folder.name}`,
    group: "Folders",
    when: () => true,
    run: () => workspace.openFolder(folder.path),
  }));

  const moveCommands =
    target && workspace.canManagePost
      ? pool.folders
          .filter((folder) =>
            blogPost
              ? folder.mode === "blog"
              : target.type === "note"
                ? folder.mode === "notes"
                : target.type === "bookmark"
                  ? folder.mode === "bookmarks"
                  : false,
          )
          .map((folder) => ({
            id: `post.move.${folder.id}`,
            label: `Move to ${folder.name}`,
            group: "Move",
            when: () => true,
            run: () => moveSelectedTo(ctx, folder),
          }))
      : [];

  return [...folderCommands, ...moveCommands];
}
