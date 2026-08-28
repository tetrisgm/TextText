"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  createFolderItemAction,
  createSubfolderAction,
  createWorkspacePostAction,
  deleteEditablePostAction,
  saveEditablePostAction,
  movePostToFolderAction,
  renameFolderAction,
  toggleEditablePostStarredAction,
  trashFolderAction,
  updateBlogAction,
} from "@/app/editor/actions";
import { usePresence } from "@/lib/collab/usePresence";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { saveItemAsLookAction } from "@/app/editor/look-actions";
import { UnifiedDocumentEditor } from "@/components/document/UnifiedDocumentEditor";
import type { AssistantAgentIdentity } from "@/components/workspace/assistant/agent-identity";
import { UnifiedDocumentReader } from "@/components/document/UnifiedDocumentReader";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import {
  useEscapeLayer,
  useWorkspaceCommandSurface,
} from "@/components/keyboard/CommandLayer";
import {
  FolderPage,
  UniversalItemComposer,
  type FolderCaptureResolved,
  type FolderCreateItem,
  type FolderDeleteItem,
} from "@/components/FolderPage";
import {
  PostActionBar,
  type BookmarkContentMode,
} from "@/components/PostActionBar";
import { PostByline } from "@/components/PostByline";
import { TagChips, TagEditor } from "@/components/TagChips";
import { WikiLinkAnchor, remarkWikiLinks } from "@/components/WikiLinkMarkdown";
import {
  EditableCover as WorkspaceEditableCover,
  randomCover,
} from "@/components/editor/EditableCover";
import { FolderLookPicker } from "@/components/workspace/FolderLookPicker";
import { ItemTypeStudio } from "@/components/workspace/ItemTypeStudio";
import { UpdatedBuildNotice } from "@/components/workspace/UpdatedBuildNotice";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { ReaderComments } from "@/components/workspace/ReaderComments";
import { ReaderFindHighlights } from "@/components/workspace/ReaderFindHighlights";
import { WorkspaceActionSearch } from "@/components/workspace/WorkspaceActionSearch";
import { WorkspaceMenuMount } from "@/components/workspace/WorkspaceMenuMount";
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings";
import { SharedWithMe } from "@/components/workspace/SharedWithMe";
import { WorkspaceSearchButton } from "@/components/workspace/WorkspaceSearchButton";
import {
  WorkspaceItemActions,
  WorkspaceItemStar,
} from "@/components/workspace/WorkspaceItemActions";
import { WorkspaceItemThumbnail } from "@/components/workspace/WorkspaceItemThumbnail";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";

type TrashApiOperation =
  | "empty"
  | "trash-posts"
  | "restore-post"
  | "restore-folder"
  | "delete-post"
  | "delete-folder";

