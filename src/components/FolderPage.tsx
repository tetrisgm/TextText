
"use client";

/**
 * Windowed rows for the folder's long list layouts: only the viewport's rows
 * (plus overscan) are mounted, between two spacer divs sized from a measured
 * average row height. Mounting every row made switching into a large folder
 * pay ~0.5ms per item, and every re-render walk the full set. The selected
 * row is always materialized - the window follows selection the way the
 * editor's window follows the caret. content-visibility is NOT an
 * alternative here; it is banned in this codebase for cause.
 */
function WindowedRows<T>({
  items,
  selectedIndex,
  overscan = 10,
  children,
}: {
  items: readonly T[];
  selectedIndex: number | null;
  overscan?: number;
  children: (item: T, index: number) => ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const rowPxRef = useRef(72);
  const [span, setSpan] = useState({ start: 0, end: Math.min(items.length, 40) });
  // Derived-state correction during render: the selected row must exist in
  // the DOM before the shell's scroll-into-view effect looks for it.
  if (selectedIndex !== null && items.length > 0) {
    const width = Math.max(span.end - span.start, 30);
    if (selectedIndex < span.start || selectedIndex >= span.end) {
      const start = Math.max(0, selectedIndex - Math.floor(width / 2));
      setSpan({ start, end: Math.min(items.length, start + width) });
    }
  }
  if (span.end > items.length) {
    setSpan({
      start: Math.max(0, Math.min(span.start, items.length - 1)),
      end: items.length,
    });
  }
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const scroller = anchor.closest(".post-editor-content");
    if (!(scroller instanceof HTMLElement)) return;
    let raf = 0;
    const recompute = () => {
      raf = 0;
      const px = rowPxRef.current;
      const listTop =
        anchor.getBoundingClientRect().top +
        scroller.scrollTop -
        scroller.getBoundingClientRect().top;
      const first = Math.max(
        0,
        Math.floor((scroller.scrollTop - listTop) / px),
      );
      const visible = Math.ceil(scroller.clientHeight / px) + 1;
      const start = Math.max(0, first - overscan);
      const end = Math.min(items.length, first + visible + overscan);
      setSpan((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };
    recompute();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items.length, overscan]);
  // Refine the estimate from what actually rendered; the spacers re-size on
  // the next window move, and being an average, drift self-corrects.
  useEffect(() => {
    const anchor = anchorRef.current;
    const parent = anchor?.parentElement;
    if (!anchor || !parent) return;
    const nodes = parent.children;
    const anchorIndex = Array.prototype.indexOf.call(nodes, anchor);
    const firstRow = nodes[anchorIndex + 1];
    const lastRow = nodes[nodes.length - 2];
    const count = span.end - span.start;
    if (!firstRow || !lastRow || count < 1 || firstRow === lastRow) return;
    const top = firstRow.getBoundingClientRect().top;
    const bottom = lastRow.getBoundingClientRect().bottom;
    const px = (bottom - top) / count;
    if (px > 8 && Number.isFinite(px)) rowPxRef.current = px;
  });
  const px = rowPxRef.current;
  return (
    <>
      <div
        ref={anchorRef}
        aria-hidden="true"
        style={{ height: Math.round(span.start * px) }}
      />
      {items.slice(span.start, span.end).map((item, offset) =>
        children(item, span.start + offset),
      )}
      <div
        aria-hidden="true"
        style={{ height: Math.round((items.length - span.end) * px) }}
      />
    </>
  );
}

/**
 * Progressive mount for the folder's card layouts (bookmark cards, the
 * universal card grid). True windowing needs uniform row heights; a
 * multi-column card grid has neither uniform heights nor single-column flow,
 * so instead the grid mounts a first page and appends as an
 * IntersectionObserver sentinel nears the viewport. Nothing above unmounts -
 * the cost being cut is the initial mount of hundreds of rendered cards, not
 * steady-state DOM size. The selected card is always mounted so keyboard
 * selection and scroll-into-view keep working past the mounted edge.
 */
function GrowingGrid<T>({
  items,
  selectedIndex,
  initial = 60,
  step = 60,
  children,
}: {
  items: readonly T[];
  selectedIndex: number | null;
  initial?: number;
  step?: number;
  children: (item: T) => ReactNode;
}) {
  const [count, setCount] = useState(initial);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const needed = selectedIndex !== null ? selectedIndex + 1 : 0;
  const shown = Math.min(items.length, Math.max(count, needed));
  useEffect(() => {
    if (shown >= items.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver !== "function") {
      setCount(items.length);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((prev) =>
            Math.min(items.length, Math.max(prev, shown) + step),
          );
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, shown, step]);
  return (
    <>
      {items.slice(0, shown).map(children)}
      {shown < items.length ? (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          style={{ gridColumn: "1 / -1", height: 1 }}
        />
      ) : null}
    </>
  );
}

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
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { isNewTabClick } from "@/lib/workspace/selection-modifiers";
import dynamic from "next/dynamic";
import Link from "next/link";
import { renameFolderAction } from "@/app/editor/actions";
import { BookmarkCard } from "@/components/bookmarks/BookmarkCard";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { DocumentEngineStyles } from "@/components/document/DocumentEngineStyles";
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
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  displayModeForCollectionView,
  selectCollectionView,
} from "@/lib/presentation/collection-views";
import { blogPostPath } from "@/lib/public-paths";
import { updateFolder } from "@/lib/pool/store";
import { shouldSuppressNativeItemSelection } from "@/lib/workspace-selection";
import {
  CREATE_FOLDER_ITEM_EVENT,
  EDIT_FOLDER_TITLE_EVENT,
  UniversalItemComposer,
  actionErrorMessage,
  defaultTemplateForFolder,
  dispatchFolderUiEvent,
  isFolderUiEvent,
  type FolderCaptureResolved,
  type FolderCreateItem,
  type FolderDeleteItem,
} from "@/components/workspace/UniversalItemComposer";


// Loaded on demand: only a folder whose items render as a collection needs
// the document renderer, and with it react-markdown. The list path itself
// never parses Markdown.
const DocumentCollectionRenderer = dynamic(() =>
  import("@/components/document/DocumentRenderer").then(
    (module) => module.DocumentCollectionRenderer,
  ),
);

type FolderViewMode = WorkspaceViewMode;
type FolderDeleteFolder = (folder: Folder) => Promise<void> | void;
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

/** The tooltip on a row: the gestures that do something to it. */
const ROW_HOVER_HINT =
  "Open  ·  \u2318 click: new tab  ·  \u2325 click: add to selection  ·  \u21e7 click: extend";

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

/**
 * The engine's spacing tokens as lengths. The container is not a
 * `.tt-document`, so the `--tt-gap-*` custom properties are not in scope on
 * it and a look's declared gap has to arrive as a value.
 */
const COLLECTION_GAP: Record<string, string> = {
  none: "0",
  xs: "0.35rem",
  sm: "0.75rem",
  md: "1.25rem",
  lg: "2rem",
  xl: "3.5rem",
};

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
  onOpenPostInNewTab,
  onDragItems,
  onOpenTag,
  onSelectPost,
  availableTemplates,
  selectedPostId,
  selectedPostIds,
  viewMode,
}: {
  availableTemplates?: readonly TemplateDefinition[];
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
  /** Cmd/Ctrl or middle click: open the document as a background tab. */
  onOpenPostInNewTab?: (postId: string) => void;
  /** Fill a drag with the items being moved. */
  onDragItems?: (transfer: DataTransfer, postId: string) => void;
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
  // A look may be one the workspace authored rather than a built-in. Resolving
  // only built-ins meant an AI-made look was silently ignored on this page:
  // the index kept the default order while its cards fell all the way back to
  // Article, so a folder someone had just restyled looked untouched.
  const resolveTemplate = useCallback(
    (reference: TemplateReference) =>
      availableTemplates?.find(
        (entry) =>
          entry.id === reference.id && entry.version === reference.version,
      ) ?? getBuiltinTemplate(reference.id, reference.version),
    [availableTemplates],
  );
  const collectionDefinition = useMemo(
    () => resolveTemplate(defaultTemplateForFolder(folder)),
    [folder, resolveTemplate],
  );
  const savedViews = useMemo(
    () => collectionDefinition?.collection.views ?? [],
    [collectionDefinition],
  );
  const initialSavedView = collectionDefinition?.collection.defaultView ?? "";
  const [savedViewId, setSavedViewId] = useState(initialSavedView);
  const savedViewFolder = useRef(folder.id);
  const savedViewKey = savedViews.map((view) => view.id).join("\u0000");
  useEffect(() => {
    const next = collectionDefinition?.collection.defaultView ?? "";
    const folderChanged = savedViewFolder.current !== folder.id;
    savedViewFolder.current = folder.id;
    setSavedViewId((current) => {
      if (folderChanged) return next;
      return current && savedViews.some((view) => view.id === current)
        ? current
        : next;
    });
  }, [
    collectionDefinition?.collection.defaultView,
    folder.id,
    savedViewKey,
    savedViews,
  ]);
  const selectedSavedView = savedViews.find((view) => view.id === savedViewId);
  const activeCollection = useMemo(() => {
    const base = collectionDefinition?.collection;
    return base
      ? selectCollectionView(base, selectedSavedView?.id ?? "")
      : base;
  }, [collectionDefinition, selectedSavedView?.id]);
  /**
   * Does this folder still wear a look that ships with the app?
   *
   * The hand-made row renderers below - the blog feed and the list rows - were
   * drawn for the built-ins and ignore a template entirely. They stay the fast
   * path for a folder that has not been restyled. The moment a folder carries
   * a look someone authored, the template renders the index, or the look
   * reaches the item pages and stops at its own folder.
   */
  const usesBuiltInLook = useMemo(
    () => defaultTemplateForFolder(folder).id.startsWith("texttext."),
    [folder],
  );
  const collectionSpec = useMemo(() => {
    if (!activeCollection) return null;
    const { sort, filters } = activeCollection;
    return sort.length > 0 || filters.length > 0 ? { sort, filters } : null;
  }, [activeCollection]);
  const sorted = useMemo(() => {
    if (!collectionSpec) {
      return sortedByTimestampDesc(
        items,
        (post) => post.updatedAt ?? post.date ?? "",
      );
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
  const selectedRowIndex = useMemo(() => {
    if (!selectedPostId) return null;
    const index = sorted.findIndex((post) => post.id === selectedPostId);
    return index === -1 ? null : index;
  }, [selectedPostId, sorted]);

  const calendar = useMemo(() => {
    const collection = activeCollection;
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
  }, [activeCollection, collectionDefinition, sorted]);

  // A heatmap folder shows a trailing year of activity as one cell per day,
  // shaded by how many items carry that date, with the normal list below.
  const heatmap = useMemo(() => {
    const collection = activeCollection;
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
  }, [activeCollection, collectionDefinition, sorted]);

  // A board folder groups its items into one column per option of the
  // template's groupBy enum, in declared option order, with an Unsorted
  // column for items that have no value yet.
  const board = useMemo(() => {
    const collection = activeCollection;
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
  }, [activeCollection, collectionDefinition, sorted]);
  const collectionViewMode: FolderViewMode = displayModeForCollectionView(
    selectedSavedView,
    viewMode,
  );

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
      {savedViews.length > 0 ? (
        <label className="post-folder-saved-view">
          <span>View</span>
          <select
            aria-label="Folder view"
            value={savedViewId}
            onChange={(event) => setSavedViewId(event.currentTarget.value)}
          >
            {!collectionDefinition?.collection.defaultView ? (
              <option value="">Main</option>
            ) : null}
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
        ) : folder.mode === "bookmarks" && usesBuiltInLook ? (
          <div
            className={`bookmark-folder-collection is-${viewMode}`}
            role="listbox"
            aria-label="Bookmarks"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            <GrowingGrid items={sorted} selectedIndex={selectedRowIndex}>
              {(post) => {
              const selected = Boolean(
                post.id &&
                (selectedPostIds?.has(post.id) ?? post.id === selectedPostId),
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
                  onOpenPostInNewTab={onOpenPostInNewTab}
                  onDragItems={onDragItems}
                  onOpenTag={onOpenTag}
                  onSelect={() => post.id && onSelectPost?.(post.id)}
                  onItemClick={(event) =>
                    post.id ? (onItemClick?.(post.id, event) ?? true) : true
                  }
                />
              );
              }}
            </GrowingGrid>
          </div>
        ) : folder.mode === "blog" && usesBuiltInLook ? (
          // The stock blog feed is hardcoded markup that predates the document
          // engine, so it renders the same whatever look the folder carries.
          // It stays as the fast path for a folder still on the built-in
          // Article look, which is what it was drawn for; give the folder any
          // other look - including one an agent just authored - and the
          // template drives the index instead. Expressing this feed as
          // `article.collection` would remove the branch entirely.
          <div
            className="blog-folder-feed"
            role="listbox"
            aria-label="Blog posts"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            <WindowedRows items={sorted} selectedIndex={selectedRowIndex}>
              {(post) => {
              const selected = Boolean(
                post.id &&
                (selectedPostIds?.has(post.id) ?? post.id === selectedPostId),
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
                      // Cmd click opens a background tab, the way it opens a
                      // link anywhere else. Option is what toggles selection,
                      // so the two never collide. BEFORE the selection
                      // handler: opening a tab should not also move what is
                      // selected.
                      if (post.id && onOpenPostInNewTab && isNewTabClick(event)) {
                        event.preventDefault();
                        onOpenPostInNewTab(post.id);
                        return;
                      }
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
                    onAuxClick={(event) => {
                      // Middle click, same as everywhere else.
                      if (event.button !== 1 || !post.id) return;
                      if (!onOpenPostInNewTab) return;
                      event.preventDefault();
                      onOpenPostInNewTab(post.id);
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
                      <span
                        className="blog-folder-feed-cover"
                        aria-hidden="true"
                      >
                        {isVideoFile(cover) ? (
                          <video
                            src={cover}
                            muted
                            playsInline
                            preload="none"
                          />
                        ) : (
                          // User media can be remote, so plain img avoids config.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={cover}
                            alt=""
                            decoding="async"
                            loading="lazy"
                          />
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
              }}
            </WindowedRows>
          </div>
        ) : viewMode === "list" && usesBuiltInLook ? (
          <div
            className="post-folder-list workspace-folder-row-list"
            role="listbox"
            aria-label="Folder items"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            <WindowedRows items={sorted} selectedIndex={selectedRowIndex}>
              {(post) => {
              const preview = previewLine(
                post.excerpt || postBodyPreview(post),
              );
              const selected = Boolean(
                post.id &&
                (selectedPostIds?.has(post.id) ?? post.id === selectedPostId),
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
                    // Draggable only once selected: an unselected row keeps
                    // the rubber-band, and a selected one moves. Both
                    // gestures cannot start from the same pixel, because the
                    // browser's own drag preempts the marquee.
                    draggable={selected}
                    onDragStart={(event) => {
                      if (!post.id) return;
                      onDragItems?.(event.dataTransfer, post.id);
                    }}
                    // What the keys do here, on hover, as the owner asked.
                    title={ROW_HOVER_HINT}
                    prefetch={onOpenPost ? false : undefined}
                    onMouseDown={(event) => {
                      if (shouldSuppressNativeItemSelection(event)) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => {
                      // Cmd click opens a background tab, the way it opens a
                      // link anywhere else. Option is what toggles selection,
                      // so the two never collide. BEFORE the selection
                      // handler: opening a tab should not also move what is
                      // selected.
                      if (post.id && onOpenPostInNewTab && isNewTabClick(event)) {
                        event.preventDefault();
                        onOpenPostInNewTab(post.id);
                        return;
                      }
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
                    onAuxClick={(event) => {
                      // Middle click, same as everywhere else.
                      if (event.button !== 1 || !post.id) return;
                      if (!onOpenPostInNewTab) return;
                      event.preventDefault();
                      onOpenPostInNewTab(post.id);
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
              }}
            </WindowedRows>
          </div>
        ) : (
          (() => {
            const renderUniversalCard = (post: (typeof sorted)[number]) => {
              const selected = Boolean(
                post.id &&
                (selectedPostIds?.has(post.id) ?? post.id === selectedPostId),
              );
              // A note card is hand-made chrome for the built-in Note look.
              // Once the folder carries an authored look, the template draws the row.
              const isNote = folder.mode === "notes" && usesBuiltInLook;
              const document = post.document ?? documentFromLegacyPost(post);
              const reference = post.template ?? document.presentation.template;
              const definition =
                resolveTemplate(reference) ??
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
                    // Draggable only once selected: an unselected row keeps
                    // the rubber-band, and a selected one moves. Both
                    // gestures cannot start from the same pixel, because the
                    // browser's own drag preempts the marquee.
                    draggable={selected}
                    onDragStart={(event) => {
                      if (!post.id) return;
                      onDragItems?.(event.dataTransfer, post.id);
                    }}
                    // What the keys do here, on hover, as the owner asked.
                    title={ROW_HOVER_HINT}
                    prefetch={onOpenPost ? false : undefined}
                    onMouseDown={(event) => {
                      if (shouldSuppressNativeItemSelection(event)) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => {
                      // Cmd click opens a background tab, the way it opens a
                      // link anywhere else. Option is what toggles selection,
                      // so the two never collide. BEFORE the selection
                      // handler: opening a tab should not also move what is
                      // selected.
                      if (post.id && onOpenPostInNewTab && isNewTabClick(event)) {
                        event.preventDefault();
                        onOpenPostInNewTab(post.id);
                        return;
                      }
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
                    onAuxClick={(event) => {
                      // Middle click, same as everywhere else.
                      if (event.button !== 1 || !post.id) return;
                      if (!onOpenPostInNewTab) return;
                      event.preventDefault();
                      onOpenPostInNewTab(post.id);
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
                    <GrowingGrid items={sorted} selectedIndex={selectedRowIndex}>
                      {renderUniversalCard}
                    </GrowingGrid>
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
                <div
                  className="universal-item-calendar"
                  aria-label="Folder calendar"
                >
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
                                  if (
                                    !onOpenPost ||
                                    !shouldOpenLocally(event)
                                  ) {
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
                              if (!onOpenPost || !shouldOpenLocally(event))
                                return;
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
            // The look says how its index is laid out; the view control is the
            // reader's override on top of that. `columns` and `gap` were
            // declared, defaulted and validated by the schema but read by
            // nothing, so a look could ask for a two-column index and get
            // whatever CSS happened to say.
            return (
              <div
                className={`universal-item-collection is-${collectionViewMode}`}
                data-collection-layout={activeCollection?.layout}
                style={
                  {
                    "--collection-columns": activeCollection?.columns,
                    "--collection-gap": activeCollection
                      ? COLLECTION_GAP[activeCollection.gap]
                      : undefined,
                  } as CSSProperties
                }
                role="listbox"
                aria-label="Folder items"
                aria-activedescendant={postOptionId(selectedPostId)}
              >
                <DocumentEngineStyles />
                <GrowingGrid items={sorted} selectedIndex={selectedRowIndex}>
                  {renderUniversalCard}
                </GrowingGrid>
              </div>
            );
          })()
        )}
      </section>
    </>
  );
}

export function FolderPage({
  availableTemplates,
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
  onOpenPostInNewTab,
  onDragItems,
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
  availableTemplates?: readonly TemplateDefinition[];
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
  /** Fill a drag with the items being moved. */
  onDragItems?: (transfer: DataTransfer, postId: string) => void;
  /** Cmd/Ctrl or middle click: open the document as a background tab. */
  onOpenPostInNewTab?: (postId: string) => void;
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
  // A look says what shape its index is; the view control is the reader's
  // override on top of that. Without this, a look declaring `list` still got
  // a grid, because the container class came from the toggle alone - it read
  // as the look not having applied at all.
  const lookLayout = (
    availableTemplates?.find((entry) => {
      const reference = defaultTemplateForFolder(folder);
      return entry.id === reference.id && entry.version === reference.version;
    }) ??
    getBuiltinTemplate(
      defaultTemplateForFolder(folder).id,
      defaultTemplateForFolder(folder).version,
    )
  )?.collection.layout;
  const defaultViewMode: FolderViewMode =
    lookLayout === "list" || lookLayout === "index" || lookLayout === "timeline"
      ? "list"
      : lookLayout === "cards"
        ? "grid"
        : folder.mode === "notes" || folder.mode === "bookmarks"
          ? "list"
          : "grid";
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
        availableTemplates={availableTemplates}
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
        onOpenPostInNewTab={onOpenPostInNewTab}
        onDragItems={onDragItems}
        onOpenTag={onOpenTag}
        onSelectPost={onSelectPost}
        selectedPostId={visibleSelectedPostId}
        selectedPostIds={selectedPostIds}
        viewMode={viewMode}
      />
    </main>
  );
}
