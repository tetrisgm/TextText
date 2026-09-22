
"use client";

import { AddFeedsDialog } from "@/components/workspace/reading/AddFeedsDialog";
import { ManageSourcesDialog } from "@/components/workspace/reading/ManageSourcesDialog";
import { ReadingFolderView, readingSourcesUnder } from "@/components/workspace/reading/ReadingFolderView";
import { refreshWorkspacePool } from "@/lib/pool/store";
import type { WorkspaceReadingSource } from "@/lib/pool/types";

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
  const [rowPx, setRowPx] = useState(72);
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
    if (px > 8 && Number.isFinite(px)) {
      rowPxRef.current = px;
      setRowPx(px);
    }
  });
  const px = rowPx;
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
import Link from "next/link";
import { renameFolderAction } from "@/app/editor/actions";
import { FolderCollectionItem } from "@/components/workspace/FolderCollectionItem";
import collectionStyles from "@/components/workspace/FolderCollectionItem.module.css";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { DocumentEngineStyles } from "@/components/document/DocumentEngineStyles";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceActionSearch } from "@/components/workspace/WorkspaceActionSearch";
import { useWorkspaceChoice } from "@/components/workspace/useWorkspaceChoice";
import { legacyTemplateId } from "@/lib/documents/legacy";
import { useFolderContentPane } from "@/components/workspace/useFolderContentPane";
import {
  useWorkspaceViewMode,
  WorkspaceViewModeControl,
  type WorkspaceViewMode,
} from "@/components/workspace/WorkspaceViewModeControl";
import { postBodyPreview } from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import type { TemplateReference } from "@/lib/documents/model";
import {
  queryMixedCollectionItems, collectionDateGroups, collectionBoardGroups,
  collectionCalendarMonth, collectionDayKey, collectionHeatmapDays,
} from "@/lib/presentation/collection-layout";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  displayModeForCollectionView,
  selectCollectionView,
} from "@/lib/presentation/collection-views";
import { blogHomePath, blogPostPath } from "@/lib/public-paths";
import { updateFolder } from "@/lib/pool/store";
import {
  CREATE_FOLDER_ITEM_EVENT,
  EDIT_FOLDER_TITLE_EVENT,
  UniversalItemComposer,
  actionErrorMessage,
  dispatchFolderUiEvent,
  isFolderUiEvent,
  type FolderCaptureResolved,
  type FolderCreateItem,
  type FolderDeleteItem,
} from "@/components/workspace/UniversalItemComposer";


type FolderViewMode = WorkspaceViewMode;
type FolderDeleteFolder = (folder: Folder) => Promise<void> | void;
function itemKey(post: Post): string {
  return post.id ?? post.slug;
}

function domSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function postOptionId(postId: string | null | undefined): string | undefined {
  return postId ? `workspace-post-${domSafeId(postId)}` : undefined;
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
  homeHref,
}: {
  homeHref?: string;
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
      {homeHref && <p><Link href={homeHref}>Browse all items</Link></p>}
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
  onAddFeeds,
  onManageSources,
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
  onAddFeeds?: () => void;
  onManageSources?: () => void;
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
                  {onAddFeeds && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onAddFeeds();
                      }}
                    >
                      Add feeds
                    </button>
                  )}
                  {onManageSources && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onManageSources();
                      }}
                    >
                      Manage sources
                    </button>
                  )}
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
  captureFocusRequestKey,
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
  hideEmpty = false,
}: {
  hideEmpty?: boolean;
  availableTemplates?: readonly TemplateDefinition[];
  blog: Blog;
  folder: Folder;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  captureFocusRequestKey?: number;
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
  const viewChoices = useMemo(() => (availableTemplates ?? []).flatMap(definition => {
    if (definition.id.startsWith("texttext.")) return [];
    return [
      { key: `${definition.id}@${definition.version}`, label: definition.name, definition, viewId: "" },
      ...(definition.collection.views ?? []).map(view => ({
        key: `${definition.id}@${definition.version}:${view.id}`,
        label: `${definition.name}: ${view.name}`, definition, viewId: view.id,
      })),
    ];
  }), [availableTemplates]);
  const choiceKeys = useMemo(() => ["", ...viewChoices.map(view => view.key)], [viewChoices]);
  const [savedViewId, setSavedViewId] = useWorkspaceChoice(`texttext:folder-collection:${folder.id}`, choiceKeys, "");
  const chosenView = useMemo(() => viewChoices.find(view => view.key === savedViewId), [viewChoices, savedViewId]);
  const collectionDefinition = chosenView?.definition;
  const activeCollection = useMemo(() => collectionDefinition
    ? selectCollectionView(collectionDefinition.collection, chosenView?.viewId ?? "")
    : undefined, [collectionDefinition, chosenView?.viewId]);
  // All-items uses the standard list. Explicit custom views use their renderer.
  const collectionRows = useMemo(() => queryMixedCollectionItems(
    items.map((post) => ({
      post,
      templateId: post.document?.presentation.template.id ?? post.template?.id ?? legacyTemplateId(post.type),
      pinned: Boolean(post.pinned),
      createdAt: post.date ?? null,
      updatedAt: post.updatedAt ?? post.date ?? null,
      publishedAt: post.status === "published" ? (post.date ?? null) : null,
      title: post.title,
      fields: post.document?.content.fields ?? post.collectionFields ?? {},
    })),
    activeCollection, collectionDefinition?.id,
  ), [activeCollection, items, collectionDefinition?.id]);
  const sorted = useMemo(() => collectionRows.map((entry) => entry.post), [collectionRows]);

  // A calendar folder places items on a month grid by the template's dateBy
  // date field. The offset is which month is showing, relative to now.
  const [calendarOffset, setCalendarOffset] = useState(0);
  const selectedRowIndex = useMemo(() => {
    if (!selectedPostId) return null;
    const index = sorted.findIndex((post) => post.id === selectedPostId);
    return index === -1 ? null : index;
  }, [selectedPostId, sorted]);

  const dateGroups = useMemo(() => collectionDateGroups(
    collectionRows, activeCollection, collectionDefinition?.fields ?? [],
  ), [collectionRows, activeCollection, collectionDefinition]);
  const calendar = useMemo(() => activeCollection?.layout === "calendar" && dateGroups ? {
    byDay: new Map([...dateGroups.byDay].map(([day, rows]) => [day, rows.map((row) => row.post)])),
    undated: dateGroups.undated.map((row) => row.post),
  } : null, [activeCollection, dateGroups]);
  const heatmap = useMemo(() => activeCollection?.layout === "heatmap" && dateGroups ? {
    counts: new Map([...dateGroups.byDay].map(([day, rows]) => [day, rows.length])),
  } : null, [activeCollection, dateGroups]);
  const board = useMemo(() => {
    const groups = collectionBoardGroups(collectionRows, activeCollection, collectionDefinition?.fields ?? []);
    return groups ? {
      columns: groups.columns.map(({ items: rows, ...column }) => ({ ...column, posts: rows.map((row) => row.post) })),
      unsorted: groups.unsorted.map((row) => row.post),
    } : null;
  }, [collectionRows, activeCollection, collectionDefinition]);
  const collectionViewMode: FolderViewMode = displayModeForCollectionView(
    activeCollection,
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
          focusRequestKey={captureFocusRequestKey}
        />
      )}
      {viewChoices.length > 0 ? (
        <label className="post-folder-saved-view">
          <span>View</span>
          <select aria-label="Folder view" value={savedViewId} onChange={event => setSavedViewId(event.currentTarget.value)}>
            <option value="">All items</option>
            {viewChoices.map(view => <option key={view.key} value={view.key}>{view.label}</option>)}
          </select>
        </label>
      ) : null}
      <section className="post-folder-page-items" aria-label="Folder items">
        {sorted.length === 0 ? (hideEmpty ? null : (
          <FolderEmptyCard
            homeHref={blogHomePath(blog)}
            actionLabel={items.length ? "Show all folder items" : canCreateItems ? (folder.mode === "bookmarks" ? "Save a bookmark" : folder.mode === "notes" ? "Write a note" : "Write an article") : undefined}
            onAction={
              items.length ? () => setSavedViewId("") : canCreateItems
                ? () =>
                    dispatchFolderUiEvent(CREATE_FOLDER_ITEM_EVENT, folder.id)
                : undefined
            }
          >
            {items.length ? "No items match this view. Show all folder items to remove its filters." : canCreateItems ? "This folder is empty. Keep related items together here. Create the first one to get started." : "This folder is empty. Items added by its owner will appear here."}
          </FolderEmptyCard>
        )) : (
          (() => {
            const renderUniversalCard = (post: (typeof sorted)[number]) => {
              const selected = Boolean(post.id && (selectedPostIds?.has(post.id) ?? post.id === selectedPostId));
              const reference = post.document?.presentation.template ?? post.template ?? { id: legacyTemplateId(post.type), version: 1 };
              const definition = resolveTemplate(reference) ?? getBuiltinTemplate("texttext.article", 1)!;
              return <FolderCollectionItem key={itemKey(post)} blog={blog} handle={handle} post={post} template={definition}
                selected={selected} optionId={postOptionId(post.id)} tabIndex={post.id === selectedPostId ? 0 : -1}
                owner={canEditItems} onSelect={() => post.id && onSelectPost?.(post.id)}
                onOpenPost={onOpenPost} onOpenPostInNewTab={onOpenPostInNewTab} onDragItems={onDragItems}
                onItemClick={(event) => post.id ? (onItemClick?.(post.id, event) ?? true) : true}
                onOpenTag={onOpenTag} onDeleteItem={onDeleteItem} onCaptureResolved={onCaptureResolved} />;
            };
            if (heatmap) {
              const days = collectionHeatmapDays(heatmap.counts, new Date());
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
              const { monthLabel, cells } = collectionCalendarMonth(anchor);
              const todayKey = collectionDayKey(now);
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
                {collectionViewMode === "list" || collectionViewMode === "column" ? (
                  <WindowedRows items={sorted} selectedIndex={selectedRowIndex}>{renderUniversalCard}</WindowedRows>
                ) : <GrowingGrid items={sorted} selectedIndex={selectedRowIndex}>{renderUniversalCard}</GrowingGrid>}
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
  captureFocusRequestKey = 0,
  searchFocusRequestKey = 0,
  onSelectPost,
  selectedPostId,
  selectedPostIds,
  onDeleteFolder,
  canShareFolders = true,
  readingSources,
  blogId,
  onOpenFolderPath,
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
  captureFocusRequestKey?: number;
  onSelectPost?: (postId: string) => void;
  selectedPostId?: string | null;
  selectedPostIds?: ReadonlySet<string>;
  onDeleteFolder?: FolderDeleteFolder;
  canShareFolders?: boolean;
  /** Feed connections in the workspace; a folder with any at or under it reads as a source folder. */
  readingSources?: WorkspaceReadingSource[];
  blogId?: string;
  onOpenFolderPath?: (folderPath: string) => void;
}) {
  // Folder layout is independent of its default type for new documents.
  const defaultViewMode: FolderViewMode = "list";
  const [viewMode, changeView] = useWorkspaceViewMode(
    `folder:v3:${folder.id}`,
    defaultViewMode,
  );
  const [filterQuery, setFilterQuery] = useState("");
  const [createFocusRequest, setCreateFocusRequest] = useState(0);
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

  const personalItems = useMemo(() => items.filter((post) => post.origin !== "feed" || post.filed), [items]);
  const filteredItems = useMemo(() => {
    const query = filterQuery.trim().toLocaleLowerCase();
    if (!query) return personalItems;
    return personalItems.filter((post) =>
      [post.title, post.excerpt, postBodyPreview(post)]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [filterQuery, personalItems]);

  const sourcesHere = readingSourcesUnder(readingSources, folder.path);
  const hasFeeds = sourcesHere.length > 0 && Boolean(blogId);
  const [folderPane, setFolderPane] = useFolderContentPane(
    folder.id,
    personalItems.length ? "items" : "news",
  );
  const isReadingFolder = hasFeeds && folderPane === "news";
  const canAddFeeds = canEditItems && folder.mode === "bookmarks" && Boolean(blogId);
  const [addFeedsOpen, setAddFeedsOpen] = useState(false);
  const [manageSourcesOpen, setManageSourcesOpen] = useState(false);
  const [readingRefresh, setReadingRefresh] = useState(0);

  const visibleSelectedPostId =
    selectedPostId && filteredItems.some((post) => post.id === selectedPostId)
      ? selectedPostId
      : null;

  return (
    <main
      className={`post-folder-page ${collectionStyles.folder} is-mode-${folder.mode} is-view-${viewMode}`}
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
        onCreate={() => {
          setFolderPane("items");
          setCreateFocusRequest((current) => current + 1);
        }}
        onRename={() =>
          dispatchFolderUiEvent(EDIT_FOLDER_TITLE_EVENT, folder.id)
        }
        searchFocusRequestKey={searchFocusRequestKey}
        searchValue={filterQuery}
        onSearchValueChange={setFilterQuery}
        onDeleteFolder={onDeleteFolder}
        onAddFeeds={canAddFeeds ? () => setAddFeedsOpen(true) : undefined}
        onManageSources={canEditItems && hasFeeds ? () => setManageSourcesOpen(true) : undefined}
      />
      <header className="post-folder-page-header">
        <FolderTitleEditor
          folder={folder}
          handle={handle}
          canEdit={canEditItems}
        />
        {!isReadingFolder && (
          <p className="post-folder-page-count">
            {personalItems.length} {personalItems.length === 1 ? "item" : "items"}
          </p>
        )}
      </header>
      {hasFeeds && (
        <div className="folder-content-switch" role="group" aria-label="Folder content">
          {(["items", "news"] as const).map((pane) => (
            <button key={pane} type="button" aria-pressed={folderPane === pane}
              onClick={() => setFolderPane(pane)}>
              {pane === "items" ? "Items" : "News"}
            </button>
          ))}
        </div>
      )}
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
      {filterQuery && !isReadingFolder && filteredItems.length === 0 ? (
        <FolderEmptyCard actionLabel="Clear folder search" onAction={() => setFilterQuery("")} homeHref={blogHomePath(blog)}>
          No items match your search in this folder. Try a different word or clear the search.
        </FolderEmptyCard>
      ) : null}
      {addFeedsOpen && blogId && (
        <AddFeedsDialog
          handle={handle}
          parentFolderPath={folder.path}
          parentFolderName={folder.name}
          defaultRetentionDays={blog.readingRetentionDays ?? 90}
          onClose={() => setAddFeedsOpen(false)}
          onAdded={async (result) => {
            setAddFeedsOpen(false);
            // The new source folder was created on the server; the pool has
            // to learn it before the shell can open it.
            if (blogId) await refreshWorkspacePool(handle, blogId).catch(() => undefined);
            onOpenFolderPath?.(result.folderPath);
          }}
        />
      )}
      {manageSourcesOpen && blogId && (
        <ManageSourcesDialog
          handle={handle}
          blogId={blogId}
          folderPath={folder.path}
          folderName={folder.name}
          onClose={() => setManageSourcesOpen(false)}
          onChanged={() => setReadingRefresh((tick) => tick + 1)}
        />
      )}
      {isReadingFolder && blogId ? (
        <ReadingFolderView
          key={readingRefresh}
          blog={blog}
          folder={folder}
          handle={handle}
          blogId={blogId}
          sources={sourcesHere}
          canEdit={canEditItems}
          selectedPostId={selectedPostId}
          query={filterQuery}
          onQueryChange={setFilterQuery}
          onOpenPost={onOpenPost}
          onSelectPost={onSelectPost}
          onAddFeeds={canAddFeeds ? () => setAddFeedsOpen(true) : undefined}
        />
      ) : (
      <UniversalFolderContents
        availableTemplates={availableTemplates}
        blog={blog}
        folder={folder}
        handle={handle}
        items={filteredItems}
        captureFocusRequestKey={captureFocusRequestKey + createFocusRequest}
        hideEmpty={Boolean(filterQuery) && filteredItems.length === 0}
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
      )}
    </main>
  );
}
