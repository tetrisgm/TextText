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
  useTransition,
} from "react";
import type {
  FormEvent,
  MouseEvent,
  ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createFolderItemAction,
  createWorkspacePostAction,
  renameFolderAction,
} from "@/app/editor/actions";
import { BookmarkCard } from "@/components/bookmarks/BookmarkCard";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import {
  DocumentCollectionRenderer,
  DocumentEngineStyles,
} from "@/components/document/DocumentRenderer";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import { TagChips } from "@/components/TagChips";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceActionSearch } from "@/components/workspace/WorkspaceActionSearch";
import {
  WorkspaceItemActions,
  WorkspaceItemStar,
} from "@/components/workspace/WorkspaceItemActions";
import {
  useWorkspaceViewMode,
  WorkspaceViewModeControl,
  type WorkspaceViewMode,
} from "@/components/workspace/WorkspaceViewModeControl";
import {
  resetSpatialCardTilt,
  updateSpatialCardTilt,
} from "@/components/workspace/spatial-card";
import { formatArticleDate, isVideoFile, postBodyPreview } from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import { resolveCoverSource } from "@/lib/cover";
import type { TemplateReference } from "@/lib/documents/model";
import { documentFromLegacyPost } from "@/lib/documents/legacy";
import { applyCollectionSpec } from "@/lib/documents/collection-query";
import { parseItemInput } from "@/lib/item-creation";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";
import { updateFolder } from "@/lib/pool/store";
import { shouldSuppressNativeItemSelection } from "@/lib/workspace-selection";

export type FolderCreateRequest =
  | {
      type: "article";
      folderPath: string;
      template?: TemplateReference;
      title?: string;
      body?: string;
    }
  | {
      type: "note";
      folderPath: string;
      template?: TemplateReference;
      title?: string;
      body?: string;
    }
  | {
      type: "bookmark";
      folderPath: string;
      blank: true;
      template?: TemplateReference;
      title?: string;
      body?: string;
    }
  | {
      type: "bookmark";
      folderPath: string;
      blank?: false;
      description?: string;
      template?: TemplateReference;
      url: string;
      title?: string;
    };

export type FolderCreateItem = (request: FolderCreateRequest) => void;

export type FolderDeleteItem = (post: Post) => Promise<void> | void;
export type FolderCaptureResolved = (post: Post) => void;
export type FolderViewMode = WorkspaceViewMode;
export type FolderDeleteFolder = (folder: Folder) => Promise<void> | void;

export const CREATE_FOLDER_ITEM_EVENT = "texttext:create-folder-item";
const EDIT_FOLDER_TITLE_EVENT = "texttext:edit-folder-title";
type FolderUiEventDetail = { folderId: string };

export function dispatchFolderUiEvent(type: string, folderId: string) {
  window.dispatchEvent(
    new CustomEvent<FolderUiEventDetail>(type, { detail: { folderId } }),
  );
}

function isFolderUiEvent(event: Event, folderId: string): boolean {
  return (
    (event as CustomEvent<FolderUiEventDetail>).detail?.folderId === folderId
  );
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
  // Pinned items float to the top of every folder list (all item types), then
  // most-recent first. Pin is a personal "keep on top" that works everywhere.
  return [...items].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    }
    return timestamp(b).localeCompare(timestamp(a));
  });
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

