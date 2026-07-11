"use client";

// The workspace view of a folder: a quiet list rendered per folder mode inside
// the home workspace shell. Notes and bookmarks stay unlisted; sharing only
// grants named collaborators access.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createFolderItemAction,
  createWorkspacePostAction,
  renameFolderAction,
  setEditablePostCreatedAtAction,
  toggleEditablePostPinnedAction,
} from "@/app/editor/actions";
import { BookmarkCard } from "@/components/bookmarks/BookmarkCard";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { PostCard } from "@/components/PostCard";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { formatArticleDate, postBodyPreview } from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";
import { updateFolder, updatePost } from "@/lib/pool/store";

export type FolderCreateRequest =
  | { type: "article"; folderPath: string }
  | { type: "note"; folderPath: string; title?: string }
  | {
      type: "bookmark";
      folderPath: string;
      description?: string;
      url: string;
      title?: string;
    };

export type FolderCreateItem = (request: FolderCreateRequest) => void;
export type FolderDeleteItem = (post: Post) => Promise<void> | void;
export type FolderCaptureResolved = (post: Post) => void;
export type FolderViewMode = "list" | "column" | "grid";
export type FolderDeleteFolder = (folder: Folder) => Promise<void> | void;

const CREATE_FOLDER_ITEM_EVENT = "write:create-folder-item";
const EDIT_FOLDER_TITLE_EVENT = "write:edit-folder-title";
const FOLDER_VIEW_EVENT = "write:folder-view-changed";

type FolderUiEventDetail = { folderId: string };

function dispatchFolderUiEvent(type: string, folderId: string) {
  window.dispatchEvent(
    new CustomEvent<FolderUiEventDetail>(type, { detail: { folderId } }),
  );
}

function isFolderUiEvent(event: Event, folderId: string): boolean {
  return (
    (event as CustomEvent<FolderUiEventDetail>).detail?.folderId === folderId
  );
}

function validFolderViewMode(
  value: string | null,
): value is FolderViewMode {
  return value === "list" || value === "column" || value === "grid";
}

function useFolderViewMode(
  folderId: string,
  defaultMode: FolderViewMode,
): [FolderViewMode, (mode: FolderViewMode) => void] {
  const key = `write:folder-view:${folderId}`;
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    window.addEventListener(FOLDER_VIEW_EVENT, notify);
    return () => {
      window.removeEventListener("storage", notify);
      window.removeEventListener(FOLDER_VIEW_EVENT, notify);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    const saved = window.localStorage.getItem(key);
    return validFolderViewMode(saved) ? saved : defaultMode;
  }, [defaultMode, key]);
  const viewMode = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultMode,
  );
  const changeView = useCallback(
    (mode: FolderViewMode) => {
      window.localStorage.setItem(key, mode);
      window.dispatchEvent(new Event(FOLDER_VIEW_EVENT));
    },
    [key],
  );
  return [viewMode, changeView];
}

function itemKey(post: Post): string {
  return post.id ?? post.slug;
}

function itemTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function domSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function postOptionId(postId: string | null | undefined): string | undefined {
  return postId ? `workspace-post-${domSafeId(postId)}` : undefined;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function shouldOpenLocally(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function sortedByTimestampDesc(
  items: Post[],
  timestamp: (post: Post) => string,
): Post[] {
  return [...items].sort((a, b) => timestamp(b).localeCompare(timestamp(a)));
}

function firstBodyLine(body: string): string {
  return (
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function stripLeadingMarkdown(line: string): string {
  return line.replace(/^[\s#*>`-]+/, "").trim();
}

function previewLine(body: string): string {
  const line = stripLeadingMarkdown(firstBodyLine(body));
  if (line.length <= 150) return line;
  const sliced = line.slice(0, 147).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${wordBreak > 60 ? sliced.slice(0, wordBreak) : sliced}...`;
}

function bookmarkUrlParts(rawUrl: string): { href: string; host: string } {
  const raw = rawUrl.trim();
  const candidates = [raw, `https://${raw}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return {
        href: url.toString(),
        host: url.hostname.replace(/^www\./, ""),
      };
    } catch {
      // Try the next forgiving candidate.
    }
  }
  return { href: raw, host: raw };
}

function optimisticBookmarkPost({
  url,
  title,
  description,
}: {
  url: string;
  title?: string;
  description?: string;
}): Post {
  const now = new Date().toISOString();
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { href, host } = bookmarkUrlParts(url);
  const resolvedTitle = title?.trim() || host || "Bookmark";
  return {
    id: `optimistic-bookmark-${stamp}`,
    type: "bookmark",
    captureStatus: "pending",
    capture: { url: href },
    slug: `untitled-${stamp}`,
    title: resolvedTitle,
    excerpt: description?.trim() || href,
    body: "",
    status: "draft",
    pinned: false,
    links: [{ label: host || resolvedTitle, href }],
    date: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
  };
}

function FolderEmptyCard({
  actionLabel,
  busy = false,
  children,
  onAction,
}: {
  actionLabel?: ReactNode;
  busy?: boolean;
  children: string;
  onAction?: () => void;
}) {
  return (
    <article className="post-folder-page-card">
      <p>{children}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          className="post-folder-create ac-btn ac-btn-filled"
          disabled={busy}
          onClick={onAction}
        >
          {busy ? "Creating" : actionLabel}
        </button>
      )}
    </article>
  );
}

const FOLDER_VIEW_LABELS: Record<FolderViewMode, string> = {
  list: "List",
  column: "One column",
  grid: "Grid",
};

function FolderActionBar({
  blog,
  folder,
  canCreate,
  canEdit,
  canShare,
  viewMode,
  onChangeView,
  onCreate,
  onEdit,
  onDeleteFolder,
}: {
  blog: Blog;
  folder: Folder;
  canCreate: boolean;
  canEdit: boolean;
  canShare: boolean;
  viewMode: FolderViewMode;
  onChangeView: (mode: FolderViewMode) => void;
  onCreate: () => void;
  onEdit: () => void;
  onDeleteFolder?: FolderDeleteFolder;
}) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeView = useCallback(() => setViewOpen(false), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEscapeLayer(viewOpen, "Folder view", closeView);
  useEscapeLayer(menuOpen, "Folder actions", closeMenu);

  useEffect(() => {
    if (!viewOpen && !menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (viewOpen && !viewRef.current?.contains(event.target)) closeView();
      if (menuOpen && !menuRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeMenu, closeView, menuOpen, viewOpen]);

  const createLabel =
    folder.mode === "notes"
      ? "Create note"
      : folder.mode === "bookmarks"
        ? "Create bookmark"
        : "Create post";

  const confirmDelete = useCallback(() => {
    if (!onDeleteFolder || deleting) return;
    setDeleting(true);
    setError(null);
    void Promise.resolve(onDeleteFolder(folder))
      .then(() => setDeleteOpen(false))
      .catch((deleteError) => {
        setError(actionErrorMessage(deleteError, "Could not move folder to Trash"));
        setDeleteOpen(false);
        setMenuOpen(true);
      })
      .finally(() => setDeleting(false));
  }, [deleting, folder, onDeleteFolder]);

  return (
    <>
      <div className="folder-top-action-bar applecms" aria-label="Folder actions">
        <div className="folder-action-toolbar ac-chrome">
          {canShare && (
            <button
              type="button"
              className="ac-btn ac-btn-gray"
              onClick={() => setShareOpen(true)}
            >
              Share
            </button>
          )}
          <div className="post-action-popover-wrap" ref={viewRef}>
            <button
              type="button"
              className="ac-btn ac-btn-gray"
              aria-haspopup="menu"
              aria-expanded={viewOpen}
              onClick={() => {
                setMenuOpen(false);
                setViewOpen((open) => !open);
              }}
            >
              {FOLDER_VIEW_LABELS[viewMode]}
              <span aria-hidden="true">▾</span>
            </button>
            {viewOpen && (
              <div
                className="folder-action-menu"
                role="menu"
                data-post-edit-menu-open="true"
                aria-label="Folder view"
              >
                {(Object.keys(FOLDER_VIEW_LABELS) as FolderViewMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`folder-action-menu-item${
                        viewMode === mode ? " is-active" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={viewMode === mode}
                      onClick={() => {
                        onChangeView(mode);
                        setViewOpen(false);
                      }}
                    >
                      {FOLDER_VIEW_LABELS[mode]}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
          {canEdit && (
            <button type="button" className="ac-btn ac-btn-gray" onClick={onEdit}>
              <span className="shortcut-label"><span className="shortcut-letter">E</span>dit</span>
            </button>
          )}
          {canEdit && onDeleteFolder && (
            <div className="post-action-popover-wrap" ref={menuRef}>
              <button
                type="button"
                className="ac-icon-btn folder-action-more"
                aria-label="Folder options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                  setViewOpen(false);
                  setMenuOpen((open) => !open);
                }}
              >
                ···
              </button>
              {menuOpen && (
                <div
                  className="folder-action-menu is-right"
                  role="menu"
                  data-post-edit-menu-open="true"
                  aria-label="Folder options"
                >
                  <button
                    type="button"
                    className="folder-action-menu-item is-danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteOpen(true);
                    }}
                  >
                    Move folder to Trash
                  </button>
                  {error && <span className="post-folder-error">{error}</span>}
                </div>
              )}
            </div>
          )}
          {canCreate && (
            <button
              type="button"
              className="ac-btn ac-btn-filled folder-action-create"
              onClick={onCreate}
            >
              <span className="shortcut-label"><span className="shortcut-letter">C</span>{createLabel.slice(1)}</span>
            </button>
          )}
        </div>
      </div>
      <ShareDialog
        handle={blog.handle}
        scopeType="folder"
        scopeId={folder.id}
        title={`Share ${folder.name}`}
        subtitle={folder.path}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      <ConfirmationDialog
        open={deleteOpen}
        title={`Move ${folder.name} to Trash?`}
        message="The folder and everything in it can be restored later."
        confirmLabel="Move to Trash"
        confirmingLabel="Moving"
        confirming={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function FolderTitleEditor({
  folder,
  handle,
  canEdit,
}: {
  folder: Folder;
  handle: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const cleanName = name.trim().replace(/\s+/g, " ");

  const cancelEditing = useCallback(() => {
    setName(folder.name);
    setEditing(false);
    setError(null);
  }, [folder.name]);
  useEscapeLayer(editing, "Rename folder", cancelEditing);

  useEffect(() => {
    const beginEditing = (event: Event) => {
      if (!canEdit || !isFolderUiEvent(event, folder.id)) return;
      setName(folder.name);
      setEditing(true);
      setError(null);
    };
    window.addEventListener(EDIT_FOLDER_TITLE_EVENT, beginEditing);
    return () =>
      window.removeEventListener(EDIT_FOLDER_TITLE_EVENT, beginEditing);
  }, [canEdit, folder.id, folder.name]);

  const saveName = useCallback(() => {
    if (!canEdit || saving) return;
    if (!cleanName) return;
    setSaving(true);
    setError(null);
    startTransition(() => {
      void renameFolderAction(handle, folder.id, cleanName)
        .then((saved) => {
          setName(saved.name);
          updateFolder(folder.id, { name: saved.name });
          setEditing(false);
        })
        .catch((saveError) => {
          setError(actionErrorMessage(saveError, "Could not rename"));
        })
        .finally(() => setSaving(false));
    });
  }, [canEdit, cleanName, folder.id, handle, saving, startTransition]);

  if (!canEdit || !editing) {
    return (
      <div className="post-folder-title-row">
        <h1 id="post-folder-page-title">{folder.name}</h1>
      </div>
    );
  }

  return (
    <form
      className="post-folder-title-form"
      onSubmit={(event) => {
        event.preventDefault();
        saveName();
      }}
    >
      <input
        id="post-folder-page-title"
        className="post-folder-title-input"
        value={name}
        placeholder="Folder name"
        aria-label="Folder name"
        autoFocus
        onBlur={() => {
          if (cleanName) saveName();
        }}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelEditing();
          }
        }}
      />
      <button
        type="submit"
        className="post-folder-title-confirm ac-btn ac-btn-filled"
        disabled={!cleanName || saving}
        onPointerDown={(event) => event.preventDefault()}
      >
        {saving ? "Saving" : "Save"}
      </button>
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

function FolderItemActions({
  blog,
  handle,
  onDeleteItem,
  post,
}: {
  blog: Blog;
  handle: string;
  onDeleteItem?: FolderDeleteItem;
  post: Post;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(open, "Item actions", close);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        close();
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [close, open]);

  const stop = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const toggleStar = (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!post.id || busy) return;
    const previous = Boolean(post.pinned);
    setBusy(true);
    setError(null);
    updatePost(post.id, { pinned: !previous });
    void toggleEditablePostPinnedAction(handle, post.id)
      .then(() => setOpen(false))
      .catch((actionError) => {
        updatePost(post.id!, { pinned: previous });
        setError(actionErrorMessage(actionError, "Could not update star"));
      })
      .finally(() => setBusy(false));
  };

  const share = (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    const url = new URL(blogPostPath(blog, post), window.location.origin);
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const setCreatedDate = (value: string) => {
    if (!post.id || !value || busy) return;
    const previous = post.createdAt;
    setBusy(true);
    setError(null);
    updatePost(post.id, { createdAt: `${value}T12:00:00.000Z` });
    void setEditablePostCreatedAtAction(handle, post.id, value)
      .then((saved) => {
        updatePost(post.id!, { createdAt: saved.createdAt });
        setOpen(false);
      })
      .catch((actionError) => {
        updatePost(post.id!, { createdAt: previous });
        setError(actionErrorMessage(actionError, "Could not change date"));
      })
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (!post.id || !onDeleteItem || busy) return;
    setBusy(true);
    void Promise.resolve(onDeleteItem(post))
      .then(() => {
        setDeleteOpen(false);
        setOpen(false);
      })
      .catch((actionError) => {
        setError(actionErrorMessage(actionError, "Could not move to Trash"));
        setDeleteOpen(false);
        setOpen(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="folder-item-actions" ref={rootRef} onClick={stop}>
      <button
        type="button"
        className="folder-item-actions-trigger ac-icon-btn"
        aria-label="Item actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          stop(event);
          setError(null);
          setOpen((value) => !value);
        }}
      >
        ···
      </button>
      {open && (
        <div className="folder-item-actions-menu" role="menu" data-post-edit-menu-open="true">
          <button type="button" role="menuitem" disabled={busy} onClick={toggleStar}>
            {post.pinned ? "Unstar" : "Star"}
          </button>
          <button type="button" role="menuitem" onClick={share}>
            {copied ? "Link copied" : "Share"}
          </button>
          <label className="folder-item-date">
            <span>Created</span>
            <input
              type="date"
              value={(post.createdAt ?? post.date ?? "").slice(0, 10)}
              disabled={busy}
              onChange={(event) => setCreatedDate(event.currentTarget.value)}
            />
          </label>
          {onDeleteItem && (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={busy}
              onClick={(event) => {
                stop(event);
                setOpen(false);
                setDeleteOpen(true);
              }}
            >
              Move to Trash
            </button>
          )}
          {error && <span className="post-folder-error" role="alert">{error}</span>}
        </div>
      )}
      <ConfirmationDialog
        open={deleteOpen}
        title={`Move ${itemTitle(post)} to Trash?`}
        message="You can restore it later from Trash."
        confirmLabel="Move to Trash"
        confirmingLabel="Moving"
        confirming={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function NotesFolderContents({
  blog,
  handle,
  items,
  canEditItems,
  folderId,
  folderPath,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  onSelectPost,
  selectedPostId,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canEditItems: boolean;
  folderId: string;
  folderPath: string;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const createNote = useCallback(() => {
    if (creating) return;
    if (onCreateItem) {
      setError(null);
      onCreateItem({ type: "note", folderPath });
      return;
    }
    setCreating(true);
    setError(null);
    startTransition(() => {
      void createFolderItemAction(handle, "notes")
        .then((post) => {
          router.push(blogPostEditPath(blog, post));
        })
        .catch((createError) => {
          setCreating(false);
          setError(actionErrorMessage(createError, "Could not create the note"));
        });
    });
  }, [blog, creating, folderPath, handle, onCreateItem, router]);

  const notes = useMemo(
    () =>
      sortedByTimestampDesc(
        items,
        (post) => post.updatedAt ?? post.date ?? "",
      ),
    [items],
  );

  useEffect(() => {
    const createRequested = (event: Event) => {
      if (isFolderUiEvent(event, folderId)) createNote();
    };
    window.addEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
    return () =>
      window.removeEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
  }, [createNote, folderId]);

  return (
    <>
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
      <section className="post-folder-page-items" aria-label="Notes">
        {notes.length === 0 ? (
          <FolderEmptyCard>
            Write your first private note.
          </FolderEmptyCard>
        ) : (
          <div
            className="post-folder-list"
            role="listbox"
            aria-label="Notes"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {notes.map((note) => {
              const preview = previewLine(postBodyPreview(note));
              const selected = note.id === selectedPostId;
              return (
                <div
                  key={itemKey(note)}
                  id={postOptionId(note.id)}
                  className={`post-folder-row-shell${
                    selected ? " is-command-selected" : ""
                  }`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-workspace-post-id={note.id}
                  onFocus={() => note.id && onSelectPost?.(note.id)}
                  onMouseEnter={() => note.id && onSelectPost?.(note.id)}
                >
                  <Link
                    className="post-folder-row"
                    href={
                      onOpenPost
                        ? blogPostPath(blog, note)
                        : canEditItems
                          ? blogPostEditPath(blog, note)
                          : blogPostPath(blog, note)
                    }
                    prefetch={onOpenPost ? false : undefined}
                    onClick={(event) => {
                      if (!onOpenPost || !shouldOpenLocally(event)) return;
                      event.preventDefault();
                      onOpenPost(note);
                    }}
                  >
                    <span className="post-folder-row-title">
                      {itemTitle(note)}
                    </span>
                    <span className="post-folder-row-meta">
                      {formatArticleDate(note.updatedAt ?? note.date, {
                        style: "short",
                      })}
                    </span>
                    {preview && (
                      <span className="post-folder-row-excerpt">{preview}</span>
                    )}
                  </Link>
                  {canEditItems && (
                    <FolderItemActions
                      blog={blog}
                      handle={handle}
                      post={note}
                      onDeleteItem={onDeleteItem}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function BookmarksFolderContents({
  blog,
  handle,
  items,
  canCreateItems,
  canEditItems,
  folderId,
  folderPath,
  onCaptureResolved,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  onSelectPost,
  selectedPostId,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
  folderId: string;
  folderPath: string;
  onCaptureResolved?: FolderCaptureResolved;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
}) {
  const router = useRouter();
  const urlRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBookmarks, setLocalBookmarks] = useState<Post[]>([]);
  const [, startTransition] = useTransition();

  const openForm = useCallback(() => {
    setError(null);
    setFormOpen(true);
    window.requestAnimationFrame(() => {
      urlRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    const createRequested = (event: Event) => {
      if (isFolderUiEvent(event, folderId)) openForm();
    };
    window.addEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
    return () =>
      window.removeEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
  }, [folderId, openForm]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setError(null);
  }, []);

  const addBookmark = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;

      const form = event.currentTarget;
      const data = new FormData(form);
      const url = String(data.get("url") ?? "").trim();
      const title = String(data.get("title") ?? "").trim();
      const description = String(data.get("description") ?? "").trim();
      if (!url) {
        setError("A bookmark needs a link");
        return;
      }

      if (onCreateItem) {
        form.reset();
        setFormOpen(false);
        setError(null);
        onCreateItem({
          type: "bookmark",
          folderPath,
          url,
          description: description || undefined,
          title: title || undefined,
        });
        return;
      }

      const optimistic = optimisticBookmarkPost({
        url,
        title: title || undefined,
        description: description || undefined,
      });
      setLocalBookmarks((current) => [optimistic, ...current]);
      form.reset();
      setFormOpen(false);
      setError(null);
      startTransition(() => {
        void createFolderItemAction(handle, "bookmarks", {
          url,
          description: description || undefined,
          title: title || undefined,
        })
          .then((saved) => {
            setLocalBookmarks((current) =>
              current.map((bookmark) =>
                bookmark.id === optimistic.id ? saved : bookmark,
              ),
            );
            router.refresh();
          })
          .catch((saveError) => {
            setLocalBookmarks((current) =>
              current.filter((bookmark) => bookmark.id !== optimistic.id),
            );
            setError(
              actionErrorMessage(saveError, "Could not save the bookmark"),
            );
          })
          .finally(() => setSaving(false));
      });
    },
    [folderPath, handle, onCreateItem, router, saving],
  );

  const bookmarks = useMemo(
    () => {
      const persistedIds = new Set(
        items.flatMap((post) => (post.id ? [post.id] : [])),
      );
      const pending = localBookmarks.filter(
        (post) => !post.id || !persistedIds.has(post.id),
      );
      return sortedByTimestampDesc(
        [...pending, ...items],
        (post) => post.createdAt ?? post.date ?? "",
      );
    },
    [items, localBookmarks],
  );

  return (
    <>
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
      {canCreateItems && formOpen && (
        <div className="post-folder-inline-create">
          <form className="post-folder-new-form" onSubmit={addBookmark}>
              <input
                ref={urlRef}
                className="post-folder-field is-url"
                name="url"
                type="text"
                inputMode="url"
                placeholder="https://example.com"
                aria-label="Bookmark link"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <input
                className="post-folder-field is-title"
                name="title"
                type="text"
                placeholder="Title (optional)"
                aria-label="Bookmark title"
              />
              <input
                className="post-folder-field is-description"
                name="description"
                type="text"
                placeholder="Description (optional)"
                aria-label="Bookmark description"
              />
              <button
                type="submit"
                className="ac-btn ac-btn-filled"
                disabled={saving}
              >
                {saving ? "Adding" : "Add"}
              </button>
              <button
                type="button"
                className="ac-btn ac-btn-gray"
                disabled={saving}
                onClick={closeForm}
              >
                Cancel
              </button>
          </form>
        </div>
      )}
      <section className="post-folder-page-items" aria-label="Bookmarks">
        {bookmarks.length === 0 ? (
          <FolderEmptyCard>
            Save your first link.
          </FolderEmptyCard>
        ) : (
          <div
            className="post-folder-list"
            role="listbox"
            aria-label="Bookmarks"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {bookmarks.map((bookmark) => {
              const selected = bookmark.id === selectedPostId;
              return (
                <BookmarkCard
                  key={itemKey(bookmark)}
                  post={bookmark}
                  selected={selected}
                  optionId={postOptionId(bookmark.id)}
                  optionTabIndex={selected ? 0 : -1}
                  owner={canEditItems}
                  handle={handle}
                  editPath={
                    onOpenPost
                      ? blogPostPath(blog, bookmark)
                      : canEditItems
                        ? blogPostEditPath(blog, bookmark)
                        : blogPostPath(blog, bookmark)
                  }
                  onCaptureResolved={onCaptureResolved}
                  onDeletePost={onDeleteItem}
                  onOpenPost={onOpenPost}
                  onSelect={() => bookmark.id && onSelectPost?.(bookmark.id)}
                />
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function BlogFolderContents({
  blog,
  handle,
  items,
  canEditItems,
  folderId,
  folderPath,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  onSelectPost,
  selectedPostId,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canEditItems: boolean;
  folderId: string;
  folderPath: string;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sorted = useMemo(
    () =>
      sortedByTimestampDesc(
        items,
        (post) => post.updatedAt ?? post.date ?? "",
      ),
    [items],
  );

  const createArticle = useCallback(() => {
    if (creating) return;
    if (onCreateItem) {
      setError(null);
      onCreateItem({ type: "article", folderPath });
      return;
    }
    setCreating(true);
    setError(null);
    startTransition(() => {
      void createWorkspacePostAction(handle, "article", "blog")
        .then((post) => {
          router.push(blogPostEditPath(blog, post));
        })
        .catch((createError) => {
          setCreating(false);
          setError(
            actionErrorMessage(createError, "Could not create the article"),
          );
        });
    });
  }, [blog, creating, folderPath, handle, onCreateItem, router]);

  useEffect(() => {
    const createRequested = (event: Event) => {
      if (isFolderUiEvent(event, folderId)) createArticle();
    };
    window.addEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
    return () =>
      window.removeEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
  }, [createArticle, folderId]);

  return (
    <>
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
      <section className="post-folder-page-items" aria-label="Folder items">
        {sorted.length === 0 ? (
          <FolderEmptyCard>
              Start the first article in this folder.
          </FolderEmptyCard>
        ) : (
          <div
            className="tv-grid post-folder-card-grid"
            role="listbox"
            aria-label="Folder items"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {sorted.map((post) => {
              const selected = post.id === selectedPostId;
              return (
                <div
                  key={itemKey(post)}
                  id={postOptionId(post.id)}
                  className={`post-folder-card-option${
                    selected ? " is-command-selected" : ""
                  }`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-workspace-post-id={post.id}
                  onFocus={() => post.id && onSelectPost?.(post.id)}
                  onMouseEnter={() => post.id && onSelectPost?.(post.id)}
                >
                  <PostCard
                    blog={blog}
                    handle={handle}
                    post={post}
                    owner={canEditItems}
                    href={
                      canEditItems
                        ? blogPostPath(blog, post)
                        : blogPostPath(blog, post)
                    }
                    onOpen={
                      onOpenPost
                        ? (event) => {
                            if (!shouldOpenLocally(event)) return;
                            event.preventDefault();
                            onOpenPost(post);
                          }
                        : undefined
                    }
                    onDeletePost={onDeleteItem}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export function FolderPage({
  blog,
  folder,
  handle,
  items,
  canCreateItems = true,
  canEditItems = true,
  onCaptureResolved,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  createBookmarkRequestKey,
  editRequestKey = 0,
  onSelectPost,
  selectedPostId,
  onDeleteFolder,
  canShareFolders = true,
}: {
  blog: Blog;
  folder: Folder;
  handle: string;
  items: Post[];
  canCreateItems?: boolean;
  canEditItems?: boolean;
  onCaptureResolved?: FolderCaptureResolved;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  createBookmarkRequestKey?: number;
  editRequestKey?: number;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
  onDeleteFolder?: FolderDeleteFolder;
  canShareFolders?: boolean;
}) {
  const defaultViewMode: FolderViewMode =
    folder.mode === "blog" ? "grid" : "list";
  const [viewMode, changeView] = useFolderViewMode(folder.id, defaultViewMode);
  const [filterQuery, setFilterQuery] = useState("");
  const lastCreateRequestKey = useRef(createBookmarkRequestKey ?? 0);
  const lastEditRequestKey = useRef(editRequestKey);

  useEffect(() => {
    const applyFilter = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: unknown }>).detail;
      const query = typeof detail?.query === "string" ? detail.query.trim() : "";
      setFilterQuery(query);
      if (!query || !onSelectPost) return;
      const normalized = query.toLocaleLowerCase();
      const firstMatch = items.find((post) =>
        [post.title, post.excerpt, postBodyPreview(post)]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalized)),
      );
      if (firstMatch?.id) onSelectPost(firstMatch.id);
    };
    window.addEventListener("write:filter-current-folder", applyFilter);
    return () => window.removeEventListener("write:filter-current-folder", applyFilter);
  }, [items, onSelectPost]);

  useEffect(() => {
    const nextKey = createBookmarkRequestKey ?? 0;
    if (nextKey <= lastCreateRequestKey.current) return;
    lastCreateRequestKey.current = nextKey;
    if (folder.mode === "bookmarks") {
      dispatchFolderUiEvent(CREATE_FOLDER_ITEM_EVENT, folder.id);
    }
  }, [createBookmarkRequestKey, folder.id, folder.mode]);

  useEffect(() => {
    if (editRequestKey <= lastEditRequestKey.current) return;
    lastEditRequestKey.current = editRequestKey;
    dispatchFolderUiEvent(EDIT_FOLDER_TITLE_EVENT, folder.id);
  }, [editRequestKey, folder.id]);

  const filteredItems = useMemo(() => {
    const query = filterQuery.trim().toLocaleLowerCase();
    if (!query) return items;
    return items.filter((post) =>
      [post.title, post.excerpt, postBodyPreview(post)]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [filterQuery, items]);

  const visibleSelectedPostId =
    selectedPostId && filteredItems.some((post) => post.id === selectedPostId)
      ? selectedPostId
      : (filteredItems[0]?.id ?? null);

  return (
    <main
      className={`post-folder-page is-view-${viewMode}`}
      aria-labelledby="post-folder-page-title"
    >
      <FolderActionBar
        blog={blog}
        folder={folder}
        canCreate={canCreateItems}
        canEdit={canEditItems}
        canShare={canShareFolders}
        viewMode={viewMode}
        onChangeView={changeView}
        onCreate={() => dispatchFolderUiEvent(CREATE_FOLDER_ITEM_EVENT, folder.id)}
        onEdit={() => dispatchFolderUiEvent(EDIT_FOLDER_TITLE_EVENT, folder.id)}
        onDeleteFolder={onDeleteFolder}
      />
      <header className="post-folder-page-header">
        <FolderTitleEditor
          folder={folder}
          handle={handle}
          canEdit={canEditItems}
        />
      </header>
      {filterQuery && (
        <div className="post-folder-filter-chip" role="status">
          <span>{filterQuery}</span>
          <button
            type="button"
            aria-label="Clear folder search"
            onClick={() => setFilterQuery("")}
          >
            ×
          </button>
        </div>
      )}
      {folder.mode === "blog" ? (
        <BlogFolderContents
          blog={blog}
          handle={handle}
          items={filteredItems}
          canEditItems={canEditItems}
          folderId={folder.id}
          folderPath={folder.path}
          onCreateItem={onCreateItem}
          onDeleteItem={onDeleteItem}
          onOpenPost={onOpenPost}
          onSelectPost={onSelectPost}
          selectedPostId={visibleSelectedPostId}
        />
      ) : folder.mode === "bookmarks" ? (
        <BookmarksFolderContents
          blog={blog}
          handle={handle}
          items={filteredItems}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
          folderId={folder.id}
          folderPath={folder.path}
          onCaptureResolved={onCaptureResolved}
          onCreateItem={onCreateItem}
          onDeleteItem={onDeleteItem}
          onOpenPost={onOpenPost}
          onSelectPost={onSelectPost}
          selectedPostId={visibleSelectedPostId}
        />
      ) : (
        <NotesFolderContents
          blog={blog}
          handle={handle}
          items={filteredItems}
          canEditItems={canEditItems}
          folderId={folder.id}
          folderPath={folder.path}
          onCreateItem={onCreateItem}
          onDeleteItem={onDeleteItem}
          onOpenPost={onOpenPost}
          onSelectPost={onSelectPost}
          selectedPostId={visibleSelectedPostId}
        />
      )}
    </main>
  );
}