async function runTrashOperation(
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

function useClientHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return hydrated;
}
import { WorkspaceViewModeControl } from "@/components/workspace/WorkspaceViewModeControl";
import {
  resetSpatialCardTilt,
  updateSpatialCardTilt,
} from "@/components/workspace/spatial-card";
import {
  createOptimisticWorkspacePost,
  mergeCreatedWorkspacePost,
  nextWorkspacePostAfterDelete,
  shouldOpenWorkspacePostInEdit,
  useLocalWorkspaceItemIdentity,
  type WorkspaceItemIdentityRegistry,
} from "@/components/workspace/useLocalWorkspaceInteraction";
import {
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH,
  ASSISTANT_SIDEBAR_MAX_WIDTH,
  ASSISTANT_SIDEBAR_MIN_WIDTH,
  AssistantSidebar,
  type AssistantSidebarState,
} from "@/components/workspace/assistant";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { TRY_AI_IN_TEXTTEXT_EVENT } from "@/components/workspace/AiConnectionSettings";
import { useAssistantComposerDraft } from "@/components/workspace/assistant/composer-store";
import {
  createAssistantConfirmationController,
  type AssistantConfirmationRequest,
} from "@/components/workspace/assistant/confirmation";
import {
  assistantContextChipWithSelection,
  resolveWorkspaceAssistantContext,
} from "@/components/workspace/assistant/context";
import { starterContextFromChip } from "@/components/workspace/assistant/starters";
import { assistantAgentIdentity } from "@/components/workspace/assistant/agent-identity";
import { SelectionActions } from "@/components/workspace/assistant/SelectionActions";
import { useNativeAssistant } from "@/components/workspace/assistant/useNativeAssistant";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import {
  createWorkspaceItemTextSelection,
  locateWorkspaceItemTextSelection,
  openWorkspaceItemDraftRevision,
  patchOpenWorkspaceItemDraftIfCurrent,
  readOpenWorkspaceItemDraft,
  readOpenWorkspaceItemSelection,
  registerOpenWorkspaceItemDraft,
  setOpenWorkspaceItemSelection,
  subscribeOpenWorkspaceItemDrafts,
  type WorkspaceItemTextField,
  type WorkspaceItemTextPatch,
  type WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";
import type {
  Blog,
  BlogHomeView,
  Folder,
  FolderMode,
  Post,
  PostType,
} from "@/lib/content";
import { isVideoFile, plainTextExcerpt } from "@/lib/content";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { isNoCoverValue, NO_COVER_VALUE, resolveCover } from "@/lib/cover";
import { COVER_PILE } from "@/lib/cover-pile";
import {
  adjacentPublishedPostsForPool,
  allTagsInPool,
  backlinksForPost,
  findPoolPostById,
  findPoolPostBySlug,
  folderPathForPoolPost,
  narrowPostFromPost,
  poolPostsForFolder,
  poolPostsForTag,
  postFromPoolPost,
  starredPoolPosts,
  templateForPoolPost,
  wikiLinkRenderTargetsForPool,
} from "@/lib/pool/selectors";
import {
  addPost,
  acknowledgePost,
  acknowledgePostBody,
  ensurePostBody,
  getCachedWorkspacePostBody,
  getWorkspacePost,
  markPostDirty,
  moveFolderToTrash,
  movePost,
  movePostToTrash,
  removeTrashedFolder,
  removeTrashedPost,
  refreshWorkspacePool,
  removePost,
  restoreFolderFromTrash,
  restorePostFromTrash,
  replacePost,
  updatePost,
  updateFolder,
  updatePostBody,
  useWorkspacePool,
  useWorkspacePostBody,
} from "@/lib/pool/store";
import { WorkspaceProvider } from "@/lib/pool/WorkspaceProvider";
import { useWorkspaceLiveSync } from "@/lib/pool/useWorkspaceLiveSync";
import type {
  WorkspaceInitialBody,
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import { workspaceReferenceChoices } from "@/lib/presentation/workspace-reference-choices";
import {
  blogPostPath,
  blogWorkspacePostEditPath,
  blogWorkspacePostPath,
  workspacePublicPostUrl,
} from "@/lib/public-paths";
import {
  initialDraft,
  isPlaceholderSlug,
  payloadFor,
  payloadKey,
  slugify,
  uniqueSlug,
} from "@/lib/post-edit-draft";
import type { DraftState } from "@/lib/post-edit-draft";
import type { SpatialDirection } from "@/lib/commands/types";
import { shortcutLabelForCommand } from "@/lib/commands/workspace";
import type { AgentFocusEvent } from "@/lib/collab/agent-focus";
import type { AdjacentPublishedPosts } from "@/lib/store";
import type { WikiLinkRenderTargets } from "@/lib/wikilinks";
import {
  isRemoteImageUrl,
  localizeRemoteMarkdownImages,
} from "@/lib/markdown-images";
import {
  markdownSubtitle,
  replaceMarkdownSubtitle,
} from "@/lib/markdown-subtitle";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  WORKSPACE_SIDEBAR_COOKIE_MAX_AGE,
  WORKSPACE_SIDEBAR_STORAGE_KEY,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";
import {
  SHARED_FOLDER_PATH,
  STARRED_FOLDER_PATH,
  TRASH_FOLDER_PATH,
} from "@/lib/workspace-paths";
import {
  disarmWorkspaceHover,
  workspaceMouseMoved,
} from "@/lib/workspace-hover";
import {
  rememberedRootFolderPath,
  rootFolderPathForSelection,
  shouldClearWorkspaceSelection,
  shouldMoveSelectionIntoSidebar,
  workspaceEscapeTarget,
  workspaceHrefWithSearchReturn,
  workspaceHierarchyUpTarget,
  workspaceSearchHref,
  workspaceSearchLocationFromUrl,
  workspaceSearchReturnFromUrl,
  type WorkspaceSearchLocation,
} from "@/lib/workspace-navigation";
import {
  parseWorkspaceDateQuery,
  searchWorkspace,
  workspaceRootBodyMode,
  workspaceSearchHandoffIndex,
  type WorkspaceSearchResult,
} from "@/lib/workspace-search";
import {
  MediaUploadError,
  mediaUploadEndpointForHandle,
  uploadMedia,
} from "@/lib/upload";
import {
  beginMeasuredEditTransition,
  finishMeasuredEditTransition,
} from "@/lib/edit-transition";
import {
  deletePersistedWorkspaceDraft,
  persistWorkspaceDraft,
  readPersistedWorkspaceDraft,
} from "@/lib/pool/storage";
import { projectTrashView } from "@/lib/trash-view";
import {
  extendSelectionByKeyboard,
  marqueeSelectionIds,
  selectionFromClick,
  shouldSuppressNativeItemSelection,
  type SelectionRectangle,
} from "@/lib/workspace-selection";
import { homeFolderModeForPostType } from "@/lib/workspace-item-presentation";
import {
  WORKSPACE_DOCUMENT_OPENED_EVENT,
  calendarDaysForMonth,
  calendarDocumentAction,
  documentsForActivityDate,
  groupDocumentsByActivityDate,
  localDateKey,
  readWorkspaceDocumentOpenHistory,
  recordWorkspaceDocumentOpened,
  sidebarDocumentTitle,
  sortSidebarDocuments,
  type SidebarDocumentSort,
  type WorkspaceDocumentOpenHistory,
} from "@/lib/workspace-activity";

/** A folder's workspace-unique path segment, e.g. "blog" or "notes". */
export type SidebarFolderId = string;

type AdjacentPosts = AdjacentPublishedPosts;

function upgradeHttpImageSrc(src: string | undefined): string {
  const value = src ?? "";
  return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
}

function beginEditTransition(postId: string) {
  if (typeof document === "undefined" || typeof performance === "undefined")
    return;
  beginMeasuredEditTransition(
    document.documentElement.dataset,
    postId,
    performance.now(),
  );
}

let sidebarCollapsedMemory: boolean | null = null;
const sidebarCollapsedListeners = new Set<() => void>();
let sidebarWidthMemory: number | null = null;
const sidebarWidthListeners = new Set<() => void>();

const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = "texttext:workspace-sidebar-width";
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 252;
const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;
const WORKSPACE_COMPACT_MEDIA_QUERY = "(max-width: 1024px)";
const localWorkspaceDraftSessions = new Map<string, DraftState>();
const localWorkspacePendingSaveIds = new Set<string>();
const localWorkspaceDraftRevisions = new Map<string, number>();
const localWorkspaceServerRevisions = new Map<string, string>();
const WORKSPACE_ASSISTANT_STATE_KEY = "texttext:workspace-assistant-state";
const WORKSPACE_ASSISTANT_STATE_MIGRATION_KEY =
  "texttext:workspace-assistant-state:v5";
/// Below this the document column cannot give up the room, so the rail stays a
/// thing you summon rather than a thing that is open.
const ASSISTANT_PINNED_MIN_WIDTH = 1100;
const WORKSPACE_ASSISTANT_WIDTH_KEY = "texttext:workspace-assistant-width";
let assistantStateMemory: AssistantSidebarState | null = null;
let assistantWidthMemory: number | null = null;
const assistantPreferenceListeners = new Set<() => void>();

// One quiet line per folder mode; folder rows show it under the name.

// Rendered only for full-access shells that cannot provide real folders, so
// restricted collaborators never see synthesized workspace roots.
const FALLBACK_FOLDERS: Folder[] = [
  { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
  { id: "notes", name: "Notes", path: "notes", mode: "notes", position: 1 },
  {
    id: "bookmarks",
    name: "Bookmarks",
    path: "bookmarks",
    mode: "bookmarks",
    position: 2,
  },
];

const ROOT_SECTION_MODES: FolderMode[] = ["blog", "notes", "bookmarks"];
const STOP_LOCAL_EDITING_EVENT = "texttext:stop-local-editing";

function localDraftRevision(postId: string): number {
  return localWorkspaceDraftRevisions.get(postId) ?? 0;
}

function bumpLocalDraftRevision(postId: string): number {
  const revision = localDraftRevision(postId) + 1;
  localWorkspaceDraftRevisions.set(postId, revision);
  return revision;
}

function transferLocalDraftRevision(previousId: string, postId: string) {
  const revision = localDraftRevision(previousId);
  localWorkspaceDraftRevisions.delete(previousId);
  if (revision > 0) localWorkspaceDraftRevisions.set(postId, revision);
}

function persistLocalWorkspaceDraft(
  blogId: string,
  postId: string,
  draft: DraftState,
  key: string,
  baseUpdatedAt?: string,
) {
  void persistWorkspaceDraft({
    blogId,
    postId,
    draft,
    key,
    baseUpdatedAt,
    persistedAt: new Date().toISOString(),
  });
}

/** Client-safe mirror of store.ts folderPathForPostType. */
export function sidebarFolderPathForPostType(type: PostType): SidebarFolderId {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
}

function mergeDraftIntoWorkspacePost(
  post: WorkspacePoolPost,
  draft: DraftState,
): WorkspacePoolPost {
  return {
    ...post,
    type: draft.type,
    title: draft.title,
    excerpt: markdownSubtitle(draft.body) || undefined,
    slug: slugify(draft.slug, post.slug),
    status: draft.status,
    cover: draft.cover || undefined,
    coverCaption: draft.coverCaption || undefined,
    coverHeight: draft.coverHeight ?? undefined,
    accent: draft.accent || undefined,
    gallery: draft.gallery,
    tags: draft.tags,
    videoUrl: draft.videoUrl || undefined,
    venue: draft.venue || undefined,
    duration: draft.duration || undefined,
    date: draft.date || undefined,
  };
}

function applySavedWorkspacePost(saved: Post, blogId: string) {
  const savedPoolPost = narrowPostFromPost(saved, blogId);
  if (!savedPoolPost?.id) return;
  updatePost(savedPoolPost.id, savedPoolPost);
}

function folderWorkspaceHref(
  homePath: string,
  folder: SidebarFolderId,
): string {
  return `${homePath}?folder=${encodeURIComponent(folder)}`;
}

function workspaceRootHref(homePath: string): string {
  return homePath;
}

function workspaceSettingsHref(homePath: string): string {
  return `${homePath}?view=settings`;
}

function rootSectionFolders(pool: WorkspacePoolPayload): Folder[] {
  const roots = pool.folders
    .filter(
      (folder) => !folder.parentId && ROOT_SECTION_MODES.includes(folder.mode),
    )
    .slice()
    .sort((a, b) => a.position - b.position);
  if (roots.length > 0) return roots.slice(0, 3);
  return ROOT_SECTION_MODES.map(
    (mode) => pool.folders.find((folder) => folder.mode === mode) ?? null,
  ).filter((folder): folder is Folder => Boolean(folder));
}

function validRootSectionPath(
  pool: WorkspacePoolPayload,
  preferred: string | null,
): string | null {
  if (preferred === STARRED_FOLDER_PATH) return preferred;
  if (preferred && pool.folders.some((folder) => folder.path === preferred)) {
    return preferred;
  }
  return null;
}

function selectedPostIdForView(
  pool: WorkspacePoolPayload,
  view: LocalWorkspaceView,
  preferred?: string | null,
): string | null {
  if (view.level === "post" || view.level === "edit") return view.postId;
  if (view.level === "trash") {
    const posts = pool.trashedPosts ?? [];
    if (preferred && posts.some((post) => post.id === preferred))
      return preferred;
    return null;
  }
  if (view.level === "search") {
    if (preferred && pool.posts.some((post) => post.id === preferred)) {
      return preferred;
    }
    return null;
  }
  if (view.level === "starred") {
    if (
      preferred &&
      pool.posts.some((post) => post.id === preferred && post.starred)
    ) {
      return preferred;
    }
    return null;
  }
  if (view.level !== "section") return null;
  const posts = poolPostsForFolder(pool, view.folderPath);
  if (preferred && posts.some((post) => post.id === preferred)) {
    return preferred;
  }
  return null;
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function visibleWorkspaceItems(attribute: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${attribute}]`),
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function spatialNeighbor(
  items: HTMLElement[],
  current: HTMLElement | null,
  direction: SpatialDirection,
): HTMLElement | null {
  if (items.length === 0) return null;
  if (!current) return items[0] ?? null;
  const currentRect = current.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  let best: { element: HTMLElement; score: number } | null = null;

  for (const element of items) {
    if (element === current) continue;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const primary =
      direction === "left"
        ? -dx
        : direction === "right"
          ? dx
          : direction === "up"
            ? -dy
            : dy;
    if (primary <= 2) continue;
    const cross =
      direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
    const score = primary + cross * 3;
    if (!best || score < best.score) best = { element, score };
  }

  return best?.element ?? current;
}

function domSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function readDocumentCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    const key = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    if (decodeURIComponent(key) !== name) continue;
    return separatorIndex === -1
      ? ""
      : decodeURIComponent(part.slice(separatorIndex + 1));
  }
  return null;
}

function writeSidebarCollapsedCookie(next: boolean) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(WORKSPACE_SIDEBAR_COOKIE)}=${
    next ? "1" : "0"
  }; Path=/; Max-Age=${WORKSPACE_SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readSidebarCollapsed(fallback = false): boolean {
  if (sidebarCollapsedMemory !== null) return sidebarCollapsedMemory;
  if (typeof window === "undefined") return fallback;
  const cookieValue = readDocumentCookie(WORKSPACE_SIDEBAR_COOKIE);
  if (cookieValue === "0" || cookieValue === "1") {
    sidebarCollapsedMemory = parseWorkspaceSidebarCollapsed(cookieValue);
    return sidebarCollapsedMemory;
  }
  const stored = window.localStorage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY);
  if (stored === "0" || stored === "1") {
    sidebarCollapsedMemory = parseWorkspaceSidebarCollapsed(stored);
    return sidebarCollapsedMemory;
  }
  sidebarCollapsedMemory = fallback;
  return sidebarCollapsedMemory;
}

function emitSidebarCollapsedChange() {
  for (const listener of sidebarCollapsedListeners) listener();
}

export function setWorkspaceSidebarCollapsedPreference(next: boolean) {
  sidebarCollapsedMemory = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      WORKSPACE_SIDEBAR_STORAGE_KEY,
      next ? "1" : "0",
    );
  }
  writeSidebarCollapsedCookie(next);
  emitSidebarCollapsedChange();
}

function subscribeSidebarCollapsed(listener: () => void): () => void {
  sidebarCollapsedListeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== WORKSPACE_SIDEBAR_STORAGE_KEY) return;
    sidebarCollapsedMemory = parseWorkspaceSidebarCollapsed(event.newValue);
    emitSidebarCollapsedChange();
  };

  window.addEventListener("storage", onStorage);
  return () => {
    sidebarCollapsedListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useWorkspaceSidebarCollapsed(initialCollapsed = false) {
  const getCollapsedSnapshot = useCallback(
    () => readSidebarCollapsed(initialCollapsed),
    [initialCollapsed],
  );
  const getServerCollapsedSnapshot = useCallback(
    () => initialCollapsed,
    [initialCollapsed],
  );
  const sidebarCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getCollapsedSnapshot,
    getServerCollapsedSnapshot,
  );

  const setCollapsed = useCallback((next: boolean) => {
    setWorkspaceSidebarCollapsedPreference(next);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setCollapsed(!readSidebarCollapsed(initialCollapsed));
  }, [initialCollapsed, setCollapsed]);

  return {
    sidebarCollapsed,
    setSidebarCollapsed: setCollapsed,
    toggleSidebarCollapsed,
  };
}

function clampSidebarWidth(value: number): number {
  return Math.min(
    WORKSPACE_SIDEBAR_MAX_WIDTH,
    Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, Math.round(value)),
  );
}

function readSidebarWidth(): number {
  if (sidebarWidthMemory !== null) return sidebarWidthMemory;
  if (typeof window === "undefined") return WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
  const stored = Number(
    window.localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY),
  );
  sidebarWidthMemory =
    Number.isFinite(stored) && stored > 0
      ? clampSidebarWidth(stored)
      : WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
  return sidebarWidthMemory;
}

function subscribeSidebarWidth(listener: () => void): () => void {
  sidebarWidthListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY) return;
    sidebarWidthMemory = null;
    for (const current of sidebarWidthListeners) current();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    sidebarWidthListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setWorkspaceSidebarWidth(next: number) {
  sidebarWidthMemory = clampSidebarWidth(next);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY,
      String(sidebarWidthMemory),
    );
  }
  for (const listener of sidebarWidthListeners) listener();
}

function useWorkspaceSidebarWidth() {
  const width = useSyncExternalStore(
    subscribeSidebarWidth,
    readSidebarWidth,
    () => WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  );
  return { width, setWidth: setWorkspaceSidebarWidth };
}

/// The assistant is a place, not a thing you summon.
///
/// It used to default to hidden, and v3 actively closed it once, which left a
/// wide empty column beside the document and no reason to ever look right. On a
/// window with the room it now starts pinned: docked, reflowing the document
/// column rather than covering it.
///
/// The width-derived answer is deliberately NOT written down. Persisting it was
/// a bug: the Mac app opens a window narrower than this, so the first read
/// recorded "hidden" forever and maximising afterwards could not bring the rail
/// back. A window size is a fact about right now, not a decision, so it is
/// recomputed on every read and only an explicit choice is stored.
///
/// v4 therefore clears what v3 forced rather than replacing it with another
/// forced value.
function readAssistantState(): AssistantSidebarState {
  if (typeof window === "undefined") return "hidden";
  const roomToPin =
    typeof window.innerWidth !== "number" ||
    window.innerWidth >= ASSISTANT_PINNED_MIN_WIDTH;
  const preferred: AssistantSidebarState = roomToPin ? "pinned" : "hidden";
  let saved: string | null = null;
  try {
    if (!window.localStorage.getItem(WORKSPACE_ASSISTANT_STATE_MIGRATION_KEY)) {
      window.localStorage.removeItem(WORKSPACE_ASSISTANT_STATE_KEY);
      window.localStorage.setItem(WORKSPACE_ASSISTANT_STATE_MIGRATION_KEY, "1");
    }
    saved = window.localStorage.getItem(WORKSPACE_ASSISTANT_STATE_KEY);
  } catch {
    return preferred;
  }
  if (saved === "open" || saved === "pinned") {
    // The floating "open" state is gone; open means docked now.
    assistantStateMemory = "pinned";
    return assistantStateMemory;
  }
  if (saved === "hidden") {
    assistantStateMemory = saved;
    return saved;
  }
  // No choice on record: follow the window, and do not write that down.
  return preferred;
}

function readAssistantWidth(): number {
  if (assistantWidthMemory !== null) return assistantWidthMemory;
  if (typeof window === "undefined") return ASSISTANT_SIDEBAR_DEFAULT_WIDTH;
  const saved = window.localStorage.getItem(WORKSPACE_ASSISTANT_WIDTH_KEY);
  assistantWidthMemory =
    saved === null
      ? ASSISTANT_SIDEBAR_DEFAULT_WIDTH
      : clampAssistantWidth(Number(saved));
  return assistantWidthMemory;
}

function clampAssistantWidth(value: number): number {
  const resolved = Number.isFinite(value)
    ? value
    : ASSISTANT_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(
    ASSISTANT_SIDEBAR_MAX_WIDTH,
    Math.max(ASSISTANT_SIDEBAR_MIN_WIDTH, Math.round(resolved)),
  );
}

function subscribeAssistantPreferences(listener: () => void): () => void {
  assistantPreferenceListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== WORKSPACE_ASSISTANT_STATE_KEY &&
      event.key !== WORKSPACE_ASSISTANT_WIDTH_KEY
    ) {
      return;
    }
    assistantStateMemory = null;
    assistantWidthMemory = null;
    for (const current of assistantPreferenceListeners) current();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    assistantPreferenceListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function emitAssistantPreferences() {
  for (const listener of assistantPreferenceListeners) listener();
}

function setWorkspaceAssistantState(next: AssistantSidebarState) {
  assistantStateMemory = next;
  window.localStorage.setItem(WORKSPACE_ASSISTANT_STATE_KEY, next);
  emitAssistantPreferences();
}

function setWorkspaceAssistantWidth(next: number) {
  assistantWidthMemory = clampAssistantWidth(next);
  window.localStorage.setItem(
    WORKSPACE_ASSISTANT_WIDTH_KEY,
    String(assistantWidthMemory),
  );
  emitAssistantPreferences();
}

function useWorkspaceAssistantPreferences() {
  const state = useSyncExternalStore(
    subscribeAssistantPreferences,
    readAssistantState,
    () => "hidden" as AssistantSidebarState,
  );
  const width = useSyncExternalStore(
    subscribeAssistantPreferences,
    readAssistantWidth,
    () => ASSISTANT_SIDEBAR_DEFAULT_WIDTH,
  );
  return { state, width };
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 18 16" fill="none" aria-hidden="true">
      <path
        d="M2.25 4.25c0-.83.67-1.5 1.5-1.5h3.28c.45 0 .88.2 1.16.55l.74.9h5.32c.83 0 1.5.67 1.5 1.5v6.55c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5v-8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M5.25 3.25h7.5v11.5L9 12.35l-3.75 2.4V3.25Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4.25 2.75h7.1l2.4 2.45v10.05h-9.5V2.75Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
      <path
        d="M11.25 2.9v2.45h2.35M6.5 8h5M6.5 10.75h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function SidebarFolderIcon({ mode }: { mode: FolderMode }) {
  if (mode === "bookmarks") return <BookmarkIcon />;
  if (mode === "notes") return <NoteIcon />;
  return <FolderIcon />;
}

function SidebarRevealIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3.25 4.25h11.5v9.5H3.25v-9.5ZM7.25 4.5v9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SidebarCollapseIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3.25 4.25h11.5v9.5H3.25v-9.5ZM7.25 4.5v9M11.75 6.75 9.5 9l2.25 2.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4.75 5.5h8.5l-.55 9h-7.4l-.55-9ZM3.5 5.5h11M7 3.5h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function SharedIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.4" />
      <circle
        cx="12.4"
        cy="7.2"
        r="1.7"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M3.6 14c.4-2.35 1.55-3.55 3.4-3.55S10 11.65 10.4 14M10.2 11c1.95-.35 3.35.55 3.85 2.55"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function StarredIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m10 2.5 2.25 4.55 5.02.73-3.63 3.54.86 5-4.5-2.36-4.5 2.36.86-5-3.63-3.54 5.02-.73L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="m3.25 8.25 5.75-5 5.75 5v6.25h-4v-4h-3.5v4h-4V8.25Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function HistoryChevron({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d={
          direction === "back"
            ? "m11 4.5-4.5 4.5 4.5 4.5"
            : "M7 4.5 11.5 9 7 13.5"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function SidebarToggleControl({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <ShortcutTooltip
      label={collapsed ? "Show sidebar" : "Hide sidebar"}
      keys="⌘⇧S"
      placement="bottom"
    >
      <button
        type="button"
        className="post-editor-sidebar-toggle"
        aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? <SidebarRevealIcon /> : <SidebarCollapseIcon />}
      </button>
    </ShortcutTooltip>
  );
}

function WorkspaceHistoryControls() {
  return (
    <>
      <ShortcutTooltip label="Back" placement="bottom">
        <button
          type="button"
          className="post-editor-sidebar-toggle"
          aria-label="Go back"
          onClick={() => window.history.back()}
        >
          <HistoryChevron direction="back" />
        </button>
      </ShortcutTooltip>
      <ShortcutTooltip label="Forward" placement="bottom">
        <button
          type="button"
          className="post-editor-sidebar-toggle"
          aria-label="Go forward"
          onClick={() => window.history.forward()}
        >
          <HistoryChevron direction="forward" />
        </button>
      </ShortcutTooltip>
    </>
  );
}

function SidebarActivity({
  documents,
  onSearchDate,
}: {
  documents: WorkspacePoolPost[];
  onSearchDate?: (dateKey: string) => void;
}) {
  const now = new Date();
  const [monthStart, setMonthStart] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const datedDocuments = useMemo(
    () => groupDocumentsByActivityDate(documents),
    [documents],
  );
  const calendarDays = useMemo(() => {
    return calendarDaysForMonth(monthStart);
  }, [monthStart]);
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(monthStart);
  const todayKey = localDateKey(new Date());

  return (
    <details className="post-editor-sidebar-activity">
      <summary>
        <span>Activity</span>
        <small>{monthLabel}</small>
      </summary>
      <section className="post-editor-calendar" aria-label={monthLabel}>
        <header>
          <strong>{monthLabel}</strong>
          <span>
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setMonthStart(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setMonthStart(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              ›
            </button>
          </span>
        </header>
        <div className="post-editor-calendar-weekdays" aria-hidden="true">
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="post-editor-calendar-grid">
          {calendarDays.map((day) => {
            const key = localDateKey(day) ?? "";
            const posts = datedDocuments.get(key) ?? [];
            const outside = day.getMonth() !== monthStart.getMonth();
            return (
              <button
                key={key}
                type="button"
                className={`${outside ? "is-outside" : ""}${
                  posts.length > 0 ? " has-documents" : ""
                }${key === todayKey ? " is-today" : ""}`}
                aria-label={`${day.toLocaleDateString()}${
                  posts.length > 0 ? `, ${posts.length} documents` : ""
                }`}
                onClick={() => {
                  const action = calendarDocumentAction(key, posts);
                  onSearchDate?.(action.dateKey);
                }}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </section>
    </details>
  );
}

function focusSidebarRow(
  nav: HTMLElement,
  direction: "first" | "last" | "next" | "previous",
): HTMLButtonElement | null {
  const rows = Array.from(
    nav.querySelectorAll<HTMLButtonElement>(
      ".post-editor-folder-main, .post-editor-special-main",
    ),
  );
  if (rows.length === 0) return null;

  const currentIndex = rows.findIndex((row) => row === document.activeElement);
  const lastIndex = rows.length - 1;
  const nextIndex =
    direction === "first"
      ? 0
      : direction === "last"
        ? lastIndex
        : direction === "next"
          ? currentIndex >= lastIndex
            ? 0
            : currentIndex + 1
          : currentIndex <= 0
            ? lastIndex
            : currentIndex - 1;

  const next = rows[nextIndex] ?? null;
  next?.focus({ preventScroll: true });
  return next;
}

function onSidebarNavKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  onReturnToBody?: () => void,
) {
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "ArrowRight") {
    event.preventDefault();
    onReturnToBody?.();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (event.target instanceof HTMLButtonElement) {
      event.target.click();
    }
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => onReturnToBody?.()),
    );
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    focusSidebarRow(event.currentTarget, "first");
    return;
  }

  if (event.key === "End") {
    event.preventDefault();
    focusSidebarRow(event.currentTarget, "last");
  }
}

// A compact inline "new folder" control: names a subfolder under a parent
// path and calls the server action, then refreshes so the new row appears.
function DisclosureIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`post-editor-disclosure-icon${open ? " is-open" : ""}`}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FolderTreeNode = { folder: Folder; children: FolderTreeNode[] };

function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(folder);
    byParent.set(key, list);
  }
  const materialize = (folder: Folder): FolderTreeNode => ({
    folder,
    children: (byParent.get(folder.id) ?? [])
      .slice()
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      )
      .map(materialize),
  });
  // Roots (the three system folders) keep the order getFolders returned them
  // in (position, then createdAt): Blog, Notes, Bookmarks.
  return (byParent.get(null) ?? []).map(materialize);
}

const FOLDER_EXPANDED_KEY = "texttext.folders.expanded";
const FOLDER_EXPANDED_EVENT = "texttext:folders-expanded";
const MAX_FOLDER_DEPTH = 4;

function persistedExpandedSnapshot(): string {
  try {
    return window.localStorage.getItem(FOLDER_EXPANDED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeExpandedFolders(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(FOLDER_EXPANDED_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(FOLDER_EXPANDED_EVENT, notify);
  };
}

function persistExpandedFolders(ids: Set<string>) {
  try {
    window.localStorage.setItem(FOLDER_EXPANDED_KEY, JSON.stringify([...ids]));
    window.dispatchEvent(new Event(FOLDER_EXPANDED_EVENT));
  } catch {
    // The active-folder ancestors still remain visible without persistence.
  }
}

// The Apple Notes-style nested folder tree: disclosure triangles, indentation
// by depth, per-folder "new subfolder", and expand state that persists and
// auto-opens the branch containing the active folder.
function FolderTreeNav({
  blog,
  folders,
  activeFolder,
  counts,
  collapsed,
  prefetchFolders = true,
  canManageSharing,
  canManageFolders,
  onSelectFolder,
  onChangeFolderLook,
  onBuildItemType,
  onShareFolder,
  homePath,
}: {
  blog: Blog;
  folders: Folder[];
  activeFolder: SidebarFolderId | null;
  counts: Record<string, number>;
  collapsed: boolean;
  prefetchFolders?: boolean;
  canManageSharing: boolean;
  canManageFolders: boolean;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onChangeFolderLook: (folder: Folder) => void;
  onBuildItemType?: (folder: Folder) => void;
  onShareFolder: (folder: Folder) => void;
  homePath?: string;
}) {
  const router = useRouter();
  const tree = buildFolderTree(folders);
  const foldersById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const foldersByPath = useMemo(
    () => new Map(folders.map((folder) => [folder.path, folder])),
    [folders],
  );

  const expandedSnapshot = useSyncExternalStore(
    subscribeExpandedFolders,
    persistedExpandedSnapshot,
    () => "[]",
  );
  const persistedExpanded = useMemo(() => {
    try {
      return new Set(JSON.parse(expandedSnapshot) as string[]);
    } catch {
      return new Set<string>();
    }
  }, [expandedSnapshot]);
  const expanded = useMemo(() => {
    const next = new Set(persistedExpanded);
    let node = activeFolder ? foldersByPath.get(activeFolder) : undefined;
    while (node?.parentId) {
      next.add(node.parentId);
      node = foldersById.get(node.parentId);
    }
    return next;
  }, [activeFolder, foldersById, foldersByPath, persistedExpanded]);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [moreOpenFor, setMoreOpenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeMoreMenu = useCallback(() => setMoreOpenFor(null), []);
  useEscapeLayer(Boolean(moreOpenFor), "Folder actions", closeMoreMenu);
  useEffect(() => {
    if (!moreOpenFor) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menuRoot =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-folder-more-root]")
          : null;
      if (menuRoot?.dataset.folderMoreRoot === moreOpenFor) {
        return;
      }
      closeMoreMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [closeMoreMenu, moreOpenFor]);
  const prefetchFolder = useCallback(
    (folder: SidebarFolderId) => {
      if (!homePath || !prefetchFolders) return;
      router.prefetch(folderWorkspaceHref(homePath, folder));
    },
    [homePath, prefetchFolders, router],
  );

  const toggle = (id: string) => {
    const next = new Set(persistedExpanded);
    if (expanded.has(id)) next.delete(id);
    else next.add(id);
    persistExpandedFolders(next);
  };

  const submitNewFolder = async (parentPath: string) => {
    const clean = newName.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createSubfolderAction(blog.handle, parentPath, clean);
      setNewName("");
      setCreatingUnder(null);
      // Make sure the parent is open so the new child is visible.
      const parent = foldersByPath.get(parentPath);
      if (parent) {
        persistExpandedFolders(new Set(persistedExpanded).add(parent.id));
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the folder");
    } finally {
      setBusy(false);
    }
  };

  const submitRenameFolder = async (folder: Folder) => {
    const clean = renameName.trim().replace(/\s+/g, " ");
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await renameFolderAction(blog.handle, folder.id, clean);
      updateFolder(folder.id, { name: saved.name });
      setRenamingFolder(null);
      setRenameName("");
      router.refresh();
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Could not rename the folder",
      );
    } finally {
      setBusy(false);
    }
  };

  const renderNode = (node: FolderTreeNode, depth: number): ReactNode => {
    const { folder, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(folder.id);
    const selected = folder.path === activeFolder;
    const count = counts[folder.path] ?? 0;
    const canNest = folder.path.split("/").length < MAX_FOLDER_DEPTH;
    const indent = depth * 15;
    return (
      <div className="post-editor-folder-branch" key={folder.id}>
        <div
          className={`post-editor-folder-row${selected ? " is-active" : ""}`}
          style={{ paddingLeft: indent }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="post-editor-folder-disclosure"
              aria-label={isExpanded ? "Collapse" : "Expand"}
              aria-expanded={isExpanded}
              onClick={() => toggle(folder.id)}
            >
              <DisclosureIcon open={isExpanded} />
            </button>
          ) : (
            <span
              className="post-editor-folder-disclosure is-empty"
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            className="post-editor-folder-main"
            data-workspace-sidebar-path={folder.path}
            aria-current={selected ? "true" : undefined}
            title={collapsed ? folder.name : undefined}
            onFocus={() => prefetchFolder(folder.path)}
            onMouseMove={(event) => {
              if (workspaceMouseMoved(event.clientX, event.clientY)) {
                prefetchFolder(folder.path);
              }
            }}
            onClick={() => onSelectFolder(folder.path)}
          >
            <span className="post-editor-folder-icon" aria-hidden="true">
              <SidebarFolderIcon mode={folder.mode} />
            </span>
            <span className="post-editor-folder-name">{folder.name}</span>
          </button>
          {(canManageFolders || canManageSharing) && (
            <span
              className="post-editor-folder-trailing"
              data-folder-more-root={folder.path}
            >
              {count > 0 && (
                <span className="post-editor-folder-count" aria-hidden="true">
                  {count}
                </span>
              )}
              <button
                type="button"
                className="post-editor-folder-more"
                aria-label={`Folder options for ${folder.name}`}
                aria-haspopup="menu"
                aria-expanded={moreOpenFor === folder.path}
                onClick={() =>
                  setMoreOpenFor((current) =>
                    current === folder.path ? null : folder.path,
                  )
                }
              >
                ···
              </button>
              {moreOpenFor === folder.path && (
                <span
                  className="folder-action-menu is-right post-editor-folder-more-menu"
                  role="menu"
                  data-post-edit-menu-open="true"
                >
                  {canManageFolders && canNest && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpenFor(null);
                        setCreatingUnder(folder.path);
                        setNewName("");
                        setError(null);
                        persistExpandedFolders(
                          new Set(persistedExpanded).add(folder.id),
                        );
                      }}
                    >
                      New subfolder
                    </button>
                  )}
                  {canManageSharing && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpenFor(null);
                        onShareFolder(folder);
                      }}
                    >
                      Share
                    </button>
                  )}
                  {canManageFolders && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpenFor(null);
                        onBuildItemType?.(folder);
                      }}
                    >
                      Build with AI
                    </button>
                  )}
                  {canManageFolders && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpenFor(null);
                        setRenamingFolder(folder.path);
                        setRenameName(folder.name);
                        setError(null);
                      }}
                    >
                      Rename
                    </button>
                  )}
                  {canManageFolders && (
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpenFor(null);
                        onChangeFolderLook(folder);
                      }}
                    >
                      Change look
                    </button>
                  )}
                </span>
              )}
            </span>
          )}
        </div>
        {creatingUnder === folder.path && (
          <div
            className="post-editor-new-folder-form"
            style={{ paddingLeft: indent + 15 }}
          >
            <input
              className="post-editor-new-folder-input"
              value={newName}
              autoFocus
              placeholder="Folder name"
              maxLength={80}
              disabled={busy}
              onChange={(event) => setNewName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitNewFolder(folder.path);
                } else if (event.key === "Escape") {
                  setCreatingUnder(null);
                  setNewName("");
                }
              }}
              onBlur={() => {
                if (!newName.trim()) setCreatingUnder(null);
              }}
              aria-label={`New folder name in ${folder.name}`}
            />
            {error && (
              <span className="post-editor-new-folder-error">{error}</span>
            )}
          </div>
        )}
        {renamingFolder === folder.path && (
          <div
            className="post-editor-new-folder-form"
            style={{ paddingLeft: indent + 15 }}
          >
            <input
              className="post-editor-new-folder-input"
              value={renameName}
              autoFocus
              placeholder="Folder name"
              maxLength={80}
              disabled={busy}
              onChange={(event) => setRenameName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRenameFolder(folder);
                } else if (event.key === "Escape") {
                  setRenamingFolder(null);
                  setRenameName("");
                }
              }}
              onBlur={() => {
                if (!renameName.trim()) setRenamingFolder(null);
              }}
              aria-label={`Rename ${folder.name}`}
            />
            {error && (
              <span className="post-editor-new-folder-error">{error}</span>
            )}
          </div>
        )}
        {hasChildren && isExpanded && (
          <div className="post-editor-folder-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <>{tree.map((node) => renderNode(node, 0))}</>;
}

export function PostFolderSidebar({
  blog,
  activeFolder,
  collapsed,
  counts,
  documents = [],
  prefetchFolders = true,
  canManageFolders = false,
  canManageSharing = false,
  folders,
  homeActive = activeFolder === null,
  homePath,
  onSelectRoot,
  onSelectFolder,
  onSearchDate,
  onReturnToBody,
  onSidebarFocus,
  onSidebarEmptyPointerDown,
  onSettings,
  onBuildItemType,
  onToggleCollapsed,
  sharedCount = 0,
  starredCount = 0,
  trashCount = 0,
}: {
  blog: Blog;
  activeFolder: SidebarFolderId | null;
  collapsed: boolean;
  counts: Record<string, number>;
  documents?: WorkspacePoolPost[];
  prefetchFolders?: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  folders: Folder[];
  homeActive?: boolean;
  homePath?: string;
  onSelectRoot?: () => void;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onSearchDate?: (dateKey: string) => void;
  onReturnToBody?: () => void;
  onSidebarFocus?: (path: string) => void;
  onSidebarEmptyPointerDown?: (nav: HTMLElement) => void;
  onSettings?: () => void;
  onBuildItemType?: (folder: Folder) => void;
  onToggleCollapsed: () => void;
  sharedCount?: number;
  starredCount?: number;
  trashCount?: number;
}) {
  const navFolders =
    folders.length > 0 || !canManageFolders ? folders : FALLBACK_FOLDERS;
  const [sharingFolder, setSharingFolder] = useState<Folder | null>(null);
  const [folderLook, setFolderLook] = useState<Folder | null>(null);
  const sidebarRouter = useRouter();
  return (
    <aside
      className={`ac-sidebar ac-chrome post-editor-sidebar${
        collapsed ? " is-collapsed" : ""
      }`}
      aria-label="Folder navigation"
      onFocusCapture={(event) => {
        const row =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-workspace-sidebar-path]")
            : null;
        if (row) onSidebarFocus?.(row.dataset.workspaceSidebarPath ?? "");
      }}
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(
            "button, a, input, select, textarea, [role=menu]",
          )
        ) {
          return;
        }
        const nav = event.currentTarget.querySelector<HTMLElement>(
          ".post-editor-folder-nav",
        );
        if (nav) onSidebarEmptyPointerDown?.(nav);
      }}
    >
      <div className="post-editor-sidebar-top">
        <span className="post-editor-sidebar-workspace-menu">
          <WorkspaceMenuMount
            blogName={blog.name}
            canManageSharing={canManageSharing}
            handle={blog.handle}
            onSettings={onSettings}
          />
        </span>
        <SidebarToggleControl
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
        />
      </div>

      <nav
        className="post-editor-folder-nav"
        aria-label="Folders"
        tabIndex={-1}
        onKeyDown={(event) => onSidebarNavKeyDown(event, onReturnToBody)}
      >
        <div
          className={`post-editor-folder-row post-editor-home-row${
            homeActive ? " is-active" : ""
          }`}
        >
          <button
            type="button"
            className="post-editor-folder-main post-editor-special-main"
            data-workspace-sidebar-path=""
            aria-current={homeActive ? "page" : undefined}
            onClick={onSelectRoot}
          >
            <span className="post-editor-folder-icon" aria-hidden="true">
              <HomeIcon />
            </span>
            <span className="post-editor-folder-name">Home</span>
          </button>
        </div>
        <div className="post-editor-special-folders">
          {canManageFolders && (
            <div
              className={`post-editor-folder-row post-editor-special-row${
                activeFolder === STARRED_FOLDER_PATH ? " is-active" : ""
              }`}
            >
              <button
                type="button"
                className="post-editor-folder-main post-editor-special-main"
                data-workspace-sidebar-path={STARRED_FOLDER_PATH}
                aria-current={
                  activeFolder === STARRED_FOLDER_PATH ? "true" : undefined
                }
                title={collapsed ? "Starred" : undefined}
                onClick={() => onSelectFolder(STARRED_FOLDER_PATH)}
              >
                <span className="post-editor-folder-icon" aria-hidden="true">
                  <StarredIcon />
                </span>
                <span className="post-editor-folder-name">Starred</span>
              </button>
              {starredCount > 0 && (
                <span className="post-editor-folder-count" aria-hidden="true">
                  {starredCount}
                </span>
              )}
            </div>
          )}
          <div
            className={`post-editor-folder-row post-editor-special-row${
              activeFolder === SHARED_FOLDER_PATH ? " is-active" : ""
            }`}
          >
            <button
              type="button"
              className="post-editor-folder-main post-editor-special-main"
              data-workspace-sidebar-path={SHARED_FOLDER_PATH}
              aria-current={
                activeFolder === SHARED_FOLDER_PATH ? "true" : undefined
              }
              title={collapsed ? "Shared with me" : undefined}
              onClick={() => onSelectFolder(SHARED_FOLDER_PATH)}
            >
              <span className="post-editor-folder-icon" aria-hidden="true">
                <SharedIcon />
              </span>
              <span className="post-editor-folder-name">Shared with me</span>
            </button>
            {sharedCount > 0 && (
              <span className="post-editor-folder-count" aria-hidden="true">
                {sharedCount}
              </span>
            )}
          </div>
          <div
            className={`post-editor-folder-row post-editor-special-row${
              activeFolder === TRASH_FOLDER_PATH ? " is-active" : ""
            }`}
          >
            <button
              type="button"
              className="post-editor-folder-main post-editor-special-main"
              data-workspace-sidebar-path={TRASH_FOLDER_PATH}
              aria-current={
                activeFolder === TRASH_FOLDER_PATH ? "true" : undefined
              }
              title={collapsed ? "Trash" : undefined}
              onClick={() => onSelectFolder(TRASH_FOLDER_PATH)}
            >
              <span className="post-editor-folder-icon" aria-hidden="true">
                <TrashIcon />
              </span>
              <span className="post-editor-folder-name">Trash</span>
            </button>
            {trashCount > 0 && (
              <span className="post-editor-folder-count" aria-hidden="true">
                {trashCount}
              </span>
            )}
          </div>
        </div>
        <p className="post-editor-nav-heading is-collections">Collections</p>
        <FolderTreeNav
          blog={blog}
          folders={navFolders}
          activeFolder={activeFolder}
          counts={counts}
          collapsed={collapsed}
          prefetchFolders={prefetchFolders}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          homePath={homePath}
          onSelectFolder={onSelectFolder}
          onChangeFolderLook={setFolderLook}
          onBuildItemType={onBuildItemType}
          onShareFolder={setSharingFolder}
        />
      </nav>

      {!collapsed && (
        <SidebarActivity documents={documents} onSearchDate={onSearchDate} />
      )}

      {folderLook && (
        <FolderLookPicker
          handle={blog.handle}
          folderPath={folderLook.path}
          folderName={folderLook.name}
          onClose={() => setFolderLook(null)}
          onChanged={() => sidebarRouter.refresh()}
        />
      )}
      {sharingFolder && (
        <ShareDialog
          handle={blog.handle}
          scopeType="folder"
          scopeId={sharingFolder.id}
          title="Share folder"
          subtitle={sharingFolder.path}
          open={Boolean(sharingFolder)}
          onClose={() => setSharingFolder(null)}
        />
      )}
    </aside>
  );
}

export function WorkspaceSidebarChrome({
  activeFolder,
  blog,
  collapsed,
  canManageFolders = false,
  canManageSharing = false,
  counts,
  documents = [],
  folders,
  homeActive = activeFolder === null,
  homePath,
  onSelectFolder,
  onSearchDate,
  onReturnToBody,
  onSidebarFocus,
  onSidebarEmptyPointerDown,
  onSettings,
  onBuildItemType,
  onSelectRoot,
  prefetchFolders = true,
  onToggleCollapsed,
  escapeToCollapse = true,
  sharedCount = 0,
  starredCount = 0,
  trashCount = 0,
  peeking = false,
  onPeekEngage,
}: {
  activeFolder: SidebarFolderId | null;
  blog: Blog;
  collapsed: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  counts: Record<string, number>;
  documents?: WorkspacePoolPost[];
  folders: Folder[];
  homeActive?: boolean;
  homePath?: string;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onSearchDate?: (dateKey: string) => void;
  onReturnToBody?: () => void;
  onSidebarFocus?: (path: string) => void;
  onSidebarEmptyPointerDown?: (nav: HTMLElement) => void;
  onSettings?: () => void;
  onBuildItemType?: (folder: Folder) => void;
  onSelectRoot?: () => void;
  prefetchFolders?: boolean;
  onToggleCollapsed: () => void;
  escapeToCollapse?: boolean;
  sharedCount?: number;
  starredCount?: number;
  trashCount?: number;
  peeking?: boolean;
  onPeekEngage?: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { width: sidebarWidth, setWidth: setSidebarWidth } =
    useWorkspaceSidebarWidth();
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--workspace-sidebar-width",
      `${sidebarWidth}px`,
    );
  }, [sidebarWidth]);
  const selectFolder = useCallback(
    (folder: SidebarFolderId) => {
      disarmWorkspaceHover();
      setMobileOpen(false);
      onSelectFolder(folder);
    },
    [onSelectFolder],
  );
  const selectRoot = useCallback(() => {
    disarmWorkspaceHover();
    setMobileOpen(false);
    onSelectRoot?.();
  }, [onSelectRoot]);
  const closeSidebar = useCallback(() => {
    setMobileOpen(false);
  }, []);
  const openSidebar = useCallback(() => {
    if (window.matchMedia(WORKSPACE_COMPACT_MEDIA_QUERY).matches) {
      setMobileOpen(true);
      return;
    }
    if (collapsed) onToggleCollapsed();
  }, [collapsed, onToggleCollapsed]);
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(WORKSPACE_COMPACT_MEDIA_QUERY).matches) {
      setMobileOpen(false);
      return;
    }
    onToggleCollapsed();
  }, [onToggleCollapsed]);

  useEffect(() => {
    const toggleFromKeyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !event.shiftKey ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "s"
      ) {
        return;
      }
      event.preventDefault();
      if (window.matchMedia(WORKSPACE_COMPACT_MEDIA_QUERY).matches) {
        if (mobileOpen) toggleSidebar();
        else openSidebar();
      } else if (collapsed) openSidebar();
      else toggleSidebar();
    };
    window.addEventListener("keydown", toggleFromKeyboard, true);
    return () =>
      window.removeEventListener("keydown", toggleFromKeyboard, true);
  }, [collapsed, mobileOpen, openSidebar, toggleSidebar]);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onPointerMove = (moveEvent: PointerEvent) => {
        const viewportLimit = Math.max(
          WORKSPACE_SIDEBAR_MIN_WIDTH,
          window.innerWidth - 360,
        );
        setSidebarWidth(
          Math.min(viewportLimit, startWidth + moveEvent.clientX - startX),
        );
      };
      const finish = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [setSidebarWidth, sidebarWidth],
  );

  const resizeWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 12;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth(sidebarWidth - step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth(sidebarWidth + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        setSidebarWidth(WORKSPACE_SIDEBAR_MIN_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        setSidebarWidth(WORKSPACE_SIDEBAR_MAX_WIDTH);
      }
    },
    [setSidebarWidth, sidebarWidth],
  );

  useEscapeLayer(escapeToCollapse && mobileOpen, "Sidebar", closeSidebar);

  return (
    <>
      <div
        className={`post-workspace-sidebar-region${
          collapsed ? " is-collapsed" : ""
        }${mobileOpen ? " is-mobile-open" : ""}${peeking ? " is-peeking" : ""}`}
        style={
          {
            "--workspace-sidebar-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
        onFocusCapture={() => {
          if (peeking) onPeekEngage?.();
        }}
        onPointerDownCapture={() => {
          if (peeking) onPeekEngage?.();
        }}
      >
        <PostFolderSidebar
          blog={blog}
          activeFolder={activeFolder}
          collapsed={collapsed && !mobileOpen && !peeking}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          counts={counts}
          documents={documents}
          folders={folders}
          homeActive={homeActive}
          homePath={homePath}
          onSelectFolder={selectFolder}
          onSearchDate={onSearchDate}
          onReturnToBody={onReturnToBody}
          onSidebarFocus={onSidebarFocus}
          onSidebarEmptyPointerDown={onSidebarEmptyPointerDown}
          onSelectRoot={selectRoot}
          onSettings={onSettings}
          onBuildItemType={onBuildItemType}
          prefetchFolders={prefetchFolders}
          onToggleCollapsed={toggleSidebar}
          sharedCount={sharedCount}
          starredCount={starredCount}
          trashCount={trashCount}
        />
        {!collapsed && (
          <div
            className="post-sidebar-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={WORKSPACE_SIDEBAR_MIN_WIDTH}
            aria-valuemax={WORKSPACE_SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            onPointerDown={beginResize}
            onKeyDown={resizeWithKeyboard}
          />
        )}
      </div>
      {collapsed && !mobileOpen && (
        <div className="workspace-sidebar-reveal-chrome ac-chrome">
          <SidebarToggleControl collapsed onToggleCollapsed={openSidebar} />
        </div>
      )}
      {!collapsed && !mobileOpen && (
        <div className="workspace-sidebar-reveal-chrome is-mobile-only ac-chrome">
          <SidebarToggleControl collapsed onToggleCollapsed={openSidebar} />
        </div>
      )}
      <div className="workspace-history-chrome ac-chrome">
        <WorkspaceHistoryControls />
      </div>
      <button
        type="button"
        className={`post-sidebar-backdrop${mobileOpen ? " is-open" : ""}`}
        aria-label="Hide sidebar"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={closeSidebar}
      />
    </>
  );
}

type LocalWorkspaceView =
  | { level: "root" }
  | ({ level: "search" } & WorkspaceSearchLocation)
  | { level: "settings" }
  | { folderPath: string; level: "section" }
  | { folderPath: typeof TRASH_FOLDER_PATH; level: "trash" }
  | { folderPath: typeof SHARED_FOLDER_PATH; level: "shared" }
  | { folderPath: typeof STARRED_FOLDER_PATH; level: "starred" }
  | {
      folderPath: string;
      level: "post";
      postId: string;
      openedFrom?: "folder" | "root" | "search";
      returnToSearch?: WorkspaceSearchLocation;
    }
  | {
      folderPath: string;
      level: "edit";
      postId: string;
      openedFrom?: "folder" | "root" | "search";
      returnToSearch?: WorkspaceSearchLocation;
    };

type WorkspaceActiveRegion = "body" | "sidebar";

function encodedTenantHomePath(blog: Blog): string {
  return `/t/${encodeURIComponent(blog.handle)}`;
}

function trimTrailingSlash(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

function viewFromUrl(
  pool: WorkspacePoolPayload,
  homePath: string,
  url: URL,
): LocalWorkspaceView {
  const pathname = trimTrailingSlash(url.pathname);
  const homePaths = [
    trimTrailingSlash(homePath),
    trimTrailingSlash(encodedTenantHomePath(pool.blog)),
  ];
  const matchingHome = homePaths.find(
    (candidate) =>
      pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  if (!matchingHome) return { level: "root" };

  if (pathname === matchingHome) {
    if (url.searchParams.get("view") === "settings") {
      return { level: "settings" };
    }
    const folderPath = url.searchParams.get("folder");
    if (folderPath === TRASH_FOLDER_PATH) {
      return { level: "trash", folderPath: TRASH_FOLDER_PATH };
    }
    if (folderPath === SHARED_FOLDER_PATH) {
      return { level: "shared", folderPath: SHARED_FOLDER_PATH };
    }
    if (folderPath === STARRED_FOLDER_PATH) {
      return { level: "starred", folderPath: STARRED_FOLDER_PATH };
    }
    if (
      folderPath &&
      pool.folders.some((folder) => folder.path === folderPath)
    ) {
      return { level: "section", folderPath };
    }
    const searchLocation = workspaceSearchLocationFromUrl(url);
    if (searchLocation) return { level: "search", ...searchLocation };
    return { level: "root" };
  }

  const rest = pathname.slice(matchingHome.length + 1);
  const [encodedSlug = ""] = rest.split("/");
  if (!encodedSlug || encodedSlug === "c") return { level: "root" };
  const slug = decodeURIComponent(encodedSlug);
  const editRequested = url.searchParams.get("edit") === "1";
  const editId = url.searchParams.get("id");
  const post =
    editRequested && editId
      ? (findPoolPostById(pool, editId) ?? findPoolPostBySlug(pool, slug))
      : findPoolPostBySlug(pool, slug);
  if (!post) return { level: "root" };
  return {
    level: editRequested || post.type === "note" ? "edit" : "post",
    postId: post.id,
    folderPath: folderPathForPoolPost(pool, post),
    returnToSearch: workspaceSearchReturnFromUrl(url),
  };
}

function currentLocalView(
  pool: WorkspacePoolPayload,
  homePath: string,
): LocalWorkspaceView {
  if (typeof window === "undefined") return { level: "root" };
  return viewFromUrl(pool, homePath, new URL(window.location.href));
}

function localWorkspaceViewDepth(view: LocalWorkspaceView): number {
  if (view.level === "root" || view.level === "search") return 0;
  if (
    view.level === "settings" ||
    view.level === "section" ||
    view.level === "trash" ||
    view.level === "shared" ||
    view.level === "starred"
  ) {
    return 1;
  }
  return 2;
}

function localViewActiveFolder(
  view: LocalWorkspaceView,
): SidebarFolderId | null {
  if (
    view.level === "root" ||
    view.level === "search" ||
    view.level === "settings"
  ) {
    return null;
  }
  return view.folderPath;
}

function isOptimisticPostId(postId: string): boolean {
  return postId.startsWith("optimistic-");
}

function workspaceActionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function autoGrowTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
}

function HighlightSearchText({
  query,
  value,
}: {
  query: string;
  value: string;
}) {
  const clean = query.trim();
  if (!clean) return value;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = value.split(new RegExp(`(${escaped})`, "ig"));
  return parts.map((part, index) =>
    part.toLocaleLowerCase() === clean.toLocaleLowerCase() ? (
      <mark key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  );
}

function WorkspaceSearchActionBar({ onSearch }: { onSearch: () => void }) {
  return (
    <div
      className="workspace-root-action-bar applecms"
      aria-label="Workspace actions"
    >
      <div className="workspace-root-action-toolbar ac-chrome">
        <WorkspaceSearchButton onSearch={onSearch} />
      </div>
    </div>
  );
}

function WorkspaceRootSearchActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="workspace-root-action-bar is-inline-search applecms"
      aria-label="Workspace actions"
    >
      <div className="workspace-root-action-toolbar ac-chrome">{children}</div>
    </div>
  );
}

function itemPreview(post: { excerpt?: string; bodyPreview?: string }): string {
  return plainTextExcerpt(post.excerpt) || plainTextExcerpt(post.bodyPreview);
}

function WorkspacePostOption({
  active,
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
  selected,
  showUpdatedAt = false,
}: {
  active: boolean;
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
  selected: boolean;
  showUpdatedAt?: boolean;
}) {
  return (
    <div
      id={`workspace-root-post-${domSafeId(post.id)}`}
      className={`workspace-item-option${selected ? " is-command-selected" : ""}`}
      data-workspace-post-id={post.id}
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      title={showUpdatedAt ? sidebarDocumentTitle(post) : undefined}
      onFocus={() => onSelect(post.id)}
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
}

function WorkspaceRootLanding({
  canManageItems,
  captureFocusRequestKey,
  focusRequestKey,
  onCreateItem,
  onEditCreatedPost,
  onOpenPost,
  onOpenSection,
  onOpenTag,
  onDeletePost,
  onItemClick,
  onQueryChange,
  onSelectPost,
  onSelectSection,
  pool,
  query,
  source,
  selectedPostId,
  selectedPostIds,
  selectedSectionPath,
  assistantConnection,
  assistantCloudProvider,
  onConnectAssistant,
  onOpenAssistant,
  onBuildItemType,
  onFocusCapture,
  settingsHref,
}: {
  canManageItems: boolean;
  captureFocusRequestKey: number;
  focusRequestKey: number;
  onCreateItem?: FolderCreateItem;
  onEditCreatedPost: (postId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenSection: (folderPath: string) => void;
  onOpenTag: (tag: string) => void;
  onDeletePost?: FolderDeleteItem;
  onItemClick: (postId: string, event: ReactMouseEvent<HTMLElement>) => boolean;
  onQueryChange: (query: string) => void;
  onSelectPost: (postId: string) => void;
  onSelectSection: (folderPath: string) => void;
  pool: WorkspacePoolPayload;
  query: string;
  source: WorkspaceSearchLocation["source"];
  selectedPostId: string | null;
  selectedPostIds: ReadonlySet<string>;
  selectedSectionPath: string | null;
  assistantConnection: AiConnectionSnapshot | null;
  assistantCloudProvider?: string | null;
  onConnectAssistant?: () => void;
  onOpenAssistant: () => void;
  onBuildItemType: () => void;
  onFocusCapture: () => void;
  settingsHref: string;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const requestedBodiesRef = useRef(new Set<string>());
  const [bodyRevision, setBodyRevision] = useState(0);
  const [sort, setSort] = useState<SidebarDocumentSort>("recent");
  // Home's layout is the workspace's one stored layout choice, so it travels
  // with the workspace instead of with the browser that set it. Every folder
  // page, Blog included, takes its layout from the look on the folder; this
  // control governs Home and nothing else.
  const [recentViewMode, setRecentViewMode] = useState<BlogHomeView>(
    pool.blog.homeLayout,
  );
  const [homeViewError, setHomeViewError] = useState<string | null>(null);
  const commitHomeView = useCallback(
    (homeLayout: BlogHomeView) => {
      const previous = recentViewMode;
      setRecentViewMode(homeLayout);
      setHomeViewError(null);
      // A viewer who cannot manage the workspace still gets to switch views;
      // theirs simply is not saved for everyone.
      if (!canManageItems) return;
      void updateBlogAction({ homeLayout }, pool.blog.handle).catch(() => {
        setRecentViewMode(previous);
        setHomeViewError("Could not save");
      });
    },
    [canManageItems, pool.blog.handle, recentViewMode],
  );
  const [itemFilter, setItemFilter] = useState<
    "all" | "article" | "note" | "bookmark"
  >("all");
  const creationFolders = useMemo(() => rootSectionFolders(pool), [pool]);
  const creationFolder = creationFolders[0];
  // The server cannot see localStorage. Start both sides from the same list,
  // then layer personal recency on after hydration so a previously opened
  // document cannot reorder the Library while React is attaching to it.
  const [openHistory, setOpenHistory] = useState<WorkspaceDocumentOpenHistory>(
    {},
  );
  const activeId = selectedSectionPath
    ? `workspace-root-section-${domSafeId(selectedSectionPath)}`
    : selectedPostId
      ? `workspace-root-post-${domSafeId(selectedPostId)}`
      : undefined;
  const bodies = useMemo(() => {
    void bodyRevision;
    const indexed: Record<string, string> = {};
    for (const body of pool.initialBodies ?? [])
      indexed[body.postId] = body.body;
    for (const post of pool.posts) {
      const cached = getCachedWorkspacePostBody(pool.blogId, post.id)?.body;
      if (cached !== undefined) indexed[post.id] = cached;
    }
    return indexed;
    // bodyRevision intentionally refreshes this synchronous cache after a lazy
    // IndexedDB or body fetch finishes.
  }, [bodyRevision, pool]);
  const results = useMemo(
    () =>
      searchWorkspace({
        bodies,
        folders: pool.folders,
        posts: pool.posts,
        query,
      }),
    [bodies, pool.folders, pool.posts, query],
  );
  const dateKey = parseWorkspaceDateQuery(query);
  const bodyMode = source === "tag" ? "tag" : workspaceRootBodyMode(query);
  const tagPosts = useMemo(
    () => (source === "tag" ? poolPostsForTag(pool, query) : []),
    [pool, query, source],
  );
  const dateLabel = dateKey
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
      }).format(new Date(`${dateKey}T12:00:00`))
    : null;
  const dateActivity = useMemo(
    () =>
      dateKey
        ? documentsForActivityDate(pool.posts, dateKey)
        : { created: [], edited: [] },
    [dateKey, pool.posts],
  );
  const recent = useMemo(() => {
    const sorted = sortSidebarDocuments(pool.posts, sort, openHistory);
    const filtered =
      itemFilter === "all"
        ? sorted
        : sorted.filter((post) => post.type === itemFilter);
    return filtered.slice(0, 30);
  }, [itemFilter, openHistory, pool.posts, sort]);
  const itemCounts = useMemo(
    () => ({
      all: pool.posts.length,
      article: pool.posts.filter((post) => post.type === "article").length,
      note: pool.posts.filter((post) => post.type === "note").length,
      bookmark: pool.posts.filter((post) => post.type === "bookmark").length,
    }),
    [pool.posts],
  );

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      setOpenHistory(
        readWorkspaceDocumentOpenHistory(pool.blog.handle, window.localStorage),
      );
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, [pool.blog.handle]);

  useEffect(() => {
    const opened = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (detail?.workspaceId !== pool.blog.handle) return;
      setOpenHistory(
        readWorkspaceDocumentOpenHistory(pool.blog.handle, window.localStorage),
      );
    };
    window.addEventListener(WORKSPACE_DOCUMENT_OPENED_EVENT, opened);
    return () =>
      window.removeEventListener(WORKSPACE_DOCUMENT_OPENED_EVENT, opened);
  }, [pool.blog.handle]);

  useEffect(() => {
    const clean = query.trim().toLocaleLowerCase();
    if (clean.length < 3 || dateKey || source === "tag") return;
    const pending = pool.posts
      .filter((post) => {
        if (requestedBodiesRef.current.has(post.id) || bodies[post.id]) {
          return false;
        }
        return !`${post.title}\n${post.excerpt ?? ""}\n${post.bodyPreview ?? ""}`
          .toLocaleLowerCase()
          .includes(clean);
      })
      .slice(0, 10);
    if (pending.length === 0) return;
    for (const post of pending) requestedBodiesRef.current.add(post.id);
    void Promise.all(
      pending.map((post) => ensurePostBody(pool.blogId, post.id)),
    ).then(() => setBodyRevision((current) => current + 1));
  }, [bodies, dateKey, pool.blogId, pool.posts, query, source]);

  const changeQuery = (nextQuery: string) => {
    onQueryChange(nextQuery);
  };
  const openResult = (result: WorkspaceSearchResult | undefined) => {
    if (!result) return;
    if (result.kind === "folder") onOpenSection(result.folderPath);
    else onOpenPost(result.postId);
  };
  const selectedSearchResult = results.find((result) =>
    result.kind === "folder"
      ? result.folderPath === selectedSectionPath
      : result.postId === selectedPostId,
  );
  const focusOption = (
    option:
      | WorkspaceSearchResult
      | { kind: "folder"; folderPath: string }
      | { kind: "post"; postId: string }
      | undefined,
  ) => {
    if (!option) return;
    let selector: string;
    if (option.kind === "folder") {
      onSelectSection(option.folderPath);
      selector = `[data-workspace-section-path="${cssAttributeValue(option.folderPath)}"]`;
    } else {
      onSelectPost(option.postId);
      selector = `[data-workspace-post-id="${cssAttributeValue(option.postId)}"]`;
    }
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(selector)?.focus(),
    );
  };
  const handSearchInputToBody = (direction: "down" | "up") => {
    const options =
      bodyMode === "tag"
        ? tagPosts.map((post) => ({
            kind: "post" as const,
            postId: post.id,
          }))
        : bodyMode === "date"
          ? [...dateActivity.created, ...dateActivity.edited].map((post) => ({
              kind: "post" as const,
              postId: post.id,
            }))
          : bodyMode === "search"
            ? results
            : recent.map((post) => ({
                kind: "post" as const,
                postId: post.id,
              }));
    const index = workspaceSearchHandoffIndex(options.length, direction);
    focusOption(index === null ? undefined : options[index]);
  };

  return (
    <main
      className="workspace-root-page"
      aria-labelledby="workspace-root-title"
    >
      <WorkspaceRootSearchActionBar>
        <WorkspaceActionSearch
          ariaLabel="Search workspace"
          focusRequestKey={focusRequestKey}
          inputRef={searchRef}
          placeholder="Search workspace"
          value={query}
          onChange={changeQuery}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              handSearchInputToBody("down");
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              handSearchInputToBody("up");
            } else if (event.key === "Enter") {
              event.preventDefault();
              openResult(selectedSearchResult);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (query) changeQuery("");
              else searchRef.current?.blur();
            }
          }}
        />
      </WorkspaceRootSearchActionBar>
      <div className="workspace-root-inner">
        {bodyMode === "tag" ? (
          <section className="workspace-search-page workspace-tag-page">
            <header>
              <button type="button" onClick={() => changeQuery("")}>
                Back
              </button>
              <h1 id="workspace-root-title">#{query}</h1>
            </header>
            <div
              className="workspace-search-results"
              role="listbox"
              aria-activedescendant={activeId}
            >
              {tagPosts.length === 0 ? (
                <p>No items with this tag.</p>
              ) : (
                tagPosts.map((post) => (
                  <WorkspacePostOption
                    active={selectedPostId === post.id}
                    key={post.id}
                    blog={pool.blog}
                    folderPath={folderPathForPoolPost(pool, post)}
                    handle={pool.blog.handle}
                    post={post}
                    selected={selectedPostIds.has(post.id)}
                    onDeletePost={onDeletePost}
                    onItemClick={onItemClick}
                    onOpen={onOpenPost}
                    onOpenTag={onOpenTag}
                    onSelect={onSelectPost}
                    owner={canManageItems}
                  />
                ))
              )}
            </div>
          </section>
        ) : bodyMode === "date" && dateKey ? (
          <div className="workspace-date-results">
            <header>
              <button type="button" onClick={() => changeQuery("")}>
                Back
              </button>
              <h1 id="workspace-root-title">Activity on {dateLabel}</h1>
            </header>
            {dateActivity.created.length === 0 &&
            dateActivity.edited.length === 0 ? (
              <p>No items were created or edited that day.</p>
            ) : (
              <div
                className="workspace-date-sections"
                role="listbox"
                aria-activedescendant={activeId}
              >
                {dateActivity.created.length > 0 ? (
                  <section>
                    <h2>Created on {dateLabel}</h2>
                    <div className="workspace-recent-list">
                      {dateActivity.created.map((post) => (
                        <WorkspacePostOption
                          active={selectedPostId === post.id}
                          key={post.id}
                          blog={pool.blog}
                          folderPath={folderPathForPoolPost(pool, post)}
                          handle={pool.blog.handle}
                          post={post}
                          selected={selectedPostIds.has(post.id)}
                          onDeletePost={onDeletePost}
                          onItemClick={onItemClick}
                          onOpen={onOpenPost}
                          onOpenTag={onOpenTag}
                          onSelect={onSelectPost}
                          owner={canManageItems}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                {dateActivity.edited.length > 0 ? (
                  <section>
                    <h2>Edited on {dateLabel}</h2>
                    <div className="workspace-recent-list">
                      {dateActivity.edited.map((post) => (
                        <WorkspacePostOption
                          active={selectedPostId === post.id}
                          key={post.id}
                          blog={pool.blog}
                          folderPath={folderPathForPoolPost(pool, post)}
                          handle={pool.blog.handle}
                          post={post}
                          selected={selectedPostIds.has(post.id)}
                          onDeletePost={onDeletePost}
                          onItemClick={onItemClick}
                          onOpen={onOpenPost}
                          onOpenTag={onOpenTag}
                          onSelect={onSelectPost}
                          owner={canManageItems}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        ) : bodyMode === "search" ? (
          <section className="workspace-search-page">
            <h1 id="workspace-root-title">Search results</h1>
            <div
              className="workspace-search-results"
              role="listbox"
              aria-activedescendant={activeId}
            >
              {results.length === 0 ? (
                <p>No matches. Try a title, phrase, or date.</p>
              ) : (
                results.map((result) => {
                  if (result.kind === "post") {
                    const post = pool.posts.find(
                      (candidate) => candidate.id === result.postId,
                    );
                    if (!post) return null;
                    return (
                      <WorkspacePostOption
                        active={selectedPostId === post.id}
                        key={result.id}
                        blog={pool.blog}
                        folderPath={folderPathForPoolPost(pool, post)}
                        handle={pool.blog.handle}
                        post={post}
                        selected={selectedPostIds.has(post.id)}
                        onDeletePost={onDeletePost}
                        onItemClick={onItemClick}
                        onOpen={onOpenPost}
                        onOpenTag={onOpenTag}
                        onSelect={onSelectPost}
                        owner={canManageItems}
                      />
                    );
                  }
                  const selected = result.folderPath === selectedSectionPath;
                  return (
                    <button
                      key={result.id}
                      id={`workspace-root-section-${domSafeId(result.folderPath)}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      className={`workspace-search-folder-option${
                        selected ? " is-command-selected" : ""
                      }`}
                      data-workspace-section-path={result.folderPath}
                      onFocus={() => onSelectSection(result.folderPath)}
                      onClick={() => openResult(result)}
                    >
                      <span>
                        <strong>
                          <HighlightSearchText
                            query={query}
                            value={result.title}
                          />
                        </strong>
                        <small>
                          <HighlightSearchText
                            query={query}
                            value={result.detail}
                          />
                        </small>
                      </span>
                      <em>Folder</em>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        ) : (
          <>
            <header className="workspace-library-header">
              <h1 id="workspace-root-title">Library</h1>
            </header>
            {canManageItems && creationFolder ? (
              <section
                className="workspace-root-create"
                aria-label="Create an item"
              >
                <UniversalItemComposer
                  blog={pool.blog}
                  destinations={creationFolders}
                  focusRequestKey={captureFocusRequestKey}
                  folder={creationFolder}
                  handle={pool.blog.handle}
                  onCreateItem={onCreateItem}
                  onDeleteItem={onDeletePost}
                  onOpenCapturedItem={(post) => {
                    if (post.id) onEditCreatedPost(post.id);
                  }}
                />
                <button
                  type="button"
                  className="workspace-build-type-button"
                  onClick={onBuildItemType}
                >
                  <span aria-hidden="true">✦</span>
                  Build a new item type with AI
                </button>
              </section>
            ) : null}
            <section className={`workspace-recent is-view-${recentViewMode}`}>
              <header className="workspace-library-toolbar">
                <div
                  className="workspace-library-filters"
                  role="group"
                  aria-label="Filter library items"
                >
                  {(
                    [
                      ["all", "All"],
                      ["article", "Articles"],
                      ["note", "Notes"],
                      ["bookmark", "Bookmarks"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={itemFilter === value}
                      onClick={() => setItemFilter(value)}
                    >
                      <span>{label}</span>
                      <small>{itemCounts[value]}</small>
                    </button>
                  ))}
                </div>
                <div className="workspace-library-controls">
                  <select
                    value={sort}
                    aria-label="Sort library items"
                    onChange={(event) =>
                      setSort(event.currentTarget.value as SidebarDocumentSort)
                    }
                  >
                    {/* This sorts by how recently you OPENED an item, with
                        the update time only as a tiebreak, which is why a
                        brand new item does not appear at the top. "Last
                        edited" below is the one that sorts by update time. */}
                    <option value="recent">Recently opened</option>
                    <option value="alphabetical">Alphabetical</option>
                    <option value="created">Date created</option>
                    <option value="edited">Last edited</option>
                  </select>
                  <WorkspaceViewModeControl
                    mode={recentViewMode}
                    onChange={commitHomeView}
                  />
                  {homeViewError && (
                    <span className="workspace-library-error" role="alert">
                      {homeViewError}
                    </span>
                  )}
                </div>
              </header>
              {recent.length === 0 ? (
                <div className="workspace-recent-empty">
                  {itemFilter === "all" ? (
                    <div className="workspace-first-loop">
                      <div>
                        <strong>Your first TextText loop</strong>
                        <span>One thought becomes durable, findable work.</span>
                      </div>
                      <ol>
                        <li>
                          <b>1</b>
                          <span><strong>Capture</strong> Save a thought above.</span>
                        </li>
                        <li>
                          <b>2</b>
                          <span><strong>Find</strong> Press / and search any words you remember.</span>
                        </li>
                        <li>
                          <b>3</b>
                          <span><strong>Change</strong> Open it, ask your AI, then review the receipt.</span>
                        </li>
                      </ol>
                      {canManageItems && creationFolder ? (
                        <button
                          type="button"
                          className="ac-btn ac-btn-filled"
                          onClick={onFocusCapture}
                        >
                          Save your first thought
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <p>Nothing here with that filter.</p>
                      <button
                        type="button"
                        className="ac-btn ac-btn-gray"
                        onClick={() => setItemFilter("all")}
                      >
                        Show all items
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="workspace-recent-list" role="listbox">
                  {recent.map((post) => (
                    <WorkspacePostOption
                      active={selectedPostId === post.id}
                      key={post.id}
                      blog={pool.blog}
                      folderPath={folderPathForPoolPost(pool, post)}
                      handle={pool.blog.handle}
                      post={post}
                      selected={selectedPostIds.has(post.id)}
                      showUpdatedAt
                      onDeletePost={onDeletePost}
                      onItemClick={onItemClick}
                      onOpen={onOpenPost}
                      onOpenTag={onOpenTag}
                      onSelect={onSelectPost}
                      owner={canManageItems}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

type TrashDeleteTarget =
  | { kind: "post"; id: string; label: string }
  | { kind: "folder"; id: string; label: string };

function TrashPage({
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

function SharedPage({ pool }: { pool: WorkspacePoolPayload }) {
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

function StarredPage({
  onDeletePost,
  onItemClick,
  onOpenPost,
  onOpenTag,
  onSelectPost,
  owner,
  pool,
  selectedPostId,
  selectedPostIds,
}: {
  onDeletePost?: FolderDeleteItem;
  onItemClick: (postId: string, event: ReactMouseEvent<HTMLElement>) => boolean;
  onOpenPost: (postId: string) => void;
  onOpenTag: (tag: string) => void;
  onSelectPost: (postId: string) => void;
  owner: boolean;
  pool: WorkspacePoolPayload;
  selectedPostId: string | null;
  selectedPostIds: ReadonlySet<string>;
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
              active={selectedPostId === post.id}
              key={post.id}
              blog={pool.blog}
              folderPath={folderPathForPoolPost(pool, post)}
              handle={pool.blog.handle}
              post={post}
              selected={selectedPostIds.has(post.id)}
              showUpdatedAt
              onDeletePost={onDeletePost}
              onItemClick={onItemClick}
              onOpen={onOpenPost}
              onOpenTag={onOpenTag}
              onSelect={onSelectPost}
              owner={owner}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function WorkspaceSelectionToolbar({
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

function LoadingBody() {
  return (
    <div
      className="workspace-post-body-status"
      aria-label="Loading body"
      role="status"
      style={{ display: "grid", gap: 12, width: "min(100%, 520px)" }}
    >
      {[92, 84, 68].map((width) => (
        <span
          key={width}
          aria-hidden="true"
          style={{
            background: "color-mix(in srgb, var(--muted) 18%, transparent)",
            borderRadius: 999,
            display: "block",
            height: 12,
            width: `${width}%`,
          }}
        />
      ))}
    </div>
  );
}

function ErrorBody({ message }: { message: string }) {
  return <p className="workspace-post-body-status">{message}</p>;
}

function MarkdownBody({
  allowedRemoteImages,
  body,
  hideRemoteImages = false,
  onWikiLinkNavigate,
  wikiLinkTargets = {},
}: {
  allowedRemoteImages?: Set<string>;
  body: string;
  hideRemoteImages?: boolean;
  onWikiLinkNavigate?: (href: string) => Promise<void> | void;
  wikiLinkTargets?: WikiLinkRenderTargets;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkWikiLinks(wikiLinkTargets)]}
      components={{
        a: (props) => (
          <WikiLinkAnchor {...props} onNavigate={onWikiLinkNavigate} />
        ),
        h1: "h2",
        img: ({ src, alt }) => {
          const imageSrc = typeof src === "string" ? src : undefined;
          if (
            hideRemoteImages &&
            isRemoteImageUrl(imageSrc) &&
            !allowedRemoteImages?.has(imageSrc)
          ) {
            return null;
          }
          if (imageSrc && isVideoFile(imageSrc)) {
            return (
              <span className="reader-figure is-video">
                <video src={imageSrc} controls playsInline preload="metadata" />
              </span>
            );
          }
          return (
            <span className="reader-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={upgradeHttpImageSrc(imageSrc)}
                alt={alt ?? ""}
                decoding="async"
                loading="lazy"
              />
              {alt && (
                <span className="reader-figcaption" aria-hidden="true">
                  {alt}
                </span>
              )}
            </span>
          );
        },
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

function safeBookmarkViewUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

function BookmarkViewBody({ post }: { post: Post }) {
  const title = post.title.trim() || post.capture?.title?.trim() || "Bookmark";
  const screenshotUrl = safeBookmarkViewUrl(post.capture?.screenshotUrl);
  const screenshotTiles = (post.capture?.screenshotTiles ?? [])
    .map((tile) => ({ ...tile, url: safeBookmarkViewUrl(tile.url) }))
    .filter((tile) => tile.url)
    .sort((a, b) => a.index - b.index);
  if (screenshotTiles.length > 0 || screenshotUrl) {
    return (
      <section className="bookmark-reader-view is-capture">
        {(screenshotTiles.length > 0
          ? screenshotTiles
          : [{ index: 0, url: screenshotUrl }]
        ).map((tile) => (
          // Captures are already compressed, immutable artifacts.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${tile.index}:${tile.url}`}
            src={tile.url}
            alt={tile.index === 0 ? `Full-page capture of ${title}` : ""}
            decoding="async"
          />
        ))}
      </section>
    );
  }

  return <ErrorBody message="This bookmark capture is not available yet." />;
}

function WorkspacePostReader({
  blog,
  canCommentPost,
  canManagePost,
  homePath,
  onCaptureResolved,
  onNavigate,
  onOpenTag,
  onSearch,
  searchFocusRequestKey,
  pool,
  poolPost,
  returnToSearch,
}: {
  blog: Blog;
  canCommentPost: boolean;
  canManagePost: boolean;
  homePath: string;
  onCaptureResolved?: FolderCaptureResolved;
  onNavigate: (path: string) => Promise<void> | void;
  onOpenTag: (tag: string) => void;
  onSearch: () => void;
  searchFocusRequestKey: number;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
  returnToSearch?: WorkspaceSearchLocation;
}) {
  const initialBody =
    pool.initialBodies?.find((body) => body.postId === poolPost.id) ?? null;
  const { entry, load, stale } = useWorkspacePostBody(
    pool.blogId,
    poolPost.id,
    initialBody,
  );
  const [bookmarkContentState, setBookmarkContentState] = useState<{
    mode: BookmarkContentMode;
    postId: string;
  }>(() => ({ mode: "readable", postId: poolPost.id }));
  const bookmarkContentMode =
    bookmarkContentState.postId === poolPost.id
      ? bookmarkContentState.mode
      : "readable";
  const setBookmarkContentMode = useCallback(
    (mode: BookmarkContentMode) => {
      setBookmarkContentState({ mode, postId: poolPost.id });
    },
    [poolPost.id],
  );
  const [findState, setFindState] = useState({
    postId: poolPost.id,
    query: "",
  });
  const optimistic = isOptimisticPostId(poolPost.id);
  const readerPeers = usePresence(optimistic ? null : poolPost.id);
  const findQuery = findState.postId === poolPost.id ? findState.query : "";
  const setFindQuery = useCallback(
    (query: string) => setFindState({ postId: poolPost.id, query }),
    [poolPost.id],
  );

  useEffect(() => {
    if (poolPost.document) return;
    if (entry.status === "idle" || stale) load(stale);
  }, [entry.status, load, poolPost.document, stale]);

  const body =
    poolPost.document?.content.body ??
    (entry.status === "ready" ? entry.body.body : "");
  const post = postFromPoolPost(poolPost, body);
  const bodyImageReplacements = new Map(
    (post.capture?.assets ?? [])
      .filter((asset) => asset.originalUrl && asset.url)
      .map((asset) => [asset.originalUrl, asset.url] as const),
  );
  const bodyMarkdown =
    post.type === "bookmark"
      ? localizeRemoteMarkdownImages(body, bodyImageReplacements)
      : body;
  const readablePost = useMemo(
    () => ({
      ...post,
      body: bodyMarkdown,
      document: post.document
        ? {
            ...post.document,
            content: { ...post.document.content, body: bodyMarkdown },
          }
        : undefined,
    }),
    [bodyMarkdown, post],
  );
  const backlinks = backlinksForPost(pool, poolPost);
  const template = templateForPoolPost(pool, poolPost);
  const adjacent = adjacentPublishedPostsForPool(pool, post.id ?? post.slug);
  const adjacentPath = (link: NonNullable<typeof adjacent.previous>) => {
    const adjacentPost = link.id ? findPoolPostById(pool, link.id) : null;
    return adjacentPost
      ? blogWorkspacePostPath(
          blog,
          folderPathForPoolPost(pool, adjacentPost),
          adjacentPost,
        )
      : undefined;
  };
  const sectionPath = returnToSearch
    ? workspaceSearchHref(homePath, returnToSearch)
    : folderWorkspaceHref(homePath, folderPathForPoolPost(pool, poolPost));

  return (
    <>
      <PostActionBar
        mode="read"
        owner
        blog={blog}
        post={post}
        presencePeers={readerPeers}
        adjacent={adjacent}
        previousPath={
          adjacent.previous ? adjacentPath(adjacent.previous) : undefined
        }
        nextPath={adjacent.next ? adjacentPath(adjacent.next) : undefined}
        homePath={sectionPath}
        postPath={blogWorkspacePostPath(
          blog,
          folderPathForPoolPost(pool, poolPost),
          post,
        )}
        publishedUrl={
          workspacePublicPostUrl(
            blog.handle,
            folderPathForPoolPost(pool, poolPost),
            post.slug,
          ) ?? undefined
        }
        bookmarkContentMode={bookmarkContentMode}
        canCommentPost={canCommentPost}
        canEditPost
        canManagePost={canManagePost}
        onBookmarkCaptureChange={onCaptureResolved}
        onNavigate={async (path) => {
          await onNavigate(path);
        }}
        onSearch={onSearch}
        searchFocusRequestKey={searchFocusRequestKey}
        searchValue={findQuery}
        onSearchValueChange={setFindQuery}
        onBookmarkContentModeChange={setBookmarkContentMode}
      />
      {post.type === "bookmark" && bookmarkContentMode === "capture" ? (
        <BookmarkViewBody post={post} />
      ) : poolPost.document || entry.status === "ready" ? (
        <UnifiedDocumentReader
          blog={blog}
          post={readablePost}
          template={template}
        />
      ) : entry.status === "error" ? (
        <ErrorBody message={entry.error} />
      ) : (
        <LoadingBody />
      )}
      <ReaderFindHighlights query={findQuery} />
      {canCommentPost && post.id && !optimistic && entry.status === "ready" && (
        <ReaderComments
          key={post.id}
          canResolve={canManagePost}
          handle={blog.handle}
          postId={post.id}
          sourceBody={body}
        />
      )}
      <BacklinksPanel blog={blog} posts={backlinks} onNavigate={onNavigate} />
    </>
  );
}

function collaboratorColor(identity: string): string {
  const palette = ["#0071e3", "#34c759", "#ff9f0a", "#af52de", "#ff375f"];
  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function LocalUnifiedWorkspacePostEditor({
  active,
  blog,
  editorIdentity,
  homePath,
  onDeleteItem,
  onNavigate,
  pool,
  poolPost,
  returnToSearch,
  assistantConnection,
  assistantCloudProvider,
  onOpenAssistant,
}: {
  active: boolean;
  blog: Blog;
  editorIdentity: string;
  homePath: string;
  onDeleteItem?: FolderDeleteItem;
  onNavigate: (path: string) => Promise<void> | void;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
  returnToSearch?: WorkspaceSearchLocation;
  assistantConnection?: AiConnectionSnapshot | null;
  assistantCloudProvider?: string | null;
  onOpenAssistant?: () => void;
}) {
  const activeAgent = assistantAgentIdentity(
    assistantCloudProvider,
    assistantConnection,
    collaboratorColor,
  );
  const template = templateForPoolPost(pool, poolPost);
  // The authoritative body may not be local yet. The pool list omits document
  // bodies, and the cache only knows what THIS browser typed or fetched, so an
  // item written by an agent (or another device) arrived here as an empty
  // editor one keystroke away from overwriting real content with "". The
  // editor now refuses to mount until the body entry resolves; an empty
  // baseline may only mean "this item is empty", never "the fetch had not
  // happened yet".
  const bodyState = useWorkspacePostBody(pool.blogId, poolPost.id);
  const poolBody = poolPost.document?.content.body;
  const cachedBody = getCachedWorkspacePostBody(pool.blogId, poolPost.id)?.body;
  // Hydration-safe: the server and the first client render may consult only
  // what the RSC payload carries (poolBody). The body cache and fetch entry
  // are client module state; letting them into the first render made the
  // server and client disagree and hydration fail. After mount, the client
  // may know more.
  const bodySourcesMounted = useClientHydrated();
  const bodyKnown =
    poolBody != null ||
    (bodySourcesMounted &&
      (cachedBody != null ||
        bodyState.entry.status === "ready" ||
        bodyState.entry.status === "error"));
  useEffect(() => {
    if (poolBody == null && cachedBody == null) bodyState.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.blogId, poolPost.id]);
  const post = postFromPoolPost(
    poolPost,
    poolBody ??
      cachedBody ??
      (bodyState.entry.status === "ready" ? bodyState.entry.body.body : "") ??
      "",
  );
  const containingFolderPath = folderPathForPoolPost(pool, poolPost);
  const containingFolderHref = returnToSearch
    ? workspaceSearchHref(homePath, returnToSearch)
    : folderWorkspaceHref(homePath, containingFolderPath);
  const referenceChoices = useMemo(
    () => workspaceReferenceChoices(pool.posts, poolPost.id),
    [pool.posts, poolPost.id],
  );

  const updateLocalDocument = useCallback(
    (nextDocument: DocumentSnapshot) => {
      const projection = legacyProjectionFromDocument(nextDocument);
      updatePost(poolPost.id, {
        document: nextDocument,
        template: nextDocument.presentation.template,
        title: projection.title,
        excerpt: projection.excerpt || undefined,
        bodyPreview: projection.body.slice(0, 2048) || undefined,
        accent: projection.accent ?? undefined,
        cover: projection.cover ?? undefined,
        coverCaption: projection.coverCaption ?? undefined,
        coverHeight: projection.coverHeight ?? undefined,
        gallery: projection.gallery,
        links: projection.links ?? undefined,
        tags: projection.tags,
        videoUrl: projection.videoUrl ?? undefined,
        venue: projection.venue ?? undefined,
        duration: projection.duration ?? undefined,
      });
      updatePostBody(pool.blogId, poolPost.id, nextDocument.content.body);
    },
    [pool.blogId, poolPost.id],
  );

  const acknowledgeMaterialized = useCallback(
    (nextDocument: DocumentSnapshot) => {
      updateLocalDocument(nextDocument);
      acknowledgePost(poolPost.id);
      acknowledgePostBody(pool.blogId, poolPost.id, nextDocument.content.body);
    },
    [pool.blogId, poolPost.id, updateLocalDocument],
  );

  if (!bodyKnown) return null;

  return (
    <UnifiedDocumentEditor
      active={active}
      blog={blog}
      post={post}
      template={template}
      availableTemplates={pool.templates}
      referenceChoices={referenceChoices}
      onSaveAsLook={async (name) => {
        if (!post.id) return { ok: false, message: "Save the item first." };
        const result = await saveItemAsLookAction(blog.handle, post.id, name);
        return result.ok
          ? { ok: true, message: `Saved as "${result.name}"` }
          : { ok: false, message: result.error };
      }}
      activeAgent={activeAgent}
      onOpenAgent={onOpenAssistant}
      collab={{
        postId: poolPost.id,
        userName: blog.author || "You",
        color: collaboratorColor(editorIdentity),
        canEdit: true,
      }}
      onDocumentChange={updateLocalDocument}
      onMaterialized={acknowledgeMaterialized}
      onDelete={
        onDeleteItem ? () => Promise.resolve(onDeleteItem(post)) : undefined
      }
      onDone={() =>
        onNavigate(
          template.id === "texttext.note"
            ? containingFolderHref
            : blogWorkspacePostPath(blog, containingFolderPath, post),
        )
      }
    />
  );
}

function LocalWorkspaceContent({
  blog,
  canCommentPost,
  canCreateItems,
  canEditItems,
  canManageSharing,
  canManagePost,
  captureFocusRequestKey,
  createBookmarkRequestKey,
  editFolderRequestKey,
  handle,
  homePath,
  itemIdentity,
  onNavigate,
  onCaptureResolved,
  onCreateItem,
  onDeleteItem,
  onDeleteFolder,
  onOpenSection,
  onOpenPostId,
  onOpenPost,
  onOpenRoot,
  onOpenTag,
  onItemClick,
  onQueryChange,
  onSearch,
  onSelectPost,
  onSelectSection,
  pool,
  searchFocusRequestKey,
  searchQuery,
  selectedSectionPath,
  selectedPostId,
  selectedPostIds,
  view,
  assistantConnection,
  assistantCloudProvider,
  onConnectAssistant,
  onOpenAssistant,
  onBuildItemType,
  onFocusCapture,
}: {
  blog: Blog;
  canCommentPost: boolean;
  canCreateItems: boolean;
  canEditItems: boolean;
  canManageSharing: boolean;
  canManagePost: boolean;
  captureFocusRequestKey: number;
  createBookmarkRequestKey: number;
  editFolderRequestKey: number;
  handle: string;
  homePath: string;
  itemIdentity: WorkspaceItemIdentityRegistry;
  onNavigate: (path: string) => Promise<void> | void;
  onCaptureResolved?: FolderCaptureResolved;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onDeleteFolder?: (folder: Folder) => Promise<void> | void;
  onOpenSection: (folderPath: string) => void;
  onOpenPostId: (postId: string, mode?: "read" | "edit") => void;
  onOpenPost: (post: Post) => void;
  onOpenRoot: () => void;
  onOpenTag: (tag: string) => void;
  onItemClick: (postId: string, event: ReactMouseEvent<HTMLElement>) => boolean;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onSelectPost: (postId: string) => void;
  onSelectSection: (folderPath: string) => void;
  pool: WorkspacePoolPayload;
  searchFocusRequestKey: number;
  searchQuery: string;
  selectedSectionPath: string | null;
  selectedPostId: string | null;
  selectedPostIds: ReadonlySet<string>;
  view: LocalWorkspaceView;
  assistantConnection: AiConnectionSnapshot | null;
  assistantCloudProvider?: string | null;
  onConnectAssistant?: () => void;
  onOpenAssistant: () => void;
  onBuildItemType: (folderPath?: string) => void;
  onFocusCapture: () => void;
}) {
  let page: ReactNode;
  let activePost: WorkspacePoolPost | null = null;
  const rootPage = (
    <WorkspaceRootLanding
      canManageItems={canManagePost}
      captureFocusRequestKey={captureFocusRequestKey}
      focusRequestKey={searchFocusRequestKey}
      onCreateItem={onCreateItem}
      onEditCreatedPost={(postId) => onOpenPostId(postId, "edit")}
      onOpenPost={onOpenPostId}
      onOpenSection={onOpenSection}
      onOpenTag={onOpenTag}
      onDeletePost={onDeleteItem}
      onItemClick={onItemClick}
      onQueryChange={onQueryChange}
      onSelectPost={onSelectPost}
      onSelectSection={onSelectSection}
      pool={pool}
      query={searchQuery}
      source={view.level === "search" ? view.source : "query"}
      selectedPostId={selectedPostId}
      selectedPostIds={selectedPostIds}
      selectedSectionPath={selectedSectionPath}
      assistantConnection={assistantConnection}
      assistantCloudProvider={assistantCloudProvider}
      onConnectAssistant={onConnectAssistant}
      onOpenAssistant={onOpenAssistant}
      onBuildItemType={() => onBuildItemType()}
      onFocusCapture={onFocusCapture}
      settingsHref={workspaceSettingsHref(homePath)}
    />
  );

  if (view.level === "root" || view.level === "search") {
    page = rootPage;
  } else if (view.level === "settings") {
    page = (
      <>
        <WorkspaceSearchActionBar onSearch={onSearch} />
        <WorkspaceSettings
          blog={blog}
          canManageSharing={canManageSharing}
          onBack={onOpenRoot}
        />
      </>
    );
  } else if (view.level === "trash") {
    page = (
      <>
        <WorkspaceSearchActionBar onSearch={onSearch} />
        <TrashPage
          handle={handle}
          pool={pool}
          selectedPostId={selectedPostId}
          onSelectPost={onSelectPost}
        />
      </>
    );
  } else if (view.level === "shared") {
    page = (
      <>
        <WorkspaceSearchActionBar onSearch={onSearch} />
        <SharedPage pool={pool} />
      </>
    );
  } else if (view.level === "starred") {
    page = (
      <>
        <WorkspaceSearchActionBar onSearch={onSearch} />
        <StarredPage
          pool={pool}
          selectedPostId={selectedPostId}
          selectedPostIds={selectedPostIds}
          onDeletePost={onDeleteItem}
          onItemClick={onItemClick}
          onOpenPost={onOpenPostId}
          onOpenTag={onOpenTag}
          onSelectPost={onSelectPost}
          owner={canManagePost}
        />
      </>
    );
  } else if (view.level === "section") {
    const folder = pool.folders.find((entry) => entry.path === view.folderPath);
    if (!folder) {
      page = rootPage;
    } else {
      const items = poolPostsForFolder(pool, folder.path).map((post) =>
        postFromPoolPost(post),
      );
      activePost = selectedPostId
        ? itemIdentity.resolvePost(pool, selectedPostId)
        : null;
      page = (
        <FolderPage
          blog={blog}
          folder={folder}
          handle={handle}
          items={items}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
          onCaptureResolved={onCaptureResolved}
          onCreateItem={onCreateItem}
          onDeleteItem={onDeleteItem}
          onDeleteFolder={onDeleteFolder}
          onOpenPost={onOpenPost}
          onOpenTag={onOpenTag}
          onItemClick={onItemClick}
          createBookmarkRequestKey={createBookmarkRequestKey}
          editRequestKey={editFolderRequestKey}
          searchFocusRequestKey={searchFocusRequestKey}
          onSelectPost={onSelectPost}
          selectedPostId={selectedPostId}
          selectedPostIds={selectedPostIds}
          availableTemplates={pool.templates}
        />
      );
    }
  } else {
    const post = itemIdentity.resolvePost(pool, view.postId);
    activePost = post;
    page =
      post && post.type !== "note" ? (
        <WorkspacePostReader
          blog={blog}
          canCommentPost={canCommentPost}
          canManagePost={canManagePost}
          homePath={homePath}
          onCaptureResolved={onCaptureResolved}
          onNavigate={onNavigate}
          onOpenTag={onOpenTag}
          onSearch={onSearch}
          searchFocusRequestKey={searchFocusRequestKey}
          pool={pool}
          poolPost={post}
          returnToSearch={view.returnToSearch}
        />
      ) : (
        rootPage
      );
  }

  const editorVisible =
    Boolean(activePost) &&
    (view.level === "edit" || activePost?.type === "note");
  const shouldWarmEditor = Boolean(activePost) && canEditItems;

  return (
    <>
      <div className="local-workspace-surface" hidden={editorVisible}>
        {page}
      </div>
      {shouldWarmEditor && activePost && (
        <div className="local-workspace-surface" hidden={!editorVisible}>
          <LocalUnifiedWorkspacePostEditor
            key={itemIdentity.stableKey(activePost.id)}
            active={editorVisible}
            blog={blog}
            editorIdentity={itemIdentity.stableKey(activePost.id)}
            homePath={homePath}
            onDeleteItem={onDeleteItem}
            onNavigate={onNavigate}
            pool={pool}
            poolPost={activePost}
            returnToSearch={
              view.level === "post" || view.level === "edit"
                ? view.returnToSearch
                : undefined
            }
            assistantConnection={assistantConnection}
            assistantCloudProvider={assistantCloudProvider}
            onOpenAssistant={onOpenAssistant}
          />
        </div>
      )}
    </>
  );
}

function LocalWorkspaceShell({
  blog,
  canCommentPost,
  canManageFolders,
  canManageSharing,
  className,
  homePath,
  initialPool,
  initialSidebarCollapsed,
  initialSearchQuery,
  initialView,
}: {
  blog: Blog;
  canCommentPost: boolean;
  canManageFolders: boolean;
  canManageSharing: boolean;
  children: ReactNode;
  className: string;
  homePath: string;
  initialPool: WorkspacePoolPayload;
  initialSidebarCollapsed: boolean;
  initialSearchQuery?: string;
  initialView: LocalWorkspaceView;
}) {
  const router = useRouter();
  const { pool } = useWorkspacePool(initialPool);
  const itemIdentity = useLocalWorkspaceItemIdentity();
  const [view, setView] = useState<LocalWorkspaceView>(initialView);
  const poolHydrated = useClientHydrated();
  const sourcePool =
    poolHydrated && pool?.blogId === initialPool.blogId ? pool : initialPool;
  const displayPool = useMemo(
    () =>
      localWorkspaceDraftSessions.size === 0
        ? sourcePool
        : {
            ...sourcePool,
            posts: sourcePool.posts.map((post) => {
              const localDraft = localWorkspaceDraftSessions.get(post.id);
              return localDraft
                ? mergeDraftIntoWorkspacePost(post, localDraft)
                : post;
            }),
          },
    [sourcePool],
  );
  const itemTypeStudioPreviewDocuments = useMemo(
    () =>
      displayPool.posts.flatMap((post) =>
        post.document
          ? [
              {
                folderPath: folderPathForPoolPost(displayPool, post),
                document: post.document,
              },
            ]
          : [],
      ),
    [displayPool],
  );
  const displayPoolRef = useRef(displayPool);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef<{
    left: number;
    top: number;
  } | null>(null);
  const cancelledOptimisticPostIdsRef = useRef(new Set<string>());
  const gTapRef = useRef(0);
  const initialUrlSyncedRef = useRef(false);
  const mounted = typeof window !== "undefined";
  const viewRef = useRef(view);
  const initialSelectedPostId = selectedPostIdForView(initialPool, initialView);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    initialSelectedPostId,
  );
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(
    () => new Set(initialSelectedPostId ? [initialSelectedPostId] : []),
  );
  const [activeRegion, setActiveRegion] =
    useState<WorkspaceActiveRegion>("body");
  const activeRegionRef = useRef<WorkspaceActiveRegion>("body");
  const bodySelectionActiveRef = useRef(Boolean(initialSelectedPostId));
  const sidebarSelectionActiveRef = useRef(false);
  const lastActivePostIdRef = useRef<string | null>(initialSelectedPostId);
  const lastSidebarPathRef = useRef<string>(
    "folderPath" in initialView ? initialView.folderPath : "",
  );
  const selectionAnchorPostIdRef = useRef<string | null>(initialSelectedPostId);
  const [marqueeRectangle, setMarqueeRectangle] =
    useState<SelectionRectangle | null>(null);
  const [leftEdgePeeking, setLeftEdgePeeking] = useState(false);
  const [selectedSectionPath, setSelectedSectionPath] = useState<string | null>(
    null,
  );
  const selectedSectionPathRef = useRef(selectedSectionPath);
  const [searchQuery, setSearchQuery] = useState(() =>
    initialView.level === "search"
      ? initialView.query
      : initialView.level === "root"
        ? (initialSearchQuery ?? "")
        : "",
  );
  const lastRootFolderPathRef = useRef<string | null>(
    "folderPath" in initialView
      ? rootFolderPathForSelection(initialPool.folders, initialView.folderPath)
      : null,
  );
  const [searchFocusRequestKey, setSearchFocusRequestKey] = useState(0);
  const [captureFocusRequestKey, setCaptureFocusRequestKey] = useState(0);
  const [createBookmarkRequestKey, setCreateBookmarkRequestKey] = useState(0);
  const [editFolderRequestKey, setEditFolderRequestKey] = useState(0);
  const [pendingDeletePostIds, setPendingDeletePostIds] = useState<string[]>(
    [],
  );
  const [itemTypeStudioFolderPath, setItemTypeStudioFolderPath] = useState<
    string | null
  >(null);
  const { state: assistantState, width: assistantWidth } =
    useWorkspaceAssistantPreferences();
  useSyncExternalStore(
    subscribeOpenWorkspaceItemDrafts,
    openWorkspaceItemDraftRevision,
    () => 0,
  );
  const [assistantConfirmation, setAssistantConfirmation] =
    useState<AssistantConfirmationRequest | null>(null);

  const assistantConfirmationController = useMemo(
    () => createAssistantConfirmationController(setAssistantConfirmation),
    [],
  );
  const { sidebarCollapsed, setSidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  useEffect(() => {
    const clearPeeks = () => {
      setLeftEdgePeeking(false);
    };
    const trackEdges = (event: PointerEvent) => {
      const selection = window.getSelection();
      if (
        window.matchMedia(WORKSPACE_COMPACT_MEDIA_QUERY).matches ||
        event.buttons !== 0 ||
        marqueeRectangle ||
        Boolean(selection && !selection.isCollapsed)
      ) {
        clearPeeks();
        return;
      }
      const sidebarWidth =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--workspace-sidebar-width",
          ),
        ) || WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
      setLeftEdgePeeking(
        (current) =>
          sidebarCollapsed &&
          (event.clientX <= 24 || (current && event.clientX <= sidebarWidth)),
      );
    };
    window.addEventListener("pointermove", trackEdges, { passive: true });
    window.addEventListener("blur", clearPeeks);
    return () => {
      window.removeEventListener("pointermove", trackEdges);
      window.removeEventListener("blur", clearPeeks);
    };
  }, [assistantState, assistantWidth, marqueeRectangle, sidebarCollapsed]);

  const changeAssistantState = useCallback(
    (next: AssistantSidebarState) => setWorkspaceAssistantState(next),
    [],
  );
  const changeAssistantWidth = useCallback(
    (next: number) => setWorkspaceAssistantWidth(next),
    [],
  );
  const activateRegion = useCallback((region: WorkspaceActiveRegion) => {
    activeRegionRef.current = region;
    setActiveRegion(region);
  }, []);
  useEffect(() => {
    displayPoolRef.current = displayPool;
  }, [displayPool]);

  const applyPostSelection = useCallback(
    ({
      activeId,
      anchorId,
      selectedIds,
    }: {
      activeId: string | null;
      anchorId: string | null;
      selectedIds: Set<string>;
    }) => {
      selectionAnchorPostIdRef.current = anchorId;
      setSelectedPostId(activeId);
      setSelectedPostIds(selectedIds);
      if (activeId) {
        lastActivePostIdRef.current = activeId;
        bodySelectionActiveRef.current = true;
        setSelectedSectionPath(null);
      }
    },
    [],
  );

  const selectOnlyPost = useCallback((postId: string | null) => {
    selectionAnchorPostIdRef.current = postId;
    setSelectedPostId(postId);
    setSelectedPostIds(new Set(postId ? [postId] : []));
    if (postId) {
      lastActivePostIdRef.current = postId;
      bodySelectionActiveRef.current = true;
      setSelectedSectionPath(null);
    }
  }, []);

  const clearPostSelection = useCallback(() => {
    selectionAnchorPostIdRef.current = null;
    setSelectedPostId(null);
    setSelectedPostIds(new Set());
  }, []);

  const activatePostSelection = useCallback(
    (postId: string) => {
      if (selectedPostIds.has(postId)) {
        setSelectedSectionPath(null);
        setSelectedPostId(postId);
        return;
      }
      if (selectedPostIds.size > 1) return;
      selectOnlyPost(postId);
    },
    [selectOnlyPost, selectedPostIds],
  );

  useEffect(
    () => () => assistantConfirmationController.dispose(),
    [assistantConfirmationController],
  );

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (initialUrlSyncedRef.current) return;
    initialUrlSyncedRef.current = true;
    const urlView = currentLocalView(displayPool, homePath);
    const current = viewRef.current;
    if (
      (current.level === "post" || current.level === "edit") &&
      (urlView.level === "post" || urlView.level === "edit") &&
      current.postId === urlView.postId &&
      urlView.returnToSearch &&
      !current.returnToSearch
    ) {
      viewRef.current = { ...current, returnToSearch: urlView.returnToSearch };
      setView(viewRef.current);
    }
  }, [displayPool, homePath]);

  useLayoutEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    if (!pending) return;
    pendingScrollRestoreRef.current = null;
    window.scrollTo({
      left: pending.left,
      top: pending.top,
      behavior: "auto",
    });
  }, [view]);

  const openedPostId =
    view.level === "post" || view.level === "edit" ? view.postId : null;
  useEffect(() => {
    if (!openedPostId) return;
    recordWorkspaceDocumentOpened(displayPool.blog.handle, openedPostId);
  }, [displayPool.blog.handle, openedPostId]);

  useEffect(() => {
    selectedSectionPathRef.current = selectedSectionPath;
  }, [selectedSectionPath]);

  const navigateToView = useCallback(
    (
      nextView: LocalWorkspaceView,
      href: string,
      options: {
        selectedPostId?: string | null;
        selectedSectionPath?: string | null;
      } = {},
    ) => {
      const previousView = viewRef.current;
      disarmWorkspaceHover();
      if (
        (previousView.level === "post" || previousView.level === "edit") &&
        (nextView.level === "post" || nextView.level === "edit") &&
        itemIdentity.stableKey(previousView.postId) ===
          itemIdentity.stableKey(nextView.postId)
      ) {
        pendingScrollRestoreRef.current = {
          left: window.scrollX,
          top: window.scrollY,
        };
      }
      if (
        previousView.level === "edit" &&
        (nextView.level !== "edit" || nextView.postId !== previousView.postId)
      ) {
        window.dispatchEvent(new Event(STOP_LOCAL_EDITING_EVENT));
      }
      window.history.pushState(null, "", href);
      viewRef.current = nextView;
      setView(nextView);
      const nextSelectedPostId =
        "selectedPostId" in options
          ? (options.selectedPostId ?? null)
          : selectedPostIdForView(displayPoolRef.current, nextView);
      setSelectedPostId(nextSelectedPostId);
      selectionAnchorPostIdRef.current = nextSelectedPostId;
      setSelectedPostIds(
        new Set(nextSelectedPostId ? [nextSelectedPostId] : []),
      );
      if ("selectedSectionPath" in options) {
        setSelectedSectionPath(
          validRootSectionPath(
            displayPoolRef.current,
            options.selectedSectionPath ?? null,
          ),
        );
      } else if (nextView.level === "root" || nextView.level === "search") {
        setSelectedSectionPath(null);
      }
      const previousDepth = localWorkspaceViewDepth(previousView);
      const nextDepth = localWorkspaceViewDepth(nextView);
      if (
        previousDepth !== nextDepth &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        window.requestAnimationFrame(() => {
          contentRef.current?.animate(
            [
              {
                opacity: 0.78,
                transform: `translateX(${nextDepth > previousDepth ? 22 : -22}px)`,
              },
              { opacity: 1, transform: "translateX(0)" },
            ],
            { duration: 170, easing: "cubic-bezier(.2,.75,.25,1)" },
          );
        });
      }
    },
    [itemIdentity],
  );

  const replaceWithView = useCallback(
    (
      nextView: LocalWorkspaceView,
      href: string,
      options: {
        selectedPostId?: string | null;
        selectedSectionPath?: string | null;
      } = {},
    ) => {
      const previousView = viewRef.current;
      disarmWorkspaceHover();
      if (
        (previousView.level === "post" || previousView.level === "edit") &&
        (nextView.level === "post" || nextView.level === "edit") &&
        itemIdentity.stableKey(previousView.postId) ===
          itemIdentity.stableKey(nextView.postId)
      ) {
        pendingScrollRestoreRef.current = {
          left: window.scrollX,
          top: window.scrollY,
        };
      }
      window.history.replaceState(null, "", href);
      viewRef.current = nextView;
      setView(nextView);
      const nextSelectedPostId =
        "selectedPostId" in options
          ? (options.selectedPostId ?? null)
          : selectedPostIdForView(displayPoolRef.current, nextView);
      setSelectedPostId(nextSelectedPostId);
      selectionAnchorPostIdRef.current = nextSelectedPostId;
      setSelectedPostIds(
        new Set(nextSelectedPostId ? [nextSelectedPostId] : []),
      );
      if ("selectedSectionPath" in options) {
        setSelectedSectionPath(
          validRootSectionPath(
            displayPoolRef.current,
            options.selectedSectionPath ?? null,
          ),
        );
      } else if (nextView.level === "root" || nextView.level === "search") {
        setSelectedSectionPath(null);
      }
    },
    [itemIdentity],
  );

  const navigateRoot = useCallback(() => {
    setSearchQuery("");
    navigateToView({ level: "root" }, workspaceRootHref(homePath), {
      selectedPostId: null,
      selectedSectionPath: null,
    });
  }, [homePath, navigateToView]);

  const navigateSettings = useCallback(() => {
    setSearchQuery("");
    navigateToView({ level: "settings" }, workspaceSettingsHref(homePath), {
      selectedPostId: null,
      selectedSectionPath: null,
    });
  }, [homePath, navigateToView]);

  const navigateSearch = useCallback(
    (location: WorkspaceSearchLocation) => {
      setSearchQuery(location.query);
      navigateToView(
        { level: "search", ...location },
        workspaceSearchHref(homePath, location),
        { selectedPostId: null, selectedSectionPath: null },
      );
    },
    [homePath, navigateToView],
  );

  const navigateDateSearch = useCallback(
    (dateKey: string) => {
      navigateSearch({ query: dateKey, source: "date" });
    },
    [navigateSearch],
  );

  const navigateTag = useCallback(
    (tag: string) => {
      navigateSearch({ query: tag, source: "tag" });
    },
    [navigateSearch],
  );

  const focusSearch = useCallback(() => {
    setSearchFocusRequestKey((current) => current + 1);
  }, []);

  const changeSearchQuery = useCallback(
    (nextQuery: string) => {
      const query = nextQuery.trim();
      const current = viewRef.current;
      const source =
        current.level === "search" &&
        (current.source === "date" || current.source === "tag") &&
        current.query === query
          ? current.source
          : "query";
      setSearchQuery(query ? nextQuery : "");
      replaceWithView(
        query
          ? { level: "search", query: nextQuery, source }
          : { level: "root" },
        query
          ? workspaceSearchHref(homePath, { query: nextQuery, source })
          : workspaceRootHref(homePath),
        { selectedPostId: null, selectedSectionPath: null },
      );
    },
    [homePath, replaceWithView],
  );

  const navigateSection = useCallback(
    (folderPath: SidebarFolderId, nextSelectedPostId?: string | null) => {
      const remembered = rootFolderPathForSelection(
        displayPoolRef.current.folders,
        folderPath,
      );
      if (remembered) lastRootFolderPathRef.current = remembered;
      setSearchQuery("");
      const nextView: LocalWorkspaceView =
        folderPath === TRASH_FOLDER_PATH
          ? { level: "trash", folderPath: TRASH_FOLDER_PATH }
          : folderPath === SHARED_FOLDER_PATH
            ? { level: "shared", folderPath: SHARED_FOLDER_PATH }
            : folderPath === STARRED_FOLDER_PATH
              ? { level: "starred", folderPath: STARRED_FOLDER_PATH }
              : { level: "section", folderPath };
      navigateToView(
        nextView,
        folderWorkspaceHref(homePath, folderPath),
        nextSelectedPostId === undefined
          ? {}
          : { selectedPostId: nextSelectedPostId },
      );
    },
    [homePath, navigateToView],
  );

  const openPoolPost = useCallback(
    (
      post: WorkspacePoolPost,
      folderPath?: string,
      mode: "read" | "edit" = "read",
    ) => {
      // Keep edit transitions inside the workspace shell so existing notes and
      // posts feel instant; the URL still mirrors the canonical edit route.
      const currentPool = displayPoolRef.current;
      const warmedBody =
        getCachedWorkspacePostBody(currentPool.blogId, post.id)?.body ??
        currentPool.initialBodies?.find((body) => body.postId === post.id)
          ?.body;
      const nextMode =
        mode === "read" && shouldOpenWorkspacePostInEdit(post, warmedBody)
          ? "edit"
          : mode;
      const nextFolderPath =
        folderPath ?? folderPathForPoolPost(currentPool, post);
      const currentView = viewRef.current;
      const returnToSearch =
        currentView.level === "search"
          ? {
              query: currentView.query,
              source: currentView.source,
            }
          : currentView.level === "post" || currentView.level === "edit"
            ? currentView.returnToSearch
            : undefined;
      const openedFrom =
        currentView.level === "root"
          ? "root"
          : currentView.level === "search"
            ? "search"
            : currentView.level === "section"
              ? "folder"
              : currentView.level === "post" || currentView.level === "edit"
                ? currentView.openedFrom
                : undefined;
      const optimisticEdit = nextMode === "edit" && isOptimisticPostId(post.id);
      if (nextMode === "edit") beginEditTransition(post.id);
      navigateToView(
        {
          level: nextMode === "edit" ? "edit" : "post",
          postId: post.id,
          folderPath: nextFolderPath,
          openedFrom,
          returnToSearch,
        },
        workspaceHrefWithSearchReturn(
          optimisticEdit
            ? folderWorkspaceHref(homePath, nextFolderPath)
            : nextMode === "edit"
              ? blogWorkspacePostEditPath(
                  currentPool.blog,
                  nextFolderPath,
                  post,
                )
              : blogWorkspacePostPath(currentPool.blog, nextFolderPath, post),
          returnToSearch,
        ),
      );
    },
    [homePath, navigateToView],
  );

  const openCreatedPost = useCallback(
    (post: WorkspacePoolPost) => {
      openPoolPost(
        post,
        folderPathForPoolPost(displayPoolRef.current, post),
        "edit",
      );
    },
    [openPoolPost],
  );

  const openAssistantItem = useCallback(
    (post: WorkspacePoolPost, mode: "read" | "edit") => {
      openPoolPost(
        post,
        folderPathForPoolPost(displayPoolRef.current, post),
        mode,
      );
    },
    [openPoolPost],
  );

  const handleAgentFocus = useCallback(
    (focus: AgentFocusEvent) => {
      if (focus.workspaceHandle !== displayPoolRef.current.blog.handle) {
        router.push(focus.path);
        return;
      }
      const post = findPoolPostById(displayPoolRef.current, focus.postId);
      if (post) {
        openPoolPost(post, focus.folderPath, focus.mode);
        return;
      }
      router.push(focus.path);
    },
    [openPoolPost, router],
  );

  // Keep the list live with the server and respond when an authorized external
  // agent asks this signed-in client to join an exact document.
  useWorkspaceLiveSync(blog.handle, initialPool.blogId, handleAgentFocus);

  const reconcileCreatedPost = useCallback(
    (temporaryPostId: string, savedPost: WorkspacePoolPost) => {
      const current = viewRef.current;
      if (
        (current.level !== "edit" && current.level !== "post") ||
        current.postId !== temporaryPostId
      ) {
        return;
      }
      const nextFolderPath = folderPathForPoolPost(
        displayPoolRef.current,
        savedPost,
      );
      const nextView: LocalWorkspaceView = {
        level: current.level,
        postId: savedPost.id,
        folderPath: nextFolderPath,
        openedFrom: current.openedFrom,
        returnToSearch: current.returnToSearch,
      };
      replaceWithView(
        nextView,
        current.level === "edit"
          ? blogWorkspacePostEditPath(
              displayPoolRef.current.blog,
              nextFolderPath,
              savedPost,
            )
          : blogWorkspacePostPath(
              displayPoolRef.current.blog,
              nextFolderPath,
              savedPost,
            ),
        { selectedPostId: savedPost.id },
      );
    },
    [replaceWithView],
  );

  const createWorkspaceItem = useCallback<FolderCreateItem>(
    (request, options) => {
      if (!canManageFolders) return;
      const pool = displayPoolRef.current;
      const temp = createOptimisticWorkspacePost(pool, request);
      addPost(temp);

      if (options?.open !== false) {
        if (request.type === "bookmark" && !request.blank) {
          if (
            viewRef.current.level !== "section" ||
            viewRef.current.folderPath !== request.folderPath
          ) {
            navigateSection(request.folderPath, temp.id);
          } else {
            selectOnlyPost(temp.id);
          }
        } else {
          openPoolPost(temp, request.folderPath, "edit");
        }
      }

      void (async () => {
        let attempt = 0;
        while (getWorkspacePost(temp.id)) {
          try {
            if (options?.capture) {
              const result = await executeWorkspaceToolRequest(
                pool.blog.handle,
                "create_item",
                {
                  capture: options.capture,
                  idempotency_key:
                    options.idempotencyKey ?? crypto.randomUUID(),
                },
              );
              const item =
                result.item && typeof result.item === "object"
                  ? (result.item as Record<string, unknown>)
                  : null;
              const savedId = typeof item?.id === "string" ? item.id : "";
              if (!savedId) {
                throw new Error("Capture did not return a saved item");
              }
              const receipt =
                result.receipt && typeof result.receipt === "object"
                  ? (result.receipt as Record<string, unknown>)
                  : null;
              const receiptItemId =
                typeof receipt?.item_id === "string" ? receipt.item_id : "";
              const receiptSavedTo =
                typeof receipt?.saved_to === "string" ? receipt.saved_to : "";
              const receiptTitle =
                typeof receipt?.title === "string" ? receipt.title : "";
              if (
                receiptItemId !== savedId ||
                !receiptSavedTo ||
                !receiptTitle
              ) {
                throw new Error("Capture did not return an exact receipt");
              }

              await refreshWorkspacePool(pool.blog.handle, pool.blogId);
              let savedPoolPost = getWorkspacePost(savedId);
              if (!savedPoolPost) {
                // A refresh that was already in flight may have started before
                // create_item committed. Its promise is still worth awaiting,
                // then one fresh read resolves the durable item without
                // misreporting a successful capture as failed.
                await refreshWorkspacePool(pool.blog.handle, pool.blogId);
                savedPoolPost = getWorkspacePost(savedId);
              }
              if (!savedPoolPost) {
                throw new Error("Saved capture is not in this workspace yet");
              }
              if (cancelledOptimisticPostIdsRef.current.has(temp.id)) {
                cancelledOptimisticPostIdsRef.current.delete(temp.id);
                removePost(temp.id);
                void deleteEditablePostAction(
                  pool.blog.handle,
                  savedPoolPost.id,
                ).catch((error) =>
                  console.warn("cancelled capture cleanup failed", error),
                );
                return;
              }
              if (savedPoolPost.updatedAt) {
                localWorkspaceServerRevisions.set(
                  savedPoolPost.id,
                  savedPoolPost.updatedAt,
                );
              }
              itemIdentity.reconcile(temp.id, savedPoolPost.id);
              removePost(temp.id);
              options.onPersisted?.(postFromPoolPost(savedPoolPost), {
                itemId: receiptItemId,
                savedTo: receiptSavedTo,
                title: receiptTitle,
              });
              return;
            }

            const saved =
              request.type === "bookmark"
                ? request.blank
                  ? await createWorkspacePostAction(
                      pool.blog.handle,
                      "bookmark",
                      request.folderPath,
                      request.title,
                      request.template,
                      request.body,
                    )
                  : await createFolderItemAction(
                      pool.blog.handle,
                      "bookmarks",
                      {
                        url: request.url,
                        description: request.description,
                        folderPath: request.folderPath,
                        template: request.template,
                        title: request.title,
                      },
                    )
                : request.type === "note"
                  ? await createFolderItemAction(pool.blog.handle, "notes", {
                      folderPath: request.folderPath,
                      template: request.template,
                      title: request.title,
                      body: request.body,
                    })
                  : await createWorkspacePostAction(
                      pool.blog.handle,
                      "article",
                      request.folderPath,
                      request.title,
                      request.template,
                      request.body,
                    );
            const poolPost = narrowPostFromPost(saved, pool.blogId);
            if (!poolPost) {
              throw new Error("Created item did not include an id");
            }
            if (cancelledOptimisticPostIdsRef.current.has(temp.id)) {
              cancelledOptimisticPostIdsRef.current.delete(temp.id);
              void deleteEditablePostAction(
                pool.blog.handle,
                poolPost.id,
              ).catch((error) =>
                console.warn("cancelled item cleanup failed", error),
              );
              return;
            }
            if (poolPost.updatedAt) {
              localWorkspaceServerRevisions.set(
                poolPost.id,
                poolPost.updatedAt,
              );
            }
            const optimistic = getWorkspacePost(temp.id);
            const reconciled = mergeCreatedWorkspacePost(poolPost, optimistic);
            const liveDraft = localWorkspaceDraftSessions.get(temp.id);
            const merged = liveDraft
              ? mergeDraftIntoWorkspacePost(reconciled, liveDraft)
              : reconciled;

            // Register the ID handoff before the pool emits. Every intermediate
            // render can resolve the item and keeps the same React editor key.
            itemIdentity.reconcile(temp.id, merged.id);
            if (liveDraft) {
              const previousKey = payloadKey(
                payloadFor(temp.id, liveDraft, optimistic?.slug ?? temp.slug),
              );
              const transferredKey = payloadKey(
                payloadFor(merged.id, liveDraft, merged.slug),
              );
              localWorkspacePendingSaveIds.add(merged.id);
              localWorkspacePendingSaveIds.delete(temp.id);
              localWorkspaceDraftSessions.set(merged.id, liveDraft);
              localWorkspaceDraftSessions.delete(temp.id);
              transferLocalDraftRevision(temp.id, merged.id);
              persistLocalWorkspaceDraft(
                pool.blogId,
                merged.id,
                liveDraft,
                transferredKey,
                poolPost.updatedAt,
              );
              void deletePersistedWorkspaceDraft(
                pool.blogId,
                temp.id,
                previousKey,
              );
              updatePostBody(pool.blogId, merged.id, liveDraft.body);
            }
            localWorkspaceServerRevisions.delete(temp.id);
            replacePost(temp.id, merged);
            if (request.type === "bookmark" && !request.blank) {
              setSelectedPostId((current) =>
                current === temp.id ? merged.id : current,
              );
              setSelectedPostIds((current) => {
                if (!current.has(temp.id)) return current;
                const next = new Set(current);
                next.delete(temp.id);
                next.add(merged.id);
                return next;
              });
              if (selectionAnchorPostIdRef.current === temp.id) {
                selectionAnchorPostIdRef.current = merged.id;
              }
            } else {
              reconcileCreatedPost(temp.id, merged);
            }
            options?.onPersisted?.(postFromPoolPost(merged));
            return;
          } catch (error) {
            if (
              cancelledOptimisticPostIdsRef.current.has(temp.id) ||
              !getWorkspacePost(temp.id)
            ) {
              return;
            }
            attempt += 1;
            if (options?.open === false && attempt >= 3) {
              void deletePersistedWorkspaceDraft(pool.blogId, temp.id);
              localWorkspacePendingSaveIds.delete(temp.id);
              localWorkspaceDraftSessions.delete(temp.id);
              localWorkspaceDraftRevisions.delete(temp.id);
              localWorkspaceServerRevisions.delete(temp.id);
              removePost(temp.id);
              options.onFailed?.(error);
              return;
            }
            console.warn("workspace item create will retry", error);
            await new Promise<void>((resolve) => {
              window.setTimeout(
                resolve,
                Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5)),
              );
            });
          }
        }
      })();
      return postFromPoolPost(temp);
    },
    [
      canManageFolders,
      itemIdentity,
      navigateSection,
      openPoolPost,
      reconcileCreatedPost,
      selectOnlyPost,
    ],
  );

  const deleteWorkspaceItem = useCallback<FolderDeleteItem>(
    async (post) => {
      if (!canManageFolders || !post.id) {
        throw new Error("You cannot edit this blog");
      }
      const postId = post.id;
      const currentView = viewRef.current;
      const pool = displayPoolRef.current;
      const poolPost =
        itemIdentity.resolvePost(pool, postId) ??
        findPoolPostById(pool, postId);
      if (!poolPost) throw new Error("Post not found");
      const folderPath = folderPathForPoolPost(pool, poolPost);
      const nextPost =
        (currentView.level === "post" || currentView.level === "edit") &&
        currentView.postId === postId
          ? nextWorkspacePostAfterDelete(pool, postId, folderPath)
          : null;
      if (isOptimisticPostId(postId)) {
        await deletePersistedWorkspaceDraft(pool.blogId, postId);
        cancelledOptimisticPostIdsRef.current.add(postId);
        localWorkspacePendingSaveIds.delete(postId);
        localWorkspaceDraftSessions.delete(postId);
        localWorkspaceDraftRevisions.delete(postId);
        localWorkspaceServerRevisions.delete(postId);
        removePost(postId);
        setSelectedPostIds((current) => {
          const next = new Set(current);
          next.delete(postId);
          return next;
        });
        setSelectedPostId((current) => (current === postId ? null : current));
        if (
          (currentView.level === "post" || currentView.level === "edit") &&
          currentView.postId === postId
        ) {
          if (nextPost) {
            openPoolPost(
              nextPost,
              folderPath,
              currentView.level === "edit" ? "edit" : "read",
            );
          } else if (currentView.returnToSearch) {
            navigateSearch(currentView.returnToSearch);
          } else {
            navigateSection(folderPath);
          }
        }
        return;
      }
      const pendingDraft = localWorkspaceDraftSessions.get(postId);
      const pendingDraftRevision = localWorkspaceDraftRevisions.get(postId);
      const pendingServerRevision = localWorkspaceServerRevisions.get(postId);
      const hadPendingSave = localWorkspacePendingSaveIds.has(postId);
      localWorkspacePendingSaveIds.delete(postId);
      localWorkspaceDraftSessions.delete(postId);
      localWorkspaceDraftRevisions.delete(postId);
      localWorkspaceServerRevisions.delete(postId);
      movePostToTrash(postId);
      setSelectedPostIds((current) => {
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
      setSelectedPostId((current) => (current === postId ? null : current));
      if (
        (currentView.level === "post" || currentView.level === "edit") &&
        currentView.postId === postId
      ) {
        if (nextPost) {
          openPoolPost(
            nextPost,
            folderPath,
            currentView.level === "edit" ? "edit" : "read",
          );
        } else if (currentView.returnToSearch) {
          navigateSearch(currentView.returnToSearch);
        } else {
          navigateSection(folderPath);
        }
      }

      try {
        await deleteEditablePostAction(pool.blog.handle, postId);
      } catch (error) {
        if (pendingDraft) {
          localWorkspaceDraftSessions.set(postId, pendingDraft);
        }
        if (pendingDraftRevision !== undefined) {
          localWorkspaceDraftRevisions.set(postId, pendingDraftRevision);
        }
        if (pendingServerRevision !== undefined) {
          localWorkspaceServerRevisions.set(postId, pendingServerRevision);
        }
        if (hadPendingSave) localWorkspacePendingSaveIds.add(postId);
        restorePostFromTrash(poolPost.id);
        throw error;
      }
      await deletePersistedWorkspaceDraft(pool.blogId, postId).catch((error) =>
        console.warn("trashed item draft cleanup failed", error),
      );
    },
    [
      canManageFolders,
      itemIdentity,
      navigateSearch,
      navigateSection,
      openPoolPost,
    ],
  );

  const deleteWorkspaceFolder = useCallback(
    async (folder: Folder) => {
      if (!canManageFolders) throw new Error("You cannot edit this workspace");
      moveFolderToTrash(folder.id);
      navigateRoot();
      try {
        await trashFolderAction(displayPoolRef.current.blog.handle, folder.id);
      } catch (error) {
        restoreFolderFromTrash(folder.id);
        throw error;
      }
    },
    [canManageFolders, navigateRoot],
  );

  const applyResolvedCapture = useCallback<FolderCaptureResolved>((post) => {
    if (!post.id) return;
    updatePost(post.id, {
      captureStatus: post.captureStatus,
      capture: post.capture,
      cover: post.cover,
      updatedAt: post.updatedAt,
      wordCount: post.wordCount,
    });
  }, []);

  const openPost = useCallback(
    (post: Post) => {
      if (!post.id) return;
      const poolPost = findPoolPostById(displayPool, post.id);
      if (!poolPost) return;
      openPoolPost(
        poolPost,
        view.level === "section" ? view.folderPath : undefined,
        "read",
      );
    },
    [displayPool, openPoolPost, view],
  );

  const visiblePosts = useMemo(() => {
    if (view.level === "root" || view.level === "search") {
      return displayPool.posts;
    }
    if (view.level === "trash") {
      return displayPool.trashedPosts ?? [];
    }
    if (view.level === "section") {
      return poolPostsForFolder(displayPool, view.folderPath);
    }
    if (view.level === "starred") {
      return starredPoolPosts(displayPool);
    }
    if (view.level === "post" || view.level === "edit") {
      return poolPostsForFolder(displayPool, view.folderPath);
    }
    return [];
  }, [displayPool, view]);

  const effectiveSelectedPostId =
    selectedPostId && visiblePosts.some((post) => post.id === selectedPostId)
      ? selectedPostId
      : null;
  const effectiveSelectedPostIds = useMemo(
    () =>
      new Set(
        visiblePosts
          .filter((post) => selectedPostIds.has(post.id))
          .map((post) => post.id),
      ),
    [selectedPostIds, visiblePosts],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const visibleIds = new Set(visiblePosts.map((post) => post.id));
      setSelectedPostIds((current) => {
        const next = new Set(
          Array.from(current).filter((postId) => visibleIds.has(postId)),
        );
        if (
          next.size === current.size &&
          Array.from(next).every((postId) => current.has(postId))
        ) {
          return current;
        }
        return next;
      });
      setSelectedPostId((current) =>
        current && visibleIds.has(current) ? current : null,
      );
      if (
        selectionAnchorPostIdRef.current &&
        !visibleIds.has(selectionAnchorPostIdRef.current)
      ) {
        selectionAnchorPostIdRef.current = null;
      }
    });
    return () => {
      active = false;
    };
  }, [visiblePosts]);
  const selectedPoolPosts = useMemo(
    () =>
      Array.from(effectiveSelectedPostIds)
        .map((id) => findPoolPostById(displayPool, id))
        .filter((post): post is WorkspacePoolPost => Boolean(post)),
    [displayPool, effectiveSelectedPostIds],
  );

  const moveSelectedPosts = useCallback(
    async (folderPath: string) => {
      if (!canManageFolders) return;
      const folder = displayPoolRef.current.folders.find(
        (candidate) => candidate.path === folderPath,
      );
      if (!folder) return;
      const posts = selectedPoolPosts.filter(
        (post) => homeFolderModeForPostType(post.type) === folder.mode,
      );
      await Promise.all(
        posts.map(async (post) => {
          const previousFolderId = post.folderId;
          movePost(post.id, folder.id);
          try {
            await movePostToFolderAction(
              displayPoolRef.current.blog.handle,
              post.id,
              folder.path,
            );
          } catch (error) {
            movePost(post.id, previousFolderId);
            throw error;
          }
        }),
      );
      clearPostSelection();
    },
    [canManageFolders, clearPostSelection, selectedPoolPosts],
  );

  const deleteWorkspaceItems = useCallback(
    async (posts: readonly WorkspacePoolPost[]) => {
      if (!canManageFolders || posts.length === 0) return;
      const currentPool = displayPoolRef.current;
      const persistentPosts = posts.filter(
        (post) => !isOptimisticPostId(post.id),
      );
      for (const post of posts) {
        if (isOptimisticPostId(post.id)) {
          void deletePersistedWorkspaceDraft(currentPool.blogId, post.id);
          cancelledOptimisticPostIdsRef.current.add(post.id);
          localWorkspacePendingSaveIds.delete(post.id);
          localWorkspaceDraftSessions.delete(post.id);
          localWorkspaceDraftRevisions.delete(post.id);
          localWorkspaceServerRevisions.delete(post.id);
          removePost(post.id);
          continue;
        }
        localWorkspacePendingSaveIds.delete(post.id);
        localWorkspaceDraftSessions.delete(post.id);
        localWorkspaceDraftRevisions.delete(post.id);
        localWorkspaceServerRevisions.delete(post.id);
        movePostToTrash(post.id);
      }
      clearPostSelection();

      if (persistentPosts.length === 0) return;
      try {
        await runTrashOperation(
          "trash-posts",
          currentPool.blog.handle,
          persistentPosts.map((post) => post.id),
        );
        await Promise.all(
          persistentPosts.map((post) =>
            deletePersistedWorkspaceDraft(currentPool.blogId, post.id),
          ),
        );
      } catch (error) {
        // Keep the local-first result in place. A refresh or live-sync retry can
        // reconcile a failed request without resurrecting cards in front of the
        // user immediately after they confirmed the action.
        throw error;
      }
    },
    [canManageFolders, clearPostSelection],
  );
  const deleteSelectedPosts = useCallback(
    () => deleteWorkspaceItems(selectedPoolPosts),
    [deleteWorkspaceItems, selectedPoolPosts],
  );
  const requestDeleteTarget = useCallback(
    (requestedPostIds: readonly string[] = []) => {
      const pool = displayPoolRef.current;
      const requestedIds = Array.from(new Set(requestedPostIds)).filter(
        (postId) => Boolean(findPoolPostById(pool, postId)),
      );
      if (requestedIds.length > 0) {
        setPendingDeletePostIds(requestedIds);
        return;
      }

      const current = viewRef.current;
      const postId =
        selectedPostId ??
        (current.level === "post" || current.level === "edit"
          ? current.postId
          : null);
      if (postId && findPoolPostById(pool, postId)) {
        setPendingDeletePostIds([postId]);
      }
    },
    [selectedPostId],
  );
  const confirmDeleteTarget = useCallback(() => {
    if (pendingDeletePostIds.length === 0) return;
    const posts = pendingDeletePostIds
      .map((postId) => findPoolPostById(displayPoolRef.current, postId))
      .filter((post): post is WorkspacePoolPost => Boolean(post));
    setPendingDeletePostIds([]);
    if (posts.length === 0) {
      return;
    }
    void deleteWorkspaceItems(posts).catch((error) =>
      console.warn("workspace item delete failed", error),
    );
  }, [deleteWorkspaceItems, pendingDeletePostIds]);
  const effectiveSelectedSectionPath = validRootSectionPath(
    displayPool,
    selectedSectionPath,
  );
  const effectiveSelectedPostIdentity = effectiveSelectedPostId
    ? itemIdentity.stableKey(effectiveSelectedPostId)
    : null;

  // The selected row is the assistant's context on folder/root pages; an open
  // item remains authoritative in reader/editor views. This is all local UI
  // state and does not navigate, reload, or refresh the workspace.
  const assistantTarget = useMemo(
    () =>
      resolveWorkspaceAssistantContext({
        homePath,
        pool: displayPool,
        selectedFolderPath: effectiveSelectedSectionPath,
        selectedPostId: effectiveSelectedPostId,
        view:
          view.level === "settings" || view.level === "search"
            ? { level: "root" }
            : view,
      }),
    [
      displayPool,
      effectiveSelectedPostId,
      effectiveSelectedSectionPath,
      homePath,
      view,
    ],
  );
  const assistantSelection =
    assistantTarget.view.level === "edit" && assistantTarget.view.postId
      ? readOpenWorkspaceItemSelection(assistantTarget.view.postId)
      : null;
  const assistantContext = assistantContextChipWithSelection(
    assistantTarget.chip,
    assistantSelection,
  );
  const getAssistantPool = useCallback(() => displayPoolRef.current, []);
  const getAssistantView = useCallback(
    () => assistantTarget.view,
    [assistantTarget],
  );
  const readAssistantItemText = useCallback(
    async (postId: string): Promise<WorkspaceItemTextSnapshot> => {
      const openDraft = readOpenWorkspaceItemDraft(postId);
      if (openDraft) return openDraft;

      const currentPool = displayPoolRef.current;
      const poolPost = findPoolPostById(currentPool, postId);
      if (!poolPost) throw new Error("This item is no longer available.");

      let body = getCachedWorkspacePostBody(currentPool.blogId, postId)?.body;
      if (body === undefined) {
        await ensurePostBody(currentPool.blogId, postId);
        body =
          getCachedWorkspacePostBody(currentPool.blogId, postId)?.body ??
          currentPool.initialBodies?.find(
            (candidate) => candidate.postId === postId,
          )?.body ??
          "";
      }
      return {
        title: poolPost.title,
        excerpt: markdownSubtitle(body) || poolPost.excerpt || "",
        body,
        tags: poolPost.tags,
      };
    },
    [],
  );
  const applyAssistantItemPatch = useCallback(
    async (
      postId: string,
      patch: WorkspaceItemTextPatch,
      expected: WorkspaceItemTextPatch = {},
      ifMatchHash?: string,
    ) => {
      const openDraftResult = patchOpenWorkspaceItemDraftIfCurrent(
        postId,
        patch,
        expected,
      );
      if (openDraftResult === "applied") {
        return { synced: false, queued: true };
      }
      if (openDraftResult === "stale") {
        throw new Error(
          "This item changed after the preview. Run the action again.",
        );
      }

      const currentPool = displayPoolRef.current;
      const poolPost = findPoolPostById(currentPool, postId);
      if (!poolPost) throw new Error("This item is no longer available.");
      const currentText = await readAssistantItemText(postId);
      for (const field of ["title", "excerpt", "body"] as const) {
        if (
          expected[field] !== undefined &&
          currentText[field] !== expected[field]
        ) {
          throw new Error(
            "This item changed after the preview. Run the action again.",
          );
        }
      }
      const existingDraft = localWorkspaceDraftSessions.get(postId);
      const draft =
        existingDraft ??
        initialDraft(postFromPoolPost(poolPost, currentText.body));
      const nextBody =
        patch.excerpt === undefined
          ? (patch.body ?? draft.body)
          : replaceMarkdownSubtitle(patch.body ?? draft.body, patch.excerpt);
      const nextDraft = {
        ...draft,
        ...patch,
        body: nextBody,
        excerpt: markdownSubtitle(nextBody),
      };
      if (patch.title?.trim() && isPlaceholderSlug(nextDraft.slug)) {
        const usedSlugs = currentPool.posts
          .filter((candidate) => candidate.id !== postId)
          .map((candidate) => candidate.slug);
        nextDraft.slug = uniqueSlug(slugify(patch.title, "post"), usedSlugs);
      }

      const baseUpdatedAt =
        localWorkspaceServerRevisions.get(postId) ?? poolPost.updatedAt;
      const requestedKey = payloadKey(
        payloadFor(postId, nextDraft, poolPost.slug, baseUpdatedAt),
      );
      localWorkspaceDraftSessions.set(postId, nextDraft);
      localWorkspacePendingSaveIds.add(postId);
      markPostDirty(postId);
      const requestedRevision = bumpLocalDraftRevision(postId);
      updatePost(postId, {
        ...mergeDraftIntoWorkspacePost(poolPost, nextDraft),
        updatedAt: new Date().toISOString(),
      });
      if (patch.body !== undefined || patch.excerpt !== undefined) {
        updatePostBody(currentPool.blogId, postId, nextDraft.body);
      }
      persistLocalWorkspaceDraft(
        currentPool.blogId,
        postId,
        nextDraft,
        requestedKey,
        baseUpdatedAt,
      );

      try {
        const result = await executeWorkspaceToolRequest(
          currentPool.blog.handle,
          "update_item",
          {
            id: postId,
            ...(patch.title !== undefined ? { title: nextDraft.title } : {}),
            ...(patch.excerpt !== undefined
              ? { excerpt: nextDraft.excerpt || null }
              : {}),
            ...(patch.body !== undefined ? { body: nextDraft.body } : {}),
            ...(patch.tags !== undefined ? { tags: nextDraft.tags } : {}),
            ...(ifMatchHash ? { if_match_hash: ifMatchHash } : {}),
          },
        );
        const savedItem = result.item as { updatedAt?: unknown } | undefined;
        const savedAt =
          typeof savedItem?.updatedAt === "string"
            ? savedItem.updatedAt
            : new Date().toISOString();
        localWorkspaceServerRevisions.set(postId, savedAt);
        if (localDraftRevision(postId) === requestedRevision) {
          localWorkspacePendingSaveIds.delete(postId);
          localWorkspaceDraftSessions.delete(postId);
          acknowledgePost(postId);
          acknowledgePostBody(
            currentPool.blogId,
            postId,
            nextDraft.body,
            savedAt,
          );
          void deletePersistedWorkspaceDraft(
            currentPool.blogId,
            postId,
            requestedKey,
          );
          void refreshWorkspacePool(
            currentPool.blog.handle,
            currentPool.blogId,
          );
        }
        return { synced: true, queued: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          /access|authoriz|cannot|conflict|forbidden|hash|invalid|no longer|owner|permission|required|sign in|stale/i.test(
            message,
          )
        ) {
          if (localDraftRevision(postId) === requestedRevision) {
            localWorkspacePendingSaveIds.delete(postId);
            if (existingDraft) {
              localWorkspaceDraftSessions.set(postId, existingDraft);
              markPostDirty(postId);
            } else {
              localWorkspaceDraftSessions.delete(postId);
            }
            updatePost(postId, {
              title: currentText.title,
              excerpt: currentText.excerpt || undefined,
              tags: currentText.tags ?? poolPost.tags,
              updatedAt: poolPost.updatedAt,
            });
            updatePostBody(currentPool.blogId, postId, currentText.body);
            if (!existingDraft) {
              acknowledgePost(postId);
              acknowledgePostBody(
                currentPool.blogId,
                postId,
                currentText.body,
                poolPost.updatedAt,
              );
            }
            void deletePersistedWorkspaceDraft(
              currentPool.blogId,
              postId,
              requestedKey,
            );
          }
          throw error;
        }
        // The local draft remains authoritative and persisted. Opening the
        // item resumes the editor's normal retry path instead of rolling the
        // user's accepted change back to stale server state.
        return { synced: false, queued: true };
      }
    },
    [readAssistantItemText],
  );
  const assistant = useNativeAssistant({
    handle: displayPool.blog.handle,
    contextKey: assistantTarget.contextKey,
    getPool: getAssistantPool,
    getView: getAssistantView,
    openItem: openAssistantItem,
    readItemText: readAssistantItemText,
    applyItemPatch: applyAssistantItemPatch,
    confirmDestructive: assistantConfirmationController.request,
  });
  const assistantComposer = useAssistantComposerDraft(
    `${displayPool.blog.handle}:${assistantTarget.contextKey}`,
  );
  const setAssistantComposerText = assistantComposer.setText;
  useEffect(() => {
    const onTryAi = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return;
      setAssistantComposerText(prompt);
      changeAssistantState("pinned");
    };
    window.addEventListener(TRY_AI_IN_TEXTTEXT_EVENT, onTryAi);
    return () => window.removeEventListener(TRY_AI_IN_TEXTTEXT_EVENT, onTryAi);
  }, [changeAssistantState, setAssistantComposerText]);
  const assistantContextItems = useMemo(
    () =>
      [...displayPool.posts]
        .sort((left, right) =>
          (right.updatedAt ?? right.createdAt ?? "").localeCompare(
            left.updatedAt ?? left.createdAt ?? "",
          ),
        )
        .map((post) => {
          const folderPath = folderPathForPoolPost(displayPool, post);
          const folderName =
            displayPool.folders.find((folder) => folder.path === folderPath)
              ?.name ?? folderPath;
          const kind = `${post.type.charAt(0).toUpperCase()}${post.type.slice(1)}`;
          return {
            id: post.id,
            name: post.title.trim() || "Untitled",
            detail: `${folderName} · ${kind}`,
          };
        }),
    [displayPool],
  );

  useEffect(() => {
    if (!mounted) return;
    const selectedPostForScroll = effectiveSelectedPostIdentity
      ? itemIdentity.currentId(effectiveSelectedPostIdentity)
      : null;
    const selector =
      view.level === "root" || view.level === "search"
        ? effectiveSelectedSectionPath
          ? `[data-workspace-section-path="${cssAttributeValue(
              effectiveSelectedSectionPath,
            )}"]`
          : selectedPostForScroll
            ? `[data-workspace-post-id="${cssAttributeValue(selectedPostForScroll)}"]`
            : null
        : (view.level === "section" || view.level === "trash") &&
            selectedPostForScroll
          ? `[data-workspace-post-id="${cssAttributeValue(selectedPostForScroll)}"]`
          : null;
    if (!selector) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(selector)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [
    effectiveSelectedPostIdentity,
    effectiveSelectedSectionPath,
    itemIdentity,
    mounted,
    view.level,
  ]);

  const openPostId = useCallback(
    (postId: string, mode: "read" | "edit" = "read") => {
      const post = itemIdentity.resolvePost(displayPool, postId);
      if (!post) return;
      openPoolPost(
        post,
        view.level === "section" ||
          view.level === "post" ||
          view.level === "edit"
          ? view.folderPath
          : undefined,
        mode,
      );
    },
    [displayPool, itemIdentity, openPoolPost, view],
  );

  const selectRelativePost = useCallback(
    (direction: 1 | -1) => {
      const ids = visiblePosts.map((post) => post.id);
      if (ids.length === 0) return;
      const currentId =
        effectiveSelectedPostId ??
        (view.level === "post" || view.level === "edit" ? view.postId : null);
      const currentIndex = currentId ? ids.indexOf(currentId) : -1;
      const nextIndex =
        currentIndex === -1
          ? direction > 0
            ? 0
            : ids.length - 1
          : (currentIndex + direction + ids.length) % ids.length;
      const nextId = ids[nextIndex] ?? null;
      if (!nextId) return;
      if (view.level === "post" || view.level === "edit") {
        openPostId(nextId);
        return;
      }
      selectOnlyPost(nextId);
    },
    [effectiveSelectedPostId, openPostId, selectOnlyPost, view, visiblePosts],
  );

  const visiblePostIdsInDocumentOrder = useCallback(() => {
    if (typeof document === "undefined")
      return visiblePosts.map((post) => post.id);
    const ids = visibleWorkspaceItems("data-workspace-post-id")
      .map((element) => element.dataset.workspacePostId)
      .filter((id): id is string => Boolean(id));
    return ids.length > 0 ? ids : visiblePosts.map((post) => post.id);
  }, [visiblePosts]);

  const handleItemClick = useCallback(
    (postId: string, event: ReactMouseEvent<HTMLElement>): boolean => {
      const selection = selectionFromClick({
        anchorId: selectionAnchorPostIdRef.current,
        orderedIds: visiblePostIdsInDocumentOrder(),
        range: event.shiftKey,
        selectedIds: selectedPostIds,
        targetId: postId,
        toggle: event.metaKey || event.ctrlKey,
      });
      applyPostSelection(selection);
      return selection.open;
    },
    [applyPostSelection, selectedPostIds, visiblePostIdsInDocumentOrder],
  );

  const extendPostSelection = useCallback(
    (direction: -1 | 1) => {
      const elements = visibleWorkspaceItems("data-workspace-post-id");
      const currentElement = elements.find(
        (element) =>
          element.dataset.workspacePostId === effectiveSelectedPostId,
      );
      const spatialTarget = currentElement
        ? spatialNeighbor(
            elements,
            currentElement,
            direction > 0 ? "down" : "up",
          )?.dataset.workspacePostId
        : undefined;
      const selection = extendSelectionByKeyboard({
        activeId: effectiveSelectedPostId,
        anchorId: selectionAnchorPostIdRef.current,
        direction,
        orderedIds: visiblePostIdsInDocumentOrder(),
        targetId: spatialTarget,
      });
      applyPostSelection(selection);
      if (!selection.activeId) return;
      const selector = `[data-workspace-post-id="${cssAttributeValue(
        selection.activeId,
      )}"]`;
      window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(selector);
        element?.scrollIntoView({ block: "nearest" });
        element?.focus({ preventScroll: true });
      });
    },
    [
      applyPostSelection,
      effectiveSelectedPostId,
      visiblePostIdsInDocumentOrder,
    ],
  );

  const toggleStarSelected = useCallback(() => {
    if (!canManageFolders) return;
    const ids =
      effectiveSelectedPostIds.size > 0
        ? Array.from(effectiveSelectedPostIds)
        : effectiveSelectedPostId
          ? [effectiveSelectedPostId]
          : [];
    const posts = ids
      .map((id) => findPoolPostById(displayPoolRef.current, id))
      .filter((post): post is WorkspacePoolPost => Boolean(post));
    if (posts.length === 0) return;
    const nextStarred = !posts.every((post) => Boolean(post.starred));
    const optimisticUpdatedAt = new Date().toISOString();
    for (const post of posts) {
      updatePost(post.id, {
        starred: nextStarred,
        updatedAt: optimisticUpdatedAt,
      });
    }
    void Promise.all(
      posts.map(async (post) => {
        if (Boolean(post.starred) === nextStarred) return;
        try {
          const saved = await toggleEditablePostStarredAction(
            displayPoolRef.current.blog.handle,
            post.id,
          );
          updatePost(post.id, {
            starred: saved.starred,
            updatedAt: saved.updatedAt,
          });
        } catch (error) {
          updatePost(post.id, {
            starred: post.starred,
            updatedAt: post.updatedAt,
          });
          throw error;
        }
      }),
    ).catch((error) => console.warn("workspace star update failed", error));
  }, [canManageFolders, effectiveSelectedPostId, effectiveSelectedPostIds]);

  const focusWorkspaceBody = useCallback(() => {
    activateRegion("body");
    const selected = document.querySelector<HTMLElement>(
      '.post-editor-content [role="option"][aria-selected="true"]',
    );
    if (selected) bodySelectionActiveRef.current = true;
    (selected ?? contentRef.current)?.focus({ preventScroll: true });
  }, [activateRegion]);

  const focusWorkspaceSidebar = useCallback(() => {
    activateRegion("sidebar");
    const focusRow = () => {
      const preferredPath = lastSidebarPathRef.current;
      const selector = `[data-workspace-sidebar-path="${cssAttributeValue(preferredPath ?? "")}"]`;
      const row = document.querySelector<HTMLButtonElement>(selector);
      row?.focus({ preventScroll: true });
      if (row) sidebarSelectionActiveRef.current = true;
    };
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(focusRow),
      );
      return;
    }
    focusRow();
  }, [activateRegion, setSidebarCollapsed, sidebarCollapsed]);

  const moveSidebarSelection = useCallback((direction: "next" | "previous") => {
    const nav = document.querySelector<HTMLElement>(".post-editor-folder-nav");
    if (!nav) return;
    if (!sidebarSelectionActiveRef.current) {
      const selector = `[data-workspace-sidebar-path="${cssAttributeValue(
        lastSidebarPathRef.current,
      )}"]`;
      const remembered = nav.querySelector<HTMLButtonElement>(selector);
      (remembered ?? focusSidebarRow(nav, direction))?.focus({
        preventScroll: true,
      });
      sidebarSelectionActiveRef.current = true;
      return;
    }
    focusSidebarRow(nav, direction);
  }, []);

  const selectSpatial = useCallback(
    (direction: SpatialDirection) => {
      if (activeRegionRef.current === "sidebar") {
        if (direction === "right") focusWorkspaceBody();
        else if (direction === "up" || direction === "down") {
          moveSidebarSelection(direction === "down" ? "next" : "previous");
        }
        return;
      }
      const current = viewRef.current;
      if (current.level === "post") {
        if (
          (direction === "up" || direction === "down") &&
          typeof window !== "undefined"
        ) {
          const step = Math.max(
            64,
            Math.round((window.innerHeight || 800) * 0.16),
          );
          window.scrollBy({
            top: direction === "down" ? step : -step,
            behavior: "auto",
          });
        }
        return;
      }
      if (current.level === "edit" || typeof document === "undefined") return;

      if (!bodySelectionActiveRef.current && lastActivePostIdRef.current) {
        const remembered = document.querySelector<HTMLElement>(
          `[data-workspace-post-id="${cssAttributeValue(
            lastActivePostIdRef.current,
          )}"]`,
        );
        if (remembered) {
          selectOnlyPost(lastActivePostIdRef.current);
          remembered.focus({ preventScroll: true });
          bodySelectionActiveRef.current = true;
          return;
        }
      }

      const root = current.level === "root" || current.level === "search";
      const items = root
        ? Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-workspace-section-path], [data-workspace-post-id]",
            ),
          ).filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
        : visibleWorkspaceItems("data-workspace-post-id");
      const currentElement =
        items.find((element) =>
          root
            ? (effectiveSelectedSectionPath &&
                element.dataset.workspaceSectionPath ===
                  effectiveSelectedSectionPath) ||
              (effectiveSelectedPostId &&
                element.dataset.workspacePostId === effectiveSelectedPostId)
            : element.dataset.workspacePostId === effectiveSelectedPostId,
        ) ?? null;
      let next = spatialNeighbor(items, currentElement, direction);
      if (!next) return;
      if (
        current.level === "root" &&
        direction === "up" &&
        currentElement?.dataset.workspacePostId &&
        next.dataset.workspaceSectionPath
      ) {
        const rememberedPath = rememberedRootFolderPath(
          displayPoolRef.current.folders,
          lastRootFolderPathRef.current,
        );
        next =
          items.find(
            (item) => item.dataset.workspaceSectionPath === rememberedPath,
          ) ?? next;
      }
      if (
        shouldMoveSelectionIntoSidebar({
          direction,
          hasCurrentItem: Boolean(currentElement),
          neighborChanged: next !== currentElement,
        })
      ) {
        focusWorkspaceSidebar();
        return;
      }
      if (root) {
        const path = next.dataset.workspaceSectionPath;
        const postId = next.dataset.workspacePostId;
        if (path) {
          const remembered = rootFolderPathForSelection(
            displayPoolRef.current.folders,
            path,
          );
          if (remembered) lastRootFolderPathRef.current = remembered;
          clearPostSelection();
          setSelectedSectionPath(path);
        } else if (postId) {
          selectOnlyPost(postId);
        }
      } else {
        const postId = next.dataset.workspacePostId;
        if (postId) selectOnlyPost(postId);
      }
    },
    [
      effectiveSelectedPostId,
      effectiveSelectedSectionPath,
      clearPostSelection,
      focusWorkspaceBody,
      focusWorkspaceSidebar,
      moveSidebarSelection,
      selectOnlyPost,
    ],
  );

  const selectRelativeSection = useCallback((direction: 1 | -1) => {
    const sections = rootSectionFolders(displayPoolRef.current);
    if (sections.length === 0) return;
    const currentPath = selectedSectionPathRef.current;
    const currentIndex = currentPath
      ? sections.findIndex((folder) => folder.path === currentPath)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? direction > 0
          ? 0
          : sections.length - 1
        : (currentIndex + direction + sections.length) % sections.length;
    const nextPath = sections[nextIndex]?.path ?? null;
    if (nextPath) {
      lastRootFolderPathRef.current = nextPath;
      setSelectedSectionPath(nextPath);
    }
  }, []);

  const openSectionByIndex = useCallback(
    (index: number) => {
      const section = rootSectionFolders(displayPoolRef.current)[index];
      if (!section) return;
      setSelectedSectionPath(section.path);
      navigateSection(section.path);
    },
    [navigateSection],
  );

  const getNavigationTargetPaths = useCallback(() => {
    if (typeof document === "undefined") return [""];
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".post-editor-folder-nav [data-workspace-sidebar-path]",
      ),
    ).map((row) => row.dataset.workspaceSidebarPath ?? "");
  }, []);

  const navigateToNavTargetByIndex = useCallback(
    (index: number) => {
      const path = getNavigationTargetPaths()[index];
      if (path === undefined) return;
      lastSidebarPathRef.current = path;
      if (path) navigateSection(path);
      else navigateRoot();
    },
    [getNavigationTargetPaths, navigateRoot, navigateSection],
  );

  const openItemByIndex = useCallback(
    (index: number) => {
      const current = viewRef.current;
      if (current.level === "root" || current.level === "search") {
        const postId = visiblePostIdsInDocumentOrder()[index];
        if (postId) openPostId(postId);
        return;
      }
      if (current.level !== "section" && current.level !== "trash") return;
      const postId = visiblePostIdsInDocumentOrder()[index];
      if (postId) openPostId(postId);
    },
    [openPostId, visiblePostIdsInDocumentOrder],
  );

  const openSelected = useCallback(() => {
    if (activeRegionRef.current === "sidebar") {
      const row =
        document.activeElement instanceof HTMLButtonElement &&
        document.activeElement.matches("[data-workspace-sidebar-path]")
          ? document.activeElement
          : null;
      row?.click();
      if (row) {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(focusWorkspaceBody),
        );
      }
      return;
    }
    if (
      viewRef.current.level === "root" ||
      viewRef.current.level === "search"
    ) {
      if (effectiveSelectedPostId) {
        openPostId(effectiveSelectedPostId);
        return;
      }
      const sectionPath = validRootSectionPath(
        displayPoolRef.current,
        selectedSectionPathRef.current,
      );
      if (sectionPath) navigateSection(sectionPath);
      return;
    }
    const current = viewRef.current;
    const postId =
      effectiveSelectedPostId ??
      (current.level === "post" || current.level === "edit"
        ? current.postId
        : null);
    if (postId) openPostId(postId);
  }, [
    effectiveSelectedPostId,
    focusWorkspaceBody,
    navigateSection,
    openPostId,
  ]);

  const stopEditing = useCallback(() => {
    const current = viewRef.current;
    if (current.level !== "edit") return;
    const post = findPoolPostById(displayPoolRef.current, current.postId);
    if (!post) {
      if (current.returnToSearch) navigateSearch(current.returnToSearch);
      else navigateSection(current.folderPath);
      return;
    }
    if (post.type === "note") {
      if (current.returnToSearch) navigateSearch(current.returnToSearch);
      else navigateSection(current.folderPath);
      return;
    }
    navigateToView(
      {
        level: "post",
        postId: post.id,
        folderPath: current.folderPath,
        openedFrom: current.openedFrom,
        returnToSearch: current.returnToSearch,
      },
      workspaceHrefWithSearchReturn(
        blogWorkspacePostPath(
          displayPoolRef.current.blog,
          current.folderPath,
          post,
        ),
        current.returnToSearch,
      ),
      { selectedPostId: post.id },
    );
  }, [navigateSearch, navigateSection, navigateToView]);

  const editCurrent = useCallback(() => {
    const current = viewRef.current;
    if (current.level === "post") {
      openPostId(current.postId, "edit");
      return;
    }
    if (current.level === "section") {
      setEditFolderRequestKey((value) => value + 1);
      return;
    }
    if (current.level === "root") {
      if (effectiveSelectedPostId) openPostId(effectiveSelectedPostId, "edit");
    }
  }, [effectiveSelectedPostId, openPostId]);

  const navigatePath = useCallback(
    (path: string) => {
      const url = new URL(path, window.location.origin);
      const nextView = viewFromUrl(displayPool, homePath, url);
      if (nextView.level === "post" || nextView.level === "edit") {
        const post = findPoolPostById(displayPool, nextView.postId);
        if (post) {
          openPoolPost(
            post,
            nextView.folderPath,
            nextView.level === "edit" ? "edit" : "read",
          );
          return;
        }
      }
      const href =
        nextView.level === "root"
          ? workspaceRootHref(homePath)
          : nextView.level === "search"
            ? workspaceSearchHref(homePath, nextView)
            : nextView.level === "settings"
              ? workspaceSettingsHref(homePath)
              : folderWorkspaceHref(homePath, nextView.folderPath);
      navigateToView(nextView, href);
    },
    [displayPool, homePath, navigateToView, openPoolPost],
  );

  const applyNavigationTarget = useCallback(
    (target: ReturnType<typeof workspaceHierarchyUpTarget>) => {
      if (target.kind === "none") return false;
      if (target.kind === "home") navigateRoot();
      else if (target.kind === "folder") navigateSection(target.folderPath);
      else if (target.kind === "search") navigateSearch(target);
      else stopEditing();
      return true;
    },
    [navigateRoot, navigateSearch, navigateSection, stopEditing],
  );

  const navigateUp = useCallback(
    () =>
      applyNavigationTarget(
        workspaceHierarchyUpTarget(
          viewRef.current,
          displayPoolRef.current.folders,
        ),
      ),
    [applyNavigationTarget],
  );

  const escapeCurrent = useCallback(() => {
    const current = viewRef.current;
    const post =
      current.level === "post" || current.level === "edit"
        ? findPoolPostById(displayPoolRef.current, current.postId)
        : null;
    return applyNavigationTarget(
      workspaceEscapeTarget(
        current,
        displayPoolRef.current.folders,
        post?.type,
      ),
    );
  }, [applyNavigationTarget]);

  useEffect(() => {
    const onPopState = () => {
      disarmWorkspaceHover();
      const nextView = currentLocalView(displayPool, homePath);
      const previousView = viewRef.current;
      if (
        previousView.level === "edit" &&
        (nextView.level !== "edit" || nextView.postId !== previousView.postId)
      ) {
        window.dispatchEvent(new Event(STOP_LOCAL_EDITING_EVENT));
      }
      viewRef.current = nextView;
      setView(nextView);
      const nextSelectedPostId = selectedPostIdForView(displayPool, nextView);
      selectionAnchorPostIdRef.current = nextSelectedPostId;
      setSelectedPostId(nextSelectedPostId);
      setSelectedPostIds(
        new Set(nextSelectedPostId ? [nextSelectedPostId] : []),
      );
      if (nextView.level === "root" || nextView.level === "search") {
        setSelectedSectionPath(null);
        setSearchQuery(nextView.level === "search" ? nextView.query : "");
      } else {
        setSelectedSectionPath(null);
        setSearchQuery("");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [displayPool, homePath]);

  const readerScrollBlocked = useCallback(() => {
    if (typeof document === "undefined") return true;
    // A live menu, popover, or the shortcut sheet owns the keyboard.
    return Boolean(document.querySelector('[data-post-edit-menu-open="true"]'));
  }, []);

  const scrollReader = useCallback(
    (direction: "up" | "down", amount: "line" | "half" | "page") => {
      if (typeof window === "undefined" || readerScrollBlocked()) return;
      const viewport = window.innerHeight || 800;
      const step =
        amount === "line"
          ? Math.max(64, Math.round(viewport * 0.16))
          : amount === "half"
            ? Math.round(viewport * 0.5)
            : Math.round(viewport * 0.9);
      window.scrollBy({
        top: direction === "down" ? step : -step,
        behavior: "auto",
      });
    },
    [readerScrollBlocked],
  );

  const scrollReaderEdge = useCallback(
    (edge: "top" | "bottom") => {
      if (typeof window === "undefined" || readerScrollBlocked()) return;
      const top =
        edge === "top"
          ? 0
          : document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    },
    [readerScrollBlocked],
  );

  const readerTapG = useCallback(() => {
    const now = Date.now();
    if (now - gTapRef.current < 400) {
      gTapRef.current = 0;
      scrollReaderEdge("top");
      return;
    }
    gTapRef.current = now;
  }, [scrollReaderEdge]);

  const createItemFromCommand = useCallback(
    (kind: "article" | "note" | "bookmark") => {
      const desiredMode: FolderMode =
        kind === "note" ? "notes" : kind === "bookmark" ? "bookmarks" : "blog";
      const current = viewRef.current;
      if (current.level === "root" || current.level === "search") {
        if (current.level === "search") navigateRoot();
        setCaptureFocusRequestKey((value) => value + 1);
        return;
      }
      const currentFolder =
        displayPoolRef.current.folders.find(
          (folder) =>
            folder.path === ("folderPath" in current ? current.folderPath : ""),
        ) ?? null;
      const targetFolder =
        (currentFolder?.mode === desiredMode ? currentFolder : null) ??
        displayPoolRef.current.folders.find(
          (folder) => folder.mode === desiredMode,
        );
      const folderPath =
        targetFolder?.path ?? sidebarFolderPathForPostType(kind);

      createWorkspaceItem(
        kind === "bookmark"
          ? { type: "bookmark", folderPath, blank: true }
          : { type: kind, folderPath },
      );
    },
    [createWorkspaceItem, navigateRoot],
  );

  const commandSurface = useMemo(
    () => ({
      blog: displayPool.blog,
      handle: displayPool.blog.handle,
      homePath,
      viewLevel: view.level === "search" ? "root" : view.level,
      canCreate: canManageFolders,
      canEdit: canManageFolders,
      canManagePost: canManageFolders,
      activeFolderPath: localViewActiveFolder(view),
      activePostId:
        view.level === "post" || view.level === "edit" ? view.postId : null,
      selectedSectionPath: effectiveSelectedSectionPath,
      selectedPostId: effectiveSelectedPostId,
      selectedPostIds: Array.from(effectiveSelectedPostIds),
      getRootSectionPaths: () =>
        rootSectionFolders(displayPoolRef.current).map((folder) => folder.path),
      getNavigationTargetPaths,
      getVisiblePostIds: visiblePostIdsInDocumentOrder,
      getPost: (postId: string) =>
        findPoolPostById(displayPoolRef.current, postId),
      selectPost: (postId: string | null) => {
        selectOnlyPost(postId);
      },
      selectSection: (folderPath: string | null) => {
        clearPostSelection();
        const remembered = rootFolderPathForSelection(
          displayPoolRef.current.folders,
          folderPath,
        );
        if (remembered) lastRootFolderPathRef.current = remembered;
        setSelectedSectionPath(
          validRootSectionPath(displayPoolRef.current, folderPath),
        );
      },
      selectSpatial,
      extendSelection: (direction: -1 | 1) => {
        if (activeRegionRef.current === "sidebar") {
          moveSidebarSelection(direction > 0 ? "next" : "previous");
          return;
        }
        extendPostSelection(direction);
      },
      selectNext: () => {
        if (viewRef.current.level === "post") {
          scrollReader("down", "line");
          return;
        }
        if (viewRef.current.level === "search") {
          selectSpatial("down");
          return;
        }
        if (viewRef.current.level === "root") {
          selectRelativeSection(1);
          return;
        }
        selectRelativePost(1);
      },
      selectPrevious: () => {
        if (viewRef.current.level === "post") {
          scrollReader("up", "line");
          return;
        }
        if (viewRef.current.level === "search") {
          selectSpatial("up");
          return;
        }
        if (viewRef.current.level === "root") {
          selectRelativeSection(-1);
          return;
        }
        selectRelativePost(-1);
      },
      openSelected,
      openItemByIndex,
      navigateToNavTargetByIndex,
      openSectionByIndex,
      openPost: openPostId,
      editCurrent,
      stopEditing,
      requestDeleteTarget,
      toggleStarSelected,
      scrollReader,
      scrollReaderEdge,
      readerTapG,
      openAdjacentPost: (direction: 1 | -1) => selectRelativePost(direction),
      createItem: createItemFromCommand,
      openCreatedPost,
      reconcileCreatedPost,
      openFolder: navigateSection,
      navigateRoot,
      navigateUp,
      escapeCurrent,
      focusSearch,
      openSettings: navigateSettings,
      afterDelete: (postId: string) => {
        setSelectedPostIds((current) => {
          const next = new Set(current);
          next.delete(postId);
          return next;
        });
        setSelectedPostId((current) => (current === postId ? null : current));
        if (
          (view.level === "post" || view.level === "edit") &&
          view.postId === postId
        ) {
          navigateUp();
        }
      },
      startBookmarkCreate: () => {
        if (localViewActiveFolder(view) !== "bookmarks") {
          navigateSection("bookmarks");
        }
        setCreateBookmarkRequestKey((current) => current + 1);
      },
    }),
    [
      canManageFolders,
      createItemFromCommand,
      displayPool,
      editCurrent,
      escapeCurrent,
      focusSearch,
      homePath,
      navigateRoot,
      navigateSection,
      navigateSettings,
      navigateToNavTargetByIndex,
      navigateUp,
      openCreatedPost,
      openSelected,
      openItemByIndex,
      getNavigationTargetPaths,
      openSectionByIndex,
      openPostId,
      reconcileCreatedPost,
      readerTapG,
      requestDeleteTarget,
      scrollReader,
      scrollReaderEdge,
      selectRelativePost,
      selectRelativeSection,
      selectSpatial,
      selectOnlyPost,
      clearPostSelection,
      extendPostSelection,
      moveSidebarSelection,
      effectiveSelectedSectionPath,
      effectiveSelectedPostId,
      effectiveSelectedPostIds,
      stopEditing,
      toggleStarSelected,
      view,
      visiblePostIdsInDocumentOrder,
    ],
  );

  useWorkspaceCommandSurface(mounted ? commandSurface : null);

  const beginBackgroundSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target;
      const insideInteractive =
        target instanceof Element &&
        Boolean(
          target.closest(
            // Any editable host, not only contenteditable="true": a
            // plaintext-only surface is just as interactive, and leaving it out
            // meant the background-selection handler swallowed its clicks and
            // focused the scroll container instead of the writer's field.
            '.reader, .reader-prose, [data-static-prose], [role="option"], a, button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]',
          ),
        );
      if (
        !shouldClearWorkspaceSelection({
          button: event.button,
          defaultPrevented: event.defaultPrevented,
          insideInteractive,
        })
      ) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      const baseIds = additive ? new Set(selectedPostIds) : new Set<string>();
      let dragging = false;
      bodySelectionActiveRef.current = false;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      clearPostSelection();
      setSelectedSectionPath(null);

      const move = (moveEvent: PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5
        ) {
          return;
        }
        dragging = true;
        const rectangle: SelectionRectangle = {
          left: Math.min(startX, moveEvent.clientX),
          right: Math.max(startX, moveEvent.clientX),
          top: Math.min(startY, moveEvent.clientY),
          bottom: Math.max(startY, moveEvent.clientY),
        };
        setMarqueeRectangle(rectangle);
        const items = visibleWorkspaceItems("data-workspace-post-id").flatMap(
          (element) => {
            const id = element.dataset.workspacePostId;
            if (!id) return [];
            const bounds = element.getBoundingClientRect();
            return [
              {
                id,
                rectangle: {
                  left: bounds.left,
                  right: bounds.right,
                  top: bounds.top,
                  bottom: bounds.bottom,
                },
              },
            ];
          },
        );
        const next = marqueeSelectionIds({
          additiveIds: baseIds,
          items,
          rectangle,
        });
        const activeId = Array.from(next).at(-1) ?? null;
        applyPostSelection({
          activeId,
          anchorId: Array.from(next)[0] ?? null,
          selectedIds: next,
        });
      };
      const finish = () => {
        setMarqueeRectangle(null);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [applyPostSelection, clearPostSelection, selectedPostIds],
  );

  const content = (
    <LocalWorkspaceContent
      blog={displayPool.blog}
      canCommentPost={canCommentPost}
      canCreateItems={canManageFolders}
      canEditItems={canManageFolders}
      canManageSharing={canManageSharing}
      canManagePost={canManageFolders}
      captureFocusRequestKey={captureFocusRequestKey}
      createBookmarkRequestKey={createBookmarkRequestKey}
      editFolderRequestKey={editFolderRequestKey}
      handle={displayPool.blog.handle}
      homePath={homePath}
      itemIdentity={itemIdentity}
      onNavigate={navigatePath}
      onCaptureResolved={applyResolvedCapture}
      onCreateItem={createWorkspaceItem}
      onDeleteItem={deleteWorkspaceItem}
      onDeleteFolder={deleteWorkspaceFolder}
      onOpenSection={navigateSection}
      onOpenPostId={openPostId}
      onOpenPost={openPost}
      onOpenRoot={navigateRoot}
      onOpenTag={navigateTag}
      onItemClick={handleItemClick}
      onQueryChange={changeSearchQuery}
      onSearch={focusSearch}
      onSelectPost={(postId) => {
        activateRegion("body");
        activatePostSelection(postId);
      }}
      onSelectSection={(folderPath) => {
        activateRegion("body");
        clearPostSelection();
        const remembered = rootFolderPathForSelection(
          displayPoolRef.current.folders,
          folderPath,
        );
        if (remembered) lastRootFolderPathRef.current = remembered;
        setSelectedSectionPath(
          validRootSectionPath(displayPoolRef.current, folderPath),
        );
      }}
      pool={displayPool}
      searchFocusRequestKey={searchFocusRequestKey}
      searchQuery={searchQuery}
      selectedSectionPath={effectiveSelectedSectionPath}
      selectedPostId={effectiveSelectedPostId}
      selectedPostIds={effectiveSelectedPostIds}
      view={view}
      assistantConnection={assistant.nativeConnection}
      assistantCloudProvider={assistant.cloudProvider}
      onConnectAssistant={assistant.connectNativeAssistant}
      onOpenAssistant={() => changeAssistantState("pinned")}
      onBuildItemType={(folderPath = "") =>
        setItemTypeStudioFolderPath(folderPath)
      }
      onFocusCapture={() =>
        setCaptureFocusRequestKey((value) => value + 1)
      }
    />
  );

  const effectiveSidebarCollapsed = sidebarCollapsed;
  return (
    <div
      className={`post-editor-shell applecms has-sidebar ${className}${
        effectiveSidebarCollapsed ? " is-sidebar-collapsed" : ""
      } is-active-region-${activeRegion}${
        marqueeRectangle ? " is-marquee-dragging" : ""
      } assistant-is-${assistantState}${
        assistantState === "pinned" ? " has-assistant-pinned" : ""
      }${assistantState !== "hidden" ? " has-assistant-open" : ""}`}
      style={
        {
          "--workspace-assistant-width": `${assistantWidth}px`,
        } as CSSProperties
      }
    >
      <WorkspaceSidebarChrome
        blog={displayPool.blog ?? blog}
        activeFolder={localViewActiveFolder(view)}
        canManageFolders={canManageFolders}
        canManageSharing={canManageSharing}
        collapsed={effectiveSidebarCollapsed}
        counts={displayPool.counts}
        documents={displayPool.posts}
        folders={displayPool.folders}
        homeActive={view.level === "root" || view.level === "search"}
        homePath={homePath}
        onSelectFolder={navigateSection}
        onSearchDate={navigateDateSearch}
        onReturnToBody={focusWorkspaceBody}
        onSidebarFocus={(path) => {
          activateRegion("sidebar");
          lastSidebarPathRef.current = path;
          sidebarSelectionActiveRef.current = true;
        }}
        onSidebarEmptyPointerDown={(nav) => {
          activateRegion("sidebar");
          sidebarSelectionActiveRef.current = false;
          nav.focus({ preventScroll: true });
        }}
        onSettings={navigateSettings}
        onBuildItemType={(folder) => setItemTypeStudioFolderPath(folder.path)}
        onSelectRoot={navigateRoot}
        onToggleCollapsed={toggleSidebarCollapsed}
        peeking={leftEdgePeeking}
        onPeekEngage={() => {
          setLeftEdgePeeking(false);
          if (sidebarCollapsed) setSidebarCollapsed(false);
        }}
        prefetchFolders={false}
        sharedCount={displayPool.sharedEntries?.length ?? 0}
        starredCount={displayPool.posts.filter((post) => post.starred).length}
        trashCount={
          (displayPool.trashedPosts?.length ?? 0) +
          (displayPool.trashedFolders?.length ?? 0)
        }
      />
      <div className="workspace-document-layout">
        <div
          ref={contentRef}
          tabIndex={-1}
          onFocusCapture={(event) => {
            activateRegion("body");
            if (
              event.target instanceof Element &&
              event.target.closest('[role="option"]')
            ) {
              bodySelectionActiveRef.current = true;
            }
          }}
          onPointerDown={(event) => {
            activateRegion("body");
            beginBackgroundSelection(event);
          }}
          className={`post-editor-content${
            localViewActiveFolder(view) === "blog" ? " is-blog-folder-view" : ""
          }`}
        >
          {content}
        </div>
        {marqueeRectangle && (
          <div
            className="workspace-selection-marquee"
            aria-hidden="true"
            style={{
              left: marqueeRectangle.left,
              top: marqueeRectangle.top,
              width: marqueeRectangle.right - marqueeRectangle.left,
              height: marqueeRectangle.bottom - marqueeRectangle.top,
            }}
          />
        )}
        <WorkspaceSelectionToolbar
          blog={displayPool.blog}
          folders={displayPool.folders}
          posts={selectedPoolPosts}
          onDelete={deleteSelectedPosts}
          onMove={moveSelectedPosts}
          onToggleStar={toggleStarSelected}
        />
        {/* AI at the point of writing. Runs the same quick actions the
          rail runs, against the same selection it already reads, and the
          result arrives as a proposal to accept or undo. */}
        <SelectionActions
          enabled={
            assistant.ownerScopeReady && assistantTarget.view.level === "edit"
          }
          readSelection={() =>
            assistantTarget.view.level === "edit" && assistantTarget.view.postId
              ? readOpenWorkspaceItemSelection(assistantTarget.view.postId)
              : null
          }
          onRunAction={(id) => {
            if (assistantState === "hidden") changeAssistantState("pinned");
            void assistant.runQuickAction(id);
          }}
        />

        <AssistantSidebar
          workspaceHandle={displayPool.blog.handle}
          agent={assistantAgentIdentity(
            assistant.cloudProvider,
            assistant.nativeConnection,
            collaboratorColor,
            assistant.runningJobs > 0,
          )}
          onNewConversation={assistant.startNewConversation}
          hasConversation={assistant.messages.length > 0}
          activeConversationId={assistant.activeConversationId}
          conversations={assistant.conversations}
          onOpenConversation={assistant.openConversation}
          onSearchConversations={assistant.searchConversations}
          onToggleConversationPinned={assistant.toggleConversationPinned}
          modelChoices={assistant.modelChoices}
          selectedModel={assistant.selectedCloudModel}
          onModelChange={assistant.selectCloudModel}
          className="workspace-assistant-shell"
          state={assistantState}
          onStateChange={changeAssistantState}
          width={assistantWidth}
          onWidthChange={changeAssistantWidth}
          // Auto: pinned participates in the shell grid as a real column;
          // open/hidden float over the page. The module owns its own
          // positioning per state, and the grid only reserves a column when
          // the shell says has-assistant-pinned, so nothing is reserved for a
          // hidden rail. inline was wrong here: it holds a track open in every
          // state, which squeezed the library beside an invisible assistant.
          layout="auto"
          context={assistantContext}
          composerValue={assistantComposer.draft.text}
          onComposerChange={assistantComposer.setText}
          attachments={assistantComposer.draft.attachments}
          availableContextItems={assistantContextItems}
          onAddContextItem={assistantComposer.addContextItem}
          onFilesSelected={assistantComposer.addFiles}
          onRemoveAttachment={(attachment) =>
            assistantComposer.removeAttachment(attachment.id)
          }
          onSubmit={(submission) => {
            if (!assistant.ownerScopeReady) return;
            assistantComposer.clear();
            void assistant.submit(submission.text, submission.attachments);
          }}
          onCancel={assistant.cancel}
          submitting={assistant.submitting}
          submitDisabled={!assistant.ownerScopeReady}
          launcherBusy={assistant.runningJobs > 0}
          composerPlaceholder={
            assistant.ownerScopeStatus === "checking"
              ? "Checking assistant access"
              : assistant.ownerScopeStatus === "denied"
                ? "Assistant is available to the workspace owner"
                : assistant.cloudProvider ||
                    assistant.nativeConnection?.state === "ready"
                  ? undefined
                  : "Connect an AI to start"
          }
          accept={assistant.attachmentAccept}
          attachmentDisabled={!assistant.attachmentsAvailable}
          attachmentTitle={assistant.attachmentTitle}
        >
          <AssistantConversation
            accessState={assistant.ownerScopeStatus}
            activeCloudProvider={assistant.activeCloudProvider}
            cloudProvider={assistant.cloudProvider}
            nativeConnection={assistant.nativeConnection}
            onConnectNative={assistant.connectNativeAssistant}
            aiSettingsHref={`${workspaceSettingsHref(homePath)}#api-key-connections`}
            onOpenAiSettings={() => changeAssistantState("hidden")}
            onRetry={(prompt) => assistant.submit(prompt)}
            onSaveAnswer={assistant.saveAnswer}
            savingAnswerId={assistant.savingAnswerId}
            onRateAnswer={assistant.rateAnswer}
            onWriteProposalDecision={assistant.decideWriteProposal}
            jobs={assistant.jobs}
            messages={assistant.messages}
            starterContext={starterContextFromChip(assistantContext)}
            viewerName={blog.author}
            quickActions={assistant.quickActions}
            submitting={assistant.submitting}
            onApplyProposal={assistant.applyProposal}
            onOpenJob={(job) => {
              // Jump to the context the job reports into: items open directly,
              // places navigate by their stored URL.
              if (job.contextKey.startsWith("item:")) {
                openPostId(job.contextKey.slice("item:".length));
                return;
              }
              if (job.contextKey.startsWith("place:")) {
                navigatePath(job.contextKey.slice("place:".length));
              }
            }}
            onUsePrompt={assistantComposer.setText}
            onQuickAction={assistant.runQuickAction}
            onUndoProposal={assistant.undoProposal}
          />
        </AssistantSidebar>
      </div>
      <UpdatedBuildNotice />
      {itemTypeStudioFolderPath !== null ? (
        <ItemTypeStudio
          blogId={displayPool.blogId}
          folders={displayPool.folders}
          generateWithConnectedAgent={
            assistant.nativeConnection?.state === "ready"
              ? assistant.generateItemTypeBlueprint
              : undefined
          }
          handle={displayPool.blog.handle}
          initialFolderPath={itemTypeStudioFolderPath}
          onClose={() => setItemTypeStudioFolderPath(null)}
          previewDocuments={itemTypeStudioPreviewDocuments}
        />
      ) : null}
      <ConfirmationDialog
        open={Boolean(assistantConfirmation)}
        title="Confirm assistant action"
        message={assistantConfirmation?.description ?? ""}
        confirmLabel="Continue"
        onCancel={assistantConfirmationController.cancel}
        onConfirm={assistantConfirmationController.confirm}
      />
      <ConfirmationDialog
        open={pendingDeletePostIds.length > 0}
        title={
          pendingDeletePostIds.length > 1
            ? `Move ${pendingDeletePostIds.length} items to Trash?`
            : "Move this item to Trash?"
        }
        message={
          pendingDeletePostIds.length > 1
            ? "You can restore them later from Trash."
            : "You can restore it later from Trash."
        }
        confirmLabel="Move to Trash"
        onCancel={() => setPendingDeletePostIds([])}
        onConfirm={confirmDeleteTarget}
      />
    </div>
  );
}

export function BlogHomeWorkspaceShell({
  activeFolder = null,
  blog,
  children,
  canCommentPost = false,
  counts,
  canManageFolders = false,
  canManageSharing = false,
  folders,
  homePath,
  initialSidebarCollapsed = false,
  initialSearchQuery = "",
  initialSearchSource = "query",
  initialSettingsOpen = false,
  initialPool,
}: {
  activeFolder?: SidebarFolderId | null;
  blog: Blog;
  children: ReactNode;
  canCommentPost?: boolean;
  counts: Record<string, number>;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  folders: Folder[];
  homePath: string;
  initialSidebarCollapsed?: boolean;
  initialSearchQuery?: string;
  initialSearchSource?: WorkspaceSearchLocation["source"];
  initialSettingsOpen?: boolean;
  initialPool?: WorkspacePoolPayload | null;
}) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  const selectFolder = useCallback(
    (folder: SidebarFolderId) => {
      router.push(folderWorkspaceHref(homePath, folder));
    },
    [homePath, router],
  );

  if (initialPool) {
    return (
      <WorkspaceProvider initialPool={initialPool}>
        <LocalWorkspaceShell
          blog={blog}
          canCommentPost={canCommentPost}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          className="is-home-workspace-shell"
          homePath={homePath}
          initialPool={initialPool}
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialSearchQuery={initialSearchQuery}
          initialView={
            initialSettingsOpen
              ? { level: "settings" }
              : activeFolder === TRASH_FOLDER_PATH
                ? { level: "trash", folderPath: TRASH_FOLDER_PATH }
                : activeFolder === SHARED_FOLDER_PATH
                  ? { level: "shared", folderPath: SHARED_FOLDER_PATH }
                  : activeFolder === STARRED_FOLDER_PATH
                    ? { level: "starred", folderPath: STARRED_FOLDER_PATH }
                    : activeFolder
                      ? { level: "section", folderPath: activeFolder }
                      : initialSearchQuery
                        ? {
                            level: "search",
                            query: initialSearchQuery,
                            source: initialSearchSource,
                          }
                        : { level: "root" }
          }
        >
          {children}
        </LocalWorkspaceShell>
      </WorkspaceProvider>
    );
  }

  return (
    <div
      className={`post-editor-shell applecms has-sidebar is-home-workspace-shell${
        sidebarCollapsed ? " is-sidebar-collapsed" : ""
      }`}
    >
      <WorkspaceSidebarChrome
        blog={blog}
        activeFolder={activeFolder}
        canManageFolders={canManageFolders}
        canManageSharing={canManageSharing}
        collapsed={sidebarCollapsed}
        counts={counts}
        folders={folders}
        homePath={homePath}
        onSelectFolder={selectFolder}
        onSelectRoot={() => router.push(homePath)}
        onToggleCollapsed={toggleSidebarCollapsed}
      />
      <div
        className={`post-editor-content${
          activeFolder === "blog" ? " is-blog-folder-view" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function PostReadWorkspaceShell({
  adjacent,
  blog,
  children,
  canCommentPost = false,
  canManageFolders = false,
  canManageSharing = false,
  counts,
  folders,
  homePath,
  initialSidebarCollapsed = false,
  initialPool,
  initialPostBody,
  initialMode = "read",
  post,
  postPath,
}: {
  adjacent: AdjacentPosts;
  blog: Blog;
  children: ReactNode;
  canCommentPost?: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  counts: Record<string, number>;
  folders: Folder[];
  homePath: string;
  initialSidebarCollapsed?: boolean;
  initialPool?: WorkspacePoolPayload | null;
  initialPostBody?: WorkspaceInitialBody | null;
  initialMode?: "read" | "edit";
  post: Post;
  postPath: string;
}) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);
  const localInitialPool = useMemo(() => {
    if (!initialPool || !initialPostBody) return initialPool;
    return {
      ...initialPool,
      initialBodies: [
        ...(initialPool.initialBodies ?? []).filter(
          (body) => body.postId !== initialPostBody.postId,
        ),
        initialPostBody,
      ],
    };
  }, [initialPool, initialPostBody]);
  const localInitialPost =
    localInitialPool && post.id
      ? findPoolPostById(localInitialPool, post.id)
      : null;
  const localInitialMode =
    initialMode === "edit" ||
    (localInitialPost &&
      shouldOpenWorkspacePostInEdit(localInitialPost, initialPostBody?.body))
      ? "edit"
      : "read";

  const selectSidebarFolder = useCallback(
    (folder: SidebarFolderId) => {
      router.push(folderWorkspaceHref(homePath, folder));
    },
    [homePath, router],
  );

  if (localInitialPool) {
    return (
      <WorkspaceProvider
        initialPool={localInitialPool}
        initialBody={initialPostBody}
      >
        <LocalWorkspaceShell
          blog={blog}
          canCommentPost={canCommentPost}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          className="is-read-workspace-shell"
          homePath={homePath}
          initialPool={localInitialPool}
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialView={
            post.id
              ? {
                  level: localInitialMode === "edit" ? "edit" : "post",
                  postId: post.id,
                  folderPath: sidebarFolderPathForPostType(post.type),
                }
              : { level: "root" }
          }
        >
          <PostActionBar
            mode="read"
            owner
            blog={blog}
            canCommentPost={canCommentPost}
            post={post}
            adjacent={adjacent}
            homePath={folderWorkspaceHref(
              homePath,
              sidebarFolderPathForPostType(post.type),
            )}
            postPath={postPath}
          />
          {children}
        </LocalWorkspaceShell>
      </WorkspaceProvider>
    );
  }

  return (
    <div
      className={`post-editor-shell applecms has-sidebar is-read-workspace-shell${
        sidebarCollapsed ? " is-sidebar-collapsed" : ""
      }`}
    >
      <WorkspaceSidebarChrome
        blog={blog}
        activeFolder={sidebarFolderPathForPostType(post.type)}
        canManageFolders={canManageFolders}
        canManageSharing={canManageSharing}
        collapsed={sidebarCollapsed}
        counts={counts}
        folders={folders}
        homePath={homePath}
        onSelectFolder={selectSidebarFolder}
        onToggleCollapsed={toggleSidebarCollapsed}
      />
      <div className="post-editor-content">
        <PostActionBar
          mode="read"
          owner
          blog={blog}
          canCommentPost={canCommentPost}
          post={post}
          adjacent={adjacent}
          homePath={homePath}
          postPath={postPath}
        />
        {children}
      </div>
    </div>
  );
}