function expandedPreview(body: string): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^[\s#*>`-]+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 900) return text;
  const sliced = text.slice(0, 897).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${wordBreak > 600 ? sliced.slice(0, wordBreak) : sliced}...`;
}

function defaultTemplateForFolder(folder: Folder): TemplateReference {
  if (folder.defaultTemplate) return folder.defaultTemplate;
  return {
    id:
      folder.mode === "notes"
        ? "texttext.note"
        : folder.mode === "bookmarks"
          ? "texttext.bookmark"
          : "texttext.article",
    version: 1,
  };
}

function compatibilityTypeForTemplate(
  template: TemplateReference,
  sourceUrl: string | null,
): "article" | "note" | "bookmark" {
  if (sourceUrl || template.id === "texttext.bookmark") return "bookmark";
  if (template.id === "texttext.note") return "note";
  return "article";
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
    starred: false,
    links: [{ label: host || resolvedTitle, href }],
    date: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
  };
}

// One empty state shape: a plain sentence and, when the reader may write
// here, the single action that starts an item.
function FolderEmptyCard({
  actionLabel,
  children,
  onAction,
}: {
  actionLabel?: ReactNode;
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
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </article>
  );
}

function FolderActionBar({
  blog,
  folder,
  canCreate,
  canEdit,
  canShare,
  viewMode,
  onChangeView,
  onCreate,
  onRename,
  searchFocusRequestKey,
  searchValue,
  onSearchValueChange,
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
  onRename: () => void;
  searchFocusRequestKey?: number;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onDeleteFolder?: FolderDeleteFolder;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEscapeLayer(menuOpen, "Folder actions", closeMenu);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuOpen && !menuRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeMenu, menuOpen]);

  const createLabel = "Create item";

  const confirmDelete = useCallback(() => {
    if (!onDeleteFolder || deleting) return;
    setDeleteOpen(false);
    setDeleting(true);
    setError(null);
    void Promise.resolve(onDeleteFolder(folder))
      .catch((deleteError) => {
        setError(
          actionErrorMessage(deleteError, "Could not move folder to Trash"),
        );
        setMenuOpen(true);
      })
      .finally(() => setDeleting(false));
  }, [deleting, folder, onDeleteFolder]);

  return (
    <>
      <div
        className="folder-top-action-bar applecms"
        aria-label="Folder actions"
      >
        <div className="folder-action-toolbar ac-chrome">
          <WorkspaceActionSearch
            ariaLabel={`Search ${folder.name}`}
            focusRequestKey={searchFocusRequestKey}
            placeholder={`Search ${folder.name}`}
            value={searchValue}
            onChange={onSearchValueChange}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              if (searchValue) onSearchValueChange("");
              else event.currentTarget.blur();
            }}
          />
          {canShare && (
            <ShortcutTooltip label="Share" placement="bottom">
              <button
                type="button"
                className="ac-icon-btn folder-action-share"
                aria-label="Share folder"
                onClick={() => setShareOpen(true)}
              >
                <span aria-hidden="true">↗</span>
              </button>
            </ShortcutTooltip>
          )}
          {folder.mode !== "blog" && (
            <WorkspaceViewModeControl mode={viewMode} onChange={onChangeView} />
          )}
          {canEdit && (
            <div className="post-action-popover-wrap" ref={menuRef}>
              <ShortcutTooltip label="Folder options" placement="bottom">
                <button
                  type="button"
                  className="ac-icon-btn folder-action-more"
                  aria-label="Folder options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  ···
                </button>
              </ShortcutTooltip>
              {menuOpen && (
                <div
                  className="folder-action-menu is-right"
                  role="menu"
                  data-post-edit-menu-open="true"
                  aria-label="Folder options"
                >
                  <button
                    type="button"
                    className="folder-action-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onRename();
                    }}
                  >
                    Rename
                  </button>
                  {onDeleteFolder && (
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
                  )}
                  {error && <span className="post-folder-error">{error}</span>}
                </div>
              )}
            </div>
          )}
          {canCreate && (
            <ShortcutTooltip label={createLabel} keys="C" placement="bottom">
              <button
                type="button"
                className="ac-icon-btn folder-action-create"
                aria-label={createLabel}
                aria-keyshortcuts="C"
                onClick={onCreate}
              >
                <span aria-hidden="true">＋</span>
              </button>
            </ShortcutTooltip>
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
        {canEdit && (
          <ShortcutTooltip label="Rename" placement="bottom">
            <button
              type="button"
              className="post-folder-title-edit ac-icon-btn"
              aria-label="Rename folder"
              onClick={() =>
                dispatchFolderUiEvent(EDIT_FOLDER_TITLE_EVENT, folder.id)
              }
            >
              <span aria-hidden="true">✎</span>
            </button>
          </ShortcutTooltip>
        )}
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

// Creating is one action, not a form. There is nothing to decide before you
// type: the destination and the look follow from where you are and from what
// you typed, and both stay changeable afterwards. `destinations` is the set of
// root collections the workspace home may route into; a folder page passes
// none, because a folder page already knows where the item goes.
export function UniversalItemComposer({
  blog,
  destinations,
  folder,
  handle,
  onCreateItem,
}: {
  blog: Blog;
  destinations?: readonly Folder[];
  folder: Folder;
  handle: string;
  onCreateItem?: FolderCreateItem;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // A pasted link belongs with the other saved links, wherever you typed it.
  const destinationFor = useCallback(
    (sourceUrl: string | null): Folder => {
      if (!sourceUrl || !destinations?.length) return folder;
      return (
        destinations.find((candidate) => candidate.mode === "bookmarks") ??
        folder
      );
    },
    [destinations, folder],
  );

  useEffect(() => {
    const createRequested = (event: Event) => {
      if (!isFolderUiEvent(event, folder.id)) return;
      inputRef.current?.focus();
    };
    window.addEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
    return () =>
      window.removeEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
  }, [folder.id]);

  const createItem = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (creating) return;
      const form = event.currentTarget;
      const data = new FormData(form);
      const value = String(data.get("item") ?? "").trim();
      if (!value) {
        inputRef.current?.focus();
        return;
      }

      const draft = parseItemInput(value);
      const destination = destinationFor(draft.sourceUrl);
      const template = defaultTemplateForFolder(destination);
      const type = compatibilityTypeForTemplate(template, draft.sourceUrl);
      const request: FolderCreateRequest =
        type === "bookmark"
          ? draft.sourceUrl
            ? {
                type,
                folderPath: destination.path,
                template,
                url: draft.sourceUrl,
              }
            : {
                type,
                blank: true,
                body: draft.body,
                folderPath: destination.path,
                template,
                title: draft.title,
              }
          : {
              type,
              body: draft.body,
              folderPath: destination.path,
              template,
              title: draft.title,
            };

      form.reset();
      setError(null);
      if (onCreateItem) {
        onCreateItem(request);
        return;
      }

      setCreating(true);
      startTransition(() => {
        const creation =
          request.type === "bookmark"
            ? request.blank
              ? createWorkspacePostAction(
                  handle,
                  "bookmark",
                  request.folderPath,
                  request.title,
                  request.template,
                  request.body,
                )
              : createFolderItemAction(handle, "bookmarks", {
                  folderPath: request.folderPath,
                  template: request.template,
                  url: request.url,
                })
            : request.type === "note"
              ? createFolderItemAction(handle, "notes", {
                  folderPath: request.folderPath,
                  template: request.template,
                  title: request.title,
                  body: request.body,
                })
              : createWorkspacePostAction(
                  handle,
                  "article",
                  request.folderPath,
                  request.title,
                  request.template,
                  request.body,
                );
        void creation
          .then((post) => {
            if (draft.sourceUrl) router.refresh();
            else router.push(blogPostEditPath(blog, post));
          })
          .catch((createError) => {
            setError(actionErrorMessage(createError, "Could not create item"));
            inputRef.current?.focus();
          })
          .finally(() => setCreating(false));
      });
    },
    [blog, creating, destinationFor, handle, onCreateItem, router],
  );

  return (
    <>
      <form className="universal-item-composer" onSubmit={createItem}>
        <textarea
          ref={inputRef}
          name="item"
          className="universal-item-composer-input"
          placeholder="Type a title, or paste a link"
          aria-label="Create an item"
          autoCapitalize="sentences"
          autoCorrect="on"
          rows={1}
          onKeyDown={(event) => {
            // Enter creates and opens the item, the way a new page does
            // everywhere else. Shift+Enter is the newline.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="ac-icon-btn universal-item-create"
          aria-label="Create item"
          disabled={creating}
        >
          <span aria-hidden="true">↑</span>
        </button>
      </form>
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

function UniversalFolderContents({
  blog,
  folder,
  handle,
  items,
  canCreateItems,
  canEditItems,
  onCreateItem,
  onCaptureResolved,
  onDeleteItem,
  onItemClick,
  onOpenPost,
  onOpenTag,
  onSelectPost,
  selectedPostId,
  selectedPostIds,
  viewMode,
}: {
  blog: Blog;
  folder: Folder;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
  onCreateItem?: FolderCreateItem;
  onCaptureResolved?: FolderCaptureResolved;
  onDeleteItem?: FolderDeleteItem;
  onItemClick?: (postId: string, event: MouseEvent<HTMLElement>) => boolean;
  onOpenPost?: (post: Post) => void;
  onOpenTag?: (tag: string) => void;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
  selectedPostIds?: ReadonlySet<string>;
  viewMode: FolderViewMode;
}) {
  // The folder's default template can declare filters and sort over custom
  // fields. When it does, that spec drives the folder view; when it does not,
  // the historical most-recent-first order stands. Pinned stays the outermost
  // order either way: pin is a personal "keep on top" that outranks any
  // template opinion.
  const collectionDefinition = useMemo(() => {
    const reference = defaultTemplateForFolder(folder);
    return getBuiltinTemplate(reference.id, reference.version);
  }, [folder]);
  const collectionSpec = useMemo(() => {
    if (!collectionDefinition) return null;
    const { sort, filters } = collectionDefinition.collection;
    return sort.length > 0 || filters.length > 0 ? { sort, filters } : null;
  }, [collectionDefinition]);
  const sorted = useMemo(() => {
    if (!collectionSpec) {
      return sortedByTimestampDesc(items, (post) => post.updatedAt ?? post.date ?? "");
    }
    const shaped = applyCollectionSpec(
      items.map((post) => ({
        post,
        createdAt: post.date ?? null,
        updatedAt: post.updatedAt ?? post.date ?? null,
        publishedAt: post.status === "published" ? (post.date ?? null) : null,
        title: post.title,
        fields: post.document?.content.fields ?? {},
      })),
      collectionSpec,
    ).map((entry) => entry.post);
    return [...shaped].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      }
      return 0; // stable within pin groups; applyCollectionSpec already ordered
    });
  }, [collectionSpec, items]);

  // A calendar folder places items on a month grid by the template's dateBy
  // date field. The offset is which month is showing, relative to now.
  const [calendarOffset, setCalendarOffset] = useState(0);
  const calendar = useMemo(() => {
    const collection = collectionDefinition?.collection;
    if (!collection || collection.layout !== "calendar" || !collection.dateBy) {
      return null;
    }
    const fieldId = collection.dateBy.slice("content.fields.".length);
    const field = collectionDefinition?.fields.find(
      (entry) => entry.id === fieldId,
    );
    if (!field || field.type !== "date") return null;
    const byDay = new Map<string, typeof sorted>();
    const undated: typeof sorted = [];
    for (const post of sorted) {
      const value = post.document?.content.fields[fieldId];
      const key =
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
          ? value.slice(0, 10)
          : null;
      if (!key) {
        undated.push(post);
        continue;
      }
      const list = byDay.get(key) ?? [];
      list.push(post);
      byDay.set(key, list);
    }
    return { byDay, undated };
  }, [collectionDefinition, sorted]);

  // A heatmap folder shows a trailing year of activity as one cell per day,
  // shaded by how many items carry that date, with the normal list below.
  const heatmap = useMemo(() => {
    const collection = collectionDefinition?.collection;
    if (!collection || collection.layout !== "heatmap" || !collection.dateBy) {
      return null;
    }
    const fieldId = collection.dateBy.slice("content.fields.".length);
    const field = collectionDefinition?.fields.find(
      (entry) => entry.id === fieldId,
    );
    if (!field || field.type !== "date") return null;
    const counts = new Map<string, number>();
    for (const post of sorted) {
      const value = post.document?.content.fields[fieldId];
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const key = value.slice(0, 10);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return { counts };
  }, [collectionDefinition, sorted]);

  // A board folder groups its items into one column per option of the
  // template's groupBy enum, in declared option order, with an Unsorted
  // column for items that have no value yet.
  const board = useMemo(() => {
    const collection = collectionDefinition?.collection;
    if (!collection || collection.layout !== "board" || !collection.groupBy) {
      return null;
    }
    const fieldId = collection.groupBy.slice("content.fields.".length);
    const field = collectionDefinition?.fields.find(
      (entry) => entry.id === fieldId,
    );
    if (!field || field.type !== "enum") return null;
    const valueOf = (post: (typeof sorted)[number]) => {
      const value = post.document?.content.fields[fieldId];
      return typeof value === "string" ? value : null;
    };
    const known = new Set(field.options.map((option) => option.value));
    const columns = field.options.map((option) => ({
      value: option.value,
      label: option.label,
      tone: option.tone ?? "neutral",
      icon: option.icon,
      posts: sorted.filter((post) => valueOf(post) === option.value),
    }));
    const unsorted = sorted.filter((post) => {
      const value = valueOf(post);
      return value === null || !known.has(value);
    });
    return { columns, unsorted };
  }, [collectionDefinition, sorted]);

  return (
    <>
      {canCreateItems && (
        <UniversalItemComposer
          blog={blog}
          folder={folder}
          handle={handle}
          onCreateItem={onCreateItem}
        />
      )}
      <section className="post-folder-page-items" aria-label="Folder items">
        {sorted.length === 0 ? (
          <FolderEmptyCard
            actionLabel={canCreateItems ? "Create an item" : undefined}
            onAction={
              canCreateItems
                ? () =>
                    dispatchFolderUiEvent(CREATE_FOLDER_ITEM_EVENT, folder.id)
                : undefined
            }
          >
            Nothing here yet.
          </FolderEmptyCard>
        ) : folder.mode === "bookmarks" ? (
          <div
            className={`bookmark-folder-collection is-${viewMode}`}
            role="listbox"
            aria-label="Bookmarks"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {sorted.map((post) => {
              const selected = Boolean(
                post.id &&
                  (selectedPostIds?.has(post.id) ??
                    post.id === selectedPostId),
              );
              return (
                <BookmarkCard
                  key={itemKey(post)}
                  post={post}
                  editPath={blogPostPath(blog, post)}
                  handle={handle}
                  owner={canEditItems}
                  selected={selected}
                  viewMode={viewMode}
                  optionId={postOptionId(post.id)}
                  optionTabIndex={post.id === selectedPostId ? 0 : -1}
                  onCaptureResolved={onCaptureResolved}
                  onDeletePost={onDeleteItem}
                  onOpenPost={onOpenPost}
                  onOpenTag={onOpenTag}
                  onSelect={() => post.id && onSelectPost?.(post.id)}
                  onItemClick={(event) =>
                    post.id
                      ? (onItemClick?.(post.id, event) ?? true)
                      : true
                  }
                />
              );
            })}
          </div>
        ) : folder.mode === "blog" ? (
          <div
            className="blog-folder-feed"
            role="listbox"
            aria-label="Blog posts"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {sorted.map((post) => {
              const selected = Boolean(
                post.id &&
                  (selectedPostIds?.has(post.id) ??
                    post.id === selectedPostId),
              );
              const preview = previewLine(
                post.excerpt || postBodyPreview(post),
              );
              const cover = resolveCoverSource(post).src;
              return (
                <article
                  key={itemKey(post)}
                  id={postOptionId(post.id)}
                  className={`blog-folder-feed-item${
                    cover ? "" : " is-no-cover"
                  }${selected ? " is-command-selected" : ""}`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={post.id === selectedPostId ? 0 : -1}
                  data-workspace-post-id={post.id}
                  onFocus={() => post.id && onSelectPost?.(post.id)}
                  onMouseDown={(event) => {
                    if (shouldSuppressNativeItemSelection(event)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <div className="blog-folder-feed-star">
                    <WorkspaceItemStar
                      handle={handle}
                      owner={canEditItems}
                      post={post}
                    />
                  </div>
                  <Link
                    className="blog-folder-feed-link"
                    href={blogPostPath(blog, post)}
                    prefetch={onOpenPost ? false : undefined}
                    onClick={(event) => {
                      if (
                        post.id &&
                        onItemClick &&
                        !onItemClick(post.id, event)
                      ) {
                        event.preventDefault();
                        return;
                      }
                      if (!onOpenPost || !shouldOpenLocally(event)) return;
                      event.preventDefault();
                      onOpenPost(post);
                    }}
                  >
                    <span className="blog-folder-feed-copy">
                      <span className="blog-folder-feed-meta">
                        {formatArticleDate(post.updatedAt ?? post.date, {
                          style: "short",
                        })}
                      </span>
                      <span className="blog-folder-feed-title">
                        {itemTitle(post)}
                      </span>
                      {preview && (
                        <span className="blog-folder-feed-excerpt">
                          {preview}
                        </span>
                      )}
                    </span>
                    {cover && (
                      <span className="blog-folder-feed-cover" aria-hidden="true">
                        {isVideoFile(cover) ? (
                          <video
                            src={cover}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          // User media can be remote, so plain img avoids config.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" decoding="async" />
                        )}
                      </span>
                    )}
                  </Link>
                  <TagChips
                    blog={blog}
                    className="blog-folder-feed-tags"
                    onOpenTag={onOpenTag}
                    tags={post.tags}
                  />
                  {canEditItems && (
                    <div className="blog-folder-feed-actions">
                      <WorkspaceItemActions
                        blog={blog}
                        handle={handle}
                        href={blogPostPath(blog, post)}
                        owner
                        post={post}
                        onDeletePost={onDeleteItem}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : viewMode === "list" ? (
          <div
            className="post-folder-list"
            role="listbox"
            aria-label="Folder items"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {sorted.map((post) => {
              const preview = previewLine(
                post.excerpt || postBodyPreview(post),
              );
              const selected = Boolean(
                post.id &&
                  (selectedPostIds?.has(post.id) ??
                    post.id === selectedPostId),
              );
              return (
                <div
                  key={itemKey(post)}
                  id={postOptionId(post.id)}
                  className={`post-folder-row-shell${
                    selected ? " is-command-selected" : ""
                  }`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={post.id === selectedPostId ? 0 : -1}
                  data-workspace-post-id={post.id}
                  onFocus={() => post.id && onSelectPost?.(post.id)}
                >
                  <WorkspaceItemStar
                    handle={handle}
                    owner={canEditItems}
                    post={post}
                  />
                  <Link
                    className="post-folder-row"
                    href={blogPostPath(blog, post)}
                    prefetch={onOpenPost ? false : undefined}
                    onMouseDown={(event) => {
                      if (shouldSuppressNativeItemSelection(event)) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => {
                      if (
                        post.id &&
                        onItemClick &&
                        !onItemClick(post.id, event)
                      ) {
                        event.preventDefault();
                        return;
                      }
                      if (!onOpenPost || !shouldOpenLocally(event)) return;
                      event.preventDefault();
                      onOpenPost(post);
                    }}
                  >
                    <span className="post-folder-row-title">
                      {itemTitle(post)}
                    </span>
                    <span className="post-folder-row-meta">
                      {post.captureStatus === "pending"
                        ? "Saving"
                        : formatArticleDate(post.updatedAt ?? post.date, {
                            style: "short",
                          })}
                    </span>
                    {preview && (
                      <span className="post-folder-row-excerpt">{preview}</span>
                    )}
                  </Link>
                  <TagChips
                    blog={blog}
                    className="post-folder-row-tags"
                    onOpenTag={onOpenTag}
                    tags={post.tags}
                  />
                  {canEditItems && (
                    <WorkspaceItemActions
                      blog={blog}
                      handle={handle}
                      href={blogPostPath(blog, post)}
                      owner
                      post={post}
                      onDeletePost={onDeleteItem}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (() => {
          const renderUniversalCard = (post: (typeof sorted)[number]) => {
            const selected = Boolean(
              post.id &&
                (selectedPostIds?.has(post.id) ??
                  post.id === selectedPostId),
            );
            const isNote = folder.mode === "notes";
            const document = post.document ?? documentFromLegacyPost(post);
            const reference = post.template ?? document.presentation.template;
            const definition =
              getBuiltinTemplate(reference.id, reference.version) ??
              getBuiltinTemplate("texttext.article", 1)!;
            const notePreview = expandedPreview(
              postBodyPreview(post) || post.excerpt || "",
            );
            return (
              <div
                key={itemKey(post)}
                id={postOptionId(post.id)}
                className={`universal-item-card${isNote ? " is-note-card" : ""}${
                  selected ? " is-command-selected" : ""
                }`}
                role="option"
                aria-selected={selected}
                tabIndex={post.id === selectedPostId ? 0 : -1}
                data-workspace-post-id={post.id}
                onFocus={() => post.id && onSelectPost?.(post.id)}
                onPointerMove={updateSpatialCardTilt}
                onPointerLeave={resetSpatialCardTilt}
              >
                <WorkspaceItemStar
                  handle={handle}
                  owner={canEditItems}
                  post={post}
                />
                <Link
                  className="universal-item-card-link"
                  href={blogPostPath(blog, post)}
                  prefetch={onOpenPost ? false : undefined}
                  onMouseDown={(event) => {
                    if (shouldSuppressNativeItemSelection(event)) {
                      event.preventDefault();
                    }
                  }}
                  onClick={(event) => {
                    if (
                      post.id &&
                      onItemClick &&
                      !onItemClick(post.id, event)
                    ) {
                      event.preventDefault();
                      return;
                    }
                    if (!onOpenPost || !shouldOpenLocally(event)) return;
                    event.preventDefault();
                    onOpenPost(post);
                  }}
                >
                  {isNote ? (
                    <span className="note-folder-card-content">
                      <span className="note-folder-card-title">
                        {itemTitle(post)}
                      </span>
                      {notePreview && (
                        <span className="note-folder-card-preview">
                          {notePreview}
                        </span>
                      )}
                      <span className="note-folder-card-date">
                        {formatArticleDate(post.updatedAt ?? post.date, {
                          style: "short",
                        })}
                      </span>
                    </span>
                  ) : (
                    <DocumentCollectionRenderer
                      document={document}
                      template={definition}
                      documentId={`collection-${post.id ?? post.slug}`}
                      metadata={{
                        date: formatArticleDate(post.updatedAt ?? post.date, {
                          style: "short",
                        }),
                      }}
                    />
                  )}
                </Link>
                {canEditItems && (
                  <WorkspaceItemActions
                    blog={blog}
                    handle={handle}
                    href={blogPostPath(blog, post)}
                    owner
                    post={post}
                    onDeletePost={onDeleteItem}
                  />
                )}
              </div>
            );
          };
          if (heatmap) {
            const today = new Date();
            const pad = (value: number) => String(value).padStart(2, "0");
            const start = new Date(today);
            start.setDate(start.getDate() - 364);
            start.setDate(start.getDate() - start.getDay());
            const days: { key: string; count: number }[] = [];
            const cursor = new Date(start);
            while (cursor <= today) {
              const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
              days.push({ key, count: heatmap.counts.get(key) ?? 0 });
              cursor.setDate(cursor.getDate() + 1);
            }
            const level = (count: number) =>
              count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3;
            return (
              <>
                <div
                  className="universal-item-heatmap"
                  aria-label="A year of writing activity"
                >
                  {days.map((day) => (
                    <span
                      key={day.key}
                      className={`universal-item-heatmap-cell is-l${level(day.count)}`}
                      title={
                        day.count > 0
                          ? `${day.key} · ${day.count} ${day.count === 1 ? "entry" : "entries"}`
                          : day.key
                      }
                    />
                  ))}
                </div>
                <div
                  className={`universal-item-collection is-${viewMode}`}
                  role="listbox"
                  aria-label="Folder items"
                  aria-activedescendant={postOptionId(selectedPostId)}
                >
                  <DocumentEngineStyles />
                  {sorted.map(renderUniversalCard)}
                </div>
              </>
            );
          }
          if (calendar) {
            const now = new Date();
            const anchor = new Date(
              now.getFullYear(),
              now.getMonth() + calendarOffset,
              1,
            );
            const monthLabel = anchor.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            });
            const pad = (value: number) => String(value).padStart(2, "0");
            const dayKey = (year: number, month: number, day: number) =>
              `${year}-${pad(month + 1)}-${pad(day)}`;
            const todayKey = dayKey(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
            );
            const daysInMonth = new Date(
              anchor.getFullYear(),
              anchor.getMonth() + 1,
              0,
            ).getDate();
            const cells: { key: string | null; day: number | null }[] = [];
            for (let blank = 0; blank < anchor.getDay(); blank += 1) {
              cells.push({ key: null, day: null });
            }
            for (let day = 1; day <= daysInMonth; day += 1) {
              cells.push({
                key: dayKey(anchor.getFullYear(), anchor.getMonth(), day),
                day,
              });
            }
            return (
              <div className="universal-item-calendar" aria-label="Folder calendar">
                <header className="universal-item-calendar-bar">
                  <button
                    type="button"
                    onClick={() => setCalendarOffset((offset) => offset - 1)}
                    aria-label="Previous month"
                  >
                    &lsaquo;
                  </button>
                  <h2>{monthLabel}</h2>
                  <button
                    type="button"
                    onClick={() => setCalendarOffset((offset) => offset + 1)}
                    aria-label="Next month"
                  >
                    &rsaquo;
                  </button>
                </header>
                <div className="universal-item-calendar-grid">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (weekday) => (
                      <div
                        key={weekday}
                        className="universal-item-calendar-dow"
                        aria-hidden="true"
                      >
                        {weekday}
                      </div>
                    ),
                  )}
                  {cells.map((cell, index) => (
                    <div
                      key={cell.key ?? `blank-${index}`}
                      className={`universal-item-calendar-cell${
                        cell.key === todayKey ? " is-today" : ""
                      }${cell.day === null ? " is-blank" : ""}`}
                    >
                      {cell.day !== null ? (
                        <span className="universal-item-calendar-daynum">
                          {cell.day}
                        </span>
                      ) : null}
                      {cell.key
                        ? (calendar.byDay.get(cell.key) ?? []).map((post) => (
                            <Link
                              key={itemKey(post)}
                              className="universal-item-calendar-chip"
                              href={blogPostPath(blog, post)}
                              onClick={(event) => {
                                if (!onOpenPost || !shouldOpenLocally(event)) {
                                  return;
                                }
                                event.preventDefault();
                                onOpenPost(post);
                              }}
                            >
                              {post.title || "Untitled"}
                            </Link>
                          ))
                        : null}
                    </div>
                  ))}
                </div>
                {calendar.undated.length > 0 ? (
                  <div className="universal-item-calendar-undated">
                    <h3>Undated</h3>
                    <div>
                      {calendar.undated.map((post) => (
                        <Link
                          key={itemKey(post)}
                          className="universal-item-calendar-chip"
                          href={blogPostPath(blog, post)}
                          onClick={(event) => {
                            if (!onOpenPost || !shouldOpenLocally(event)) return;
                            event.preventDefault();
                            onOpenPost(post);
                          }}
                        >
                          {post.title || "Untitled"}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }
          if (board) {
            const boardColumns = [
              ...board.columns,
              ...(board.unsorted.length > 0
                ? [
                    {
                      value: "__unsorted",
                      label: "Unsorted",
                      tone: "neutral",
                      icon: undefined as string | undefined,
                      posts: board.unsorted,
                    },
                  ]
                : []),
            ];
            return (
              <div
                className="universal-item-board"
                role="listbox"
                aria-label="Folder board"
                aria-activedescendant={postOptionId(selectedPostId)}
              >
                <DocumentEngineStyles />
                {boardColumns.map((column) => (
                  <section
                    key={column.value}
                    className="universal-item-board-column"
                    aria-label={column.label}
                  >
                    <header
                      className={`universal-item-board-header is-tone-${column.tone}`}
                    >
                      <span
                        className="universal-item-board-dot"
                        aria-hidden="true"
                      />
                      {column.icon ? (
                        <span aria-hidden="true">{column.icon}</span>
                      ) : null}
                      <span>{column.label}</span>
                      <small>{column.posts.length}</small>
                    </header>
                    {column.posts.map(renderUniversalCard)}
                  </section>
                ))}
              </div>
            );
          }
          return (
            <div
              className={`universal-item-collection is-${viewMode}`}
              role="listbox"
              aria-label="Folder items"
              aria-activedescendant={postOptionId(selectedPostId)}
            >
              <DocumentEngineStyles />
              {sorted.map(renderUniversalCard)}
            </div>
          );
        })()}
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
  onItemClick,
  onOpenPost,
  onOpenTag,
  createBookmarkRequestKey,
  editRequestKey = 0,
  searchFocusRequestKey = 0,
  onSelectPost,
  selectedPostId,
  selectedPostIds,
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
  onItemClick?: (postId: string, event: MouseEvent<HTMLElement>) => boolean;
  onOpenPost?: (post: Post) => void;
  onOpenTag?: (tag: string) => void;
  createBookmarkRequestKey?: number;
  editRequestKey?: number;
  searchFocusRequestKey?: number;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
  selectedPostIds?: ReadonlySet<string>;
  onDeleteFolder?: FolderDeleteFolder;
  canShareFolders?: boolean;
}) {
  const defaultViewMode: FolderViewMode =
    folder.mode === "notes" || folder.mode === "bookmarks" ? "list" : "grid";
  const [viewMode, changeView] = useWorkspaceViewMode(
    `folder:v3:${folder.id}`,
    defaultViewMode,
  );
  const [filterQuery, setFilterQuery] = useState("");
  const lastCreateRequestKey = useRef(createBookmarkRequestKey ?? 0);
  const lastEditRequestKey = useRef(editRequestKey);

  useEffect(() => {
    const applyFilter = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: unknown }>).detail;
      const query =
        typeof detail?.query === "string" ? detail.query.trim() : "";
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
    window.addEventListener("texttext:filter-current-folder", applyFilter);
    return () =>
      window.removeEventListener("texttext:filter-current-folder", applyFilter);
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
      : null;

  return (
    <main
      className={`post-folder-page is-mode-${folder.mode} is-view-${viewMode}`}
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
        onCreate={() =>
          dispatchFolderUiEvent(CREATE_FOLDER_ITEM_EVENT, folder.id)
        }
        onRename={() =>
          dispatchFolderUiEvent(EDIT_FOLDER_TITLE_EVENT, folder.id)
        }
        searchFocusRequestKey={searchFocusRequestKey}
        searchValue={filterQuery}
        onSearchValueChange={setFilterQuery}
        onDeleteFolder={onDeleteFolder}
      />
      <header className="post-folder-page-header">
        <FolderTitleEditor
          folder={folder}
          handle={handle}
          canEdit={canEditItems}
        />
        <p className="post-folder-page-count">
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
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
      <UniversalFolderContents
        blog={blog}
        folder={folder}
        handle={handle}
        items={filteredItems}
        canCreateItems={canCreateItems}
        canEditItems={canEditItems}
        onCreateItem={onCreateItem}
        onCaptureResolved={onCaptureResolved}
        onDeleteItem={onDeleteItem}
        onItemClick={onItemClick}
        onOpenPost={onOpenPost}
        onOpenTag={onOpenTag}
        onSelectPost={onSelectPost}
        selectedPostId={visibleSelectedPostId}
        selectedPostIds={selectedPostIds}
        viewMode={viewMode}
      />
    </main>
  );
}
