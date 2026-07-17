"use client";

import {
  createWorkspacePostAction,
  movePostToFolderAction,
  setEditablePostStatusAction,
  toggleEditablePostPinnedAction,
} from "@/app/editor/actions";
import { BLOG_FOLDER_PATH, isPrivatePostType } from "@/lib/content";
import type { Folder, Post } from "@/lib/content";
import {
  addPost,
  getWorkspacePost,
  movePost,
  removePost,
  replacePost,
  updatePost,
} from "@/lib/pool/store";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { blogPostEditPath } from "@/lib/public-paths";
import type {
  AppCommand,
  CommandContext,
  CommandShortcut,
  CreatePostKind,
} from "@/lib/commands/types";

function commandTargetPost(ctx: CommandContext): WorkspacePoolPost | null {
  const workspace = ctx.workspace;
  if (!workspace) return null;
  if (workspace.viewLevel === "root") return null;
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

function folderForCreateKind(
  ctx: CommandContext,
  kind: CreatePostKind,
): Folder | null {
  const activeFolder = folderForPath(ctx, ctx.workspace?.activeFolderPath ?? null);
  if (kind === "article") {
    return activeFolder?.mode === "blog"
      ? activeFolder
      : folderForPath(ctx, BLOG_FOLDER_PATH);
  }
  const mode = kind === "note" ? "notes" : "bookmarks";
  return activeFolder?.mode === mode
    ? activeFolder
    : (ctx.pool?.folders.find((folder) => folder.mode === mode) ?? null);
}

function optimisticPost(
  ctx: CommandContext,
  kind: CreatePostKind,
): WorkspacePoolPost | null {
  const workspace = ctx.workspace;
  const pool = ctx.pool;
  if (!workspace || !pool) return null;
  const now = new Date().toISOString();
  const folder = folderForCreateKind(ctx, kind);
  const slug = `untitled-${Date.now().toString(36)}`;
  return {
    id: `optimistic-${kind}-${Date.now().toString(36)}`,
    blogId: pool.blogId,
    folderId: folder?.id,
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

function createFolderPath(ctx: CommandContext, kind: CreatePostKind): string {
  if (kind !== "article") return kind === "note" ? "notes" : "bookmarks";
  return folderForCreateKind(ctx, kind)?.path ?? BLOG_FOLDER_PATH;
}

function mergeSavedPostWithLocalDraft(
  saved: WorkspacePoolPost,
  localDraft: WorkspacePoolPost | null,
): WorkspacePoolPost {
  if (!localDraft) return saved;
  return {
    ...saved,
    title: localDraft.title,
    excerpt: localDraft.excerpt,
    updatedAt: localDraft.updatedAt ?? saved.updatedAt,
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
    article: "Create post",
    note: "Create note",
    bookmark: "Create bookmark",
  };

  return {
    id: `create.${kind}`,
    label: labels[kind],
    group: "Create",
    showInShortcutSheet: false,
    when: (ctx) => Boolean(ctx.workspace?.canCreate),
    run: async (ctx) => {
      const workspace = ctx.workspace;
      const pool = ctx.pool;
      if (!workspace || !pool || !workspace.canCreate) return;

      if (workspace.createItem) {
        workspace.createItem(kind);
        return;
      }

      const temp = optimisticPost(ctx, kind);
      if (temp) {
        addPost(temp);
        if (workspace.openCreatedPost) {
          workspace.openCreatedPost(temp);
        } else {
          workspace.selectPost(temp.id);
        }
      }

      try {
        const activeFolder = createFolderPath(ctx, kind);
        const saved = await createWorkspacePostAction(
          workspace.handle,
          kind,
          activeFolder,
        );
        const poolPost = poolPostFromPost(saved, pool.blogId);
        if (poolPost) {
          const reconciled = mergeSavedPostWithLocalDraft(
            poolPost,
            temp ? getWorkspacePost(temp.id) : null,
          );
          if (temp) {
            replacePost(temp.id, reconciled);
            workspace.reconcileCreatedPost?.(temp.id, reconciled);
          } else {
            addPost(reconciled);
          }
        } else if (temp) {
          removePost(temp.id);
        }

        if (!workspace.openCreatedPost) {
          ctx.navigate(blogPostEditPath(pool.blog, saved));
        }
      } catch (error) {
        if (temp) {
          removePost(temp.id);
          workspace.afterDelete(temp.id);
        }
        ctx.toast(error instanceof Error ? error.message : "Could not create");
      }
    },
  };
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
    id: "command.palette",
    label: "Open command palette",
    group: "Command bar",
    shortcut: [
      { key: "k", meta: true, label: "⌘K", allowTypingTarget: true },
      { key: "k", ctrl: true, label: "Ctrl K", allowTypingTarget: true },
    ],
    when: () => true,
    run: (ctx) => ctx.openPalette(),
  },
  {
    id: "workspace.search",
    label: "Search workspace",
    group: "Command bar",
    shortcut: { key: "/", label: "/", requiresWorkspace: true },
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.focusSearch(),
  },
  {
    id: "command.shortcuts",
    label: "Keyboard shortcuts",
    group: "Command bar",
    shortcut: { key: "?", label: "?" },
    when: () => true,
    run: (ctx) => ctx.openShortcuts(),
  },
  {
    id: "create.current",
    label: "Create in context",
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
    label: "Move up",
    group: "Navigate",
    shortcut: [
      { key: "ArrowUp", label: "↑" },
      { key: "k", label: "K" },
    ],
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.selectSpatial("up"),
  },
  {
    id: "selection.next",
    label: "Move down",
    group: "Navigate",
    shortcut: [
      { key: "ArrowDown", label: "↓" },
      { key: "j", label: "J" },
    ],
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.selectSpatial("down"),
  },
  {
    id: "selection.left",
    label: "Move left",
    group: "Navigate",
    shortcut: { key: "ArrowLeft", label: "←" },
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.selectSpatial("left"),
  },
  {
    id: "selection.right",
    label: "Move right",
    group: "Navigate",
    shortcut: { key: "ArrowRight", label: "→" },
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.workspace?.selectSpatial("right"),
  },
  {
    id: "selection.open",
    label: "Open focused item",
    group: "Navigate",
    shortcut: { key: "Enter", label: "Enter" },
    when: (ctx) =>
      Boolean(
        ctx.workspace &&
          ctx.workspace.viewLevel !== "post" &&
          ctx.workspace.viewLevel !== "edit",
      ),
    run: (ctx) => ctx.workspace?.openSelected(),
  },
  {
    id: "navigation.escape",
    label: "Close current view",
    group: "Navigate",
    shortcut: { key: "Escape", label: "Esc", allowTypingTarget: true },
    when: (ctx) => Boolean(ctx.workspace && ctx.workspace.viewLevel !== "root"),
    run: (ctx) => {
      ctx.workspace?.escapeCurrent();
    },
  },
  {
    id: "navigation.up",
    label: "Go up one level",
    group: "Navigate",
    shortcut: { key: "Backspace", label: "Backspace" },
    // Keep this available at home so Backspace is consumed instead of falling
    // through to the browser's history navigation.
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => {
      ctx.workspace?.navigateUp();
    },
  },
  ...Array.from({ length: 9 }, (_, index): AppCommand => ({
    id: `navigation.item.${index + 1}`,
    label: `Open visible item ${index + 1}`,
    group: "Navigate",
    shortcut: { key: String(index + 1), label: String(index + 1) },
    when: (ctx) => {
      const workspace = ctx.workspace;
      if (!workspace) return false;
      return workspace.viewLevel === "root"
        ? Boolean(workspace.getRootSectionPaths()[index])
        : workspace.viewLevel === "section"
          ? Boolean(workspace.getVisiblePostIds()[index])
          : false;
    },
    run: (ctx) => ctx.workspace?.openItemByIndex(index),
  })),
  {
    id: "read.page-down",
    label: "Page down",
    group: "Read",
    shortcut: { key: " ", label: "Space" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.scrollReader("down", "page"),
  },
  {
    id: "read.page-up",
    label: "Page up",
    group: "Read",
    shortcut: { key: " ", shift: true, label: "Shift Space" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.scrollReader("up", "page"),
  },
  {
    id: "read.half-down",
    label: "Half page down",
    group: "Read",
    shortcut: { key: "d", ctrl: true, label: "Ctrl D" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.scrollReader("down", "half"),
  },
  {
    id: "read.half-up",
    label: "Half page up",
    group: "Read",
    shortcut: { key: "u", ctrl: true, label: "Ctrl U" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.scrollReader("up", "half"),
  },
  {
    id: "read.bottom",
    label: "Jump to end",
    group: "Read",
    shortcut: { key: "g", shift: true, label: "G" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.scrollReaderEdge("bottom"),
  },
  {
    id: "read.top",
    label: "Jump to top",
    group: "Read",
    shortcut: { key: "g", label: "G G" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.readerTapG(),
  },
  {
    id: "post.previous",
    label: "Previous post",
    group: "Read",
    shortcut: { key: "[", label: "[" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.openAdjacentPost(-1),
  },
  {
    id: "post.next",
    label: "Next post",
    group: "Read",
    shortcut: { key: "]", label: "]" },
    when: (ctx) => ctx.workspace?.viewLevel === "post",
    run: (ctx) => ctx.workspace?.openAdjacentPost(1),
  },
  {
    id: "post.stop-editing",
    label: "Stop editing",
    group: "Edit",
    shortcut: [
      { key: "Enter", meta: true, label: "⌘Enter", allowTypingTarget: true },
      { key: "Enter", ctrl: true, label: "Ctrl Enter", allowTypingTarget: true },
    ],
    when: (ctx) => ctx.workspace?.viewLevel === "edit",
    run: (ctx) => ctx.workspace?.stopEditing(),
  },
  {
    id: "post.edit",
    label: "Edit current page",
    group: "Act",
    shortcut: [
      { key: "e", label: "E" },
      { key: "F2", label: "F2" },
    ],
    when: (ctx) => Boolean(ctx.workspace?.canEdit && ctx.workspace.viewLevel !== "edit"),
    run: (ctx) => ctx.workspace?.editCurrent(),
  },
  {
    id: "post.delete",
    label: "Move focused item to Trash",
    group: "Act",
    shortcut: [
      { key: "Delete", label: "Del" },
      { key: "Backspace", meta: true, label: "⌘Delete", allowTypingTarget: true },
      { key: "Delete", ctrl: true, label: "Ctrl Delete", allowTypingTarget: true },
    ],
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canManagePost),
    run: (ctx) => ctx.workspace?.requestDeleteTarget(),
  },
  {
    id: "post.pin",
    label: "Star or unstar focused item",
    group: "Act",
    shortcut: { key: "s", label: "S" },
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canManagePost),
    run: togglePinSelected,
  },
  {
    id: "post.saved-status",
    label: "Show save status",
    group: "Edit",
    shortcut: [
      { key: "s", meta: true, label: "⌘S", allowTypingTarget: true },
      { key: "s", ctrl: true, label: "Ctrl S", allowTypingTarget: true },
    ],
    when: (ctx) => Boolean(ctx.workspace),
    run: (ctx) => ctx.toast("Already saved"),
  },
  {
    id: "post.move",
    label: "Move focused item",
    group: "Act",
    shortcut: { key: "m", label: "M" },
    when: (ctx) => Boolean(commandTargetPost(ctx) && ctx.workspace?.canManagePost),
    run: (ctx) => ctx.openPalette("/move "),
  },
  {
    id: "post.publish",
    label: "Publish or unpublish",
    group: "Act",
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
    run: (ctx) => ctx.workspace?.openSettings(),
  },
];

export function shortcutList(command: AppCommand): CommandShortcut[] {
  if (!command.shortcut) return [];
  return Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut];
}

export function commandShortcutLabel(command: AppCommand): string | undefined {
  const shortcuts = shortcutList(command).map((shortcut) => {
    if (shortcut.label) return shortcut.label;
    const modifiers = [
      shortcut.meta ? "⌘" : "",
      shortcut.ctrl ? "Ctrl " : "",
      shortcut.alt ? "Alt " : "",
      shortcut.shift ? "Shift " : "",
    ].join("");
    const key = shortcut.key.length === 1
      ? shortcut.key.toUpperCase()
      : shortcut.key;
    return `${modifiers}${key}`;
  });
  return shortcuts.length > 0 ? shortcuts.join(", ") : undefined;
}

export function primaryShortcutLabel(command: AppCommand): string | undefined {
  return shortcutList(command)[0]?.label;
}

// Look up a command's shortcut label by id so tooltips stay in sync with the
// registry (key + label live in exactly one place).
export function shortcutLabelForCommand(id: string): string | undefined {
  const command = WORKSPACE_COMMANDS.find((candidate) => candidate.id === id);
  return command ? primaryShortcutLabel(command) : undefined;
}

export type WorkspaceShortcutRow = {
  id: string;
  label: string;
  group: string;
  shortcut: string;
};

export function workspaceShortcutRows(): WorkspaceShortcutRow[] {
  const rows: WorkspaceShortcutRow[] = [];
  for (const command of WORKSPACE_COMMANDS) {
    if (command.showInShortcutSheet === false) continue;
    const shortcut = commandShortcutLabel(command);
    if (!shortcut) continue;
    rows.push({
      id: command.id,
      label: command.label,
      group: command.group,
      shortcut,
    });
  }
  return rows;
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

  return moveCommands;
}

export function shouldSuppressWorkspaceSingleKeyShortcut(
  ctx: CommandContext,
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
): boolean {
  const workspace = ctx.workspace;
  if (
    !workspace ||
    workspace.viewLevel !== "edit" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.key.length !== 1
  ) {
    return false;
  }
  const post = workspace.activePostId
    ? workspace.getPost(workspace.activePostId)
    : null;
  return post?.type === "note";
}
