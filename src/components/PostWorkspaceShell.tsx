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
  permanentlyDeleteEditablePostAction,
  permanentlyDeleteFolderAction,
  restoreEditablePostAction,
  restoreFolderAction,
  trashFolderAction,
} from "@/app/editor/actions";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import {
  useEscapeLayer,
  useWorkspaceCommandSurface,
} from "@/components/keyboard/CommandLayer";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/keyboard/CommandPalette";
import {
  FolderPage,
  type FolderCaptureResolved,
  type FolderCreateItem,
  type FolderCreateRequest,
  type FolderDeleteItem,
} from "@/components/FolderPage";
import {
  PostActionBar,
  type BookmarkContentMode,
} from "@/components/PostActionBar";
import { PostByline } from "@/components/PostByline";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { EditReaderPreview } from "@/components/editor/EditReaderPreview";
import {
  EditableCover as WorkspaceEditableCover,
  randomCover,
} from "@/components/editor/EditableCover";
import { LocalWorkspaceBodyEditor } from "@/components/LocalWorkspaceBodyEditor";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceMenuMount } from "@/components/workspace/WorkspaceMenuMount";
import { SharedWithMe } from "@/components/workspace/SharedWithMe";
import {
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH,
  ASSISTANT_SIDEBAR_MAX_WIDTH,
  ASSISTANT_SIDEBAR_MIN_WIDTH,
  AssistantSidebar,
  type AssistantAttachment,
  type AssistantSidebarState,
} from "@/components/workspace/assistant";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { useNativeAssistant } from "@/components/workspace/assistant/useNativeAssistant";
import type { Blog, Folder, FolderMode, Post, PostType } from "@/lib/content";
import { isVideoFile } from "@/lib/content";
import { isNoCoverValue, NO_COVER_VALUE, resolveCover } from "@/lib/cover";
import { COVER_PILE } from "@/lib/cover-pile";
import {
  adjacentPublishedPostsForPool,
  findPoolPostById,
  findPoolPostBySlug,
  folderPathForPoolPost,
  narrowPostFromPost,
  poolPostsForFolder,
  postFromPoolPost,
} from "@/lib/pool/selectors";
import {
  addPost,
  acknowledgePost,
  acknowledgePostBody,
  getWorkspacePost,
  markPostDirty,
  moveFolderToTrash,
  movePostToTrash,
  removeTrashedFolder,
  removeTrashedPost,
  refreshWorkspacePool,
  removePost,
  restoreFolderFromTrash,
  restorePostFromTrash,
  replacePost,
  updatePost,
  updatePostBody,
  useWorkspacePool,
  useWorkspacePostBody,
} from "@/lib/pool/store";
import { WorkspaceProvider } from "@/lib/pool/WorkspaceProvider";
import type {
  WorkspaceInitialBody,
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";
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
import type { AdjacentPublishedPosts } from "@/lib/store";
import {
  isRemoteImageUrl,
  localizeRemoteMarkdownImages,
} from "@/lib/markdown-images";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  WORKSPACE_SIDEBAR_COOKIE_MAX_AGE,
  WORKSPACE_SIDEBAR_STORAGE_KEY,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";
import {
  SHARED_FOLDER_PATH,
  TRASH_FOLDER_PATH,
} from "@/lib/workspace-paths";
import {
  MediaUploadError,
  mediaUploadEndpointForHandle,
  uploadMedia,
} from "@/lib/upload";

/** A folder's workspace-unique path segment, e.g. "blog" or "notes". */
export type SidebarFolderId = string;

type AdjacentPosts = AdjacentPublishedPosts;

function upgradeHttpImageSrc(src: string | undefined): string {
  const value = src ?? "";
  return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
}

function beginEditTransition(postId: string) {
  if (typeof document === "undefined" || typeof performance === "undefined") return;
  document.documentElement.dataset.writeEditStartId = postId;
  document.documentElement.dataset.writeEditStart = String(performance.now());
}

function finishEditTransition(postId: string) {
  if (typeof document === "undefined" || typeof performance === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.writeEditStartId !== postId) return;
  const startedAt = Number(root.dataset.writeEditStart);
  if (Number.isFinite(startedAt)) {
    root.dataset.writeEditReadyMs = (performance.now() - startedAt).toFixed(1);
    root.dataset.writeEditReadyPostId = postId;
  }
  delete root.dataset.writeEditStart;
  delete root.dataset.writeEditStartId;
}

let sidebarCollapsedMemory: boolean | null = null;
const sidebarCollapsedListeners = new Set<() => void>();
let sidebarWidthMemory: number | null = null;
const sidebarWidthListeners = new Set<() => void>();

const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = "write:workspace-sidebar-width";
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 280;
const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;
const localWorkspaceDraftSessions = new Map<string, DraftState>();
const localWorkspacePendingSaveIds = new Set<string>();
const localWorkspaceDraftRevisions = new Map<string, number>();
const localWorkspaceServerRevisions = new Map<string, string>();
const WORKSPACE_ASSISTANT_STATE_KEY = "write:workspace-assistant-state";
const WORKSPACE_ASSISTANT_WIDTH_KEY = "write:workspace-assistant-width";
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
const STOP_LOCAL_EDITING_EVENT = "write:stop-local-editing";

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

/** Client-safe mirror of store.ts folderPathForPostType. */
export function sidebarFolderPathForPostType(type: PostType): SidebarFolderId {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
}

function folderForCreateRequest(
  pool: WorkspacePoolPayload,
  request: FolderCreateRequest,
): Folder | null {
  return (
    pool.folders.find((folder) => folder.path === request.folderPath) ??
    pool.folders.find((folder) => folder.path === sidebarFolderPathForPostType(request.type)) ??
    null
  );
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

function optimisticWorkspacePost(
  pool: WorkspacePoolPayload,
  request: FolderCreateRequest,
): WorkspacePoolPost {
  const now = new Date().toISOString();
  const stamp = Date.now().toString(36);
  const folder = folderForCreateRequest(pool, request);
  const slug = `untitled-${stamp}`;

  if (request.type === "bookmark") {
    const { href, host } = bookmarkUrlParts(request.url);
    const title = request.title?.trim() || host || "Bookmark";
    const description = request.description?.trim();
    return {
      id: `optimistic-bookmark-${stamp}`,
      blogId: pool.blogId,
      folderId: folder?.id,
      type: "bookmark",
      captureStatus: "pending",
      capture: { url: href },
      links: [{ label: host || title, href }],
      slug,
      title,
      excerpt: description || href,
      status: "draft",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: `optimistic-${request.type}-${stamp}`,
    blogId: pool.blogId,
    folderId: folder?.id,
    type: request.type,
    slug,
    title: request.type === "note" ? (request.title?.trim() ?? "") : "",
    excerpt: "",
    status: "draft",
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

function mergeSavedWorkspacePost(
  saved: WorkspacePoolPost,
  localDraft: WorkspacePoolPost | null,
): WorkspacePoolPost {
  if (!localDraft) return saved;
  return {
    ...saved,
    title: localDraft.title || saved.title,
    excerpt: localDraft.excerpt || saved.excerpt,
    updatedAt: localDraft.updatedAt ?? saved.updatedAt,
  };
}

function mergeDraftIntoWorkspacePost(
  post: WorkspacePoolPost,
  draft: DraftState,
): WorkspacePoolPost {
  return {
    ...post,
    type: draft.type,
    title: draft.title,
    excerpt: draft.excerpt || undefined,
    slug: slugify(draft.slug, post.slug),
    status: draft.status,
    cover: draft.cover || undefined,
    coverCaption: draft.coverCaption || undefined,
    coverHeight: draft.coverHeight ?? undefined,
    accent: draft.accent || undefined,
    gallery: draft.gallery,
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

function folderWorkspaceHref(homePath: string, folder: SidebarFolderId): string {
  return `${homePath}?folder=${encodeURIComponent(folder)}`;
}

function workspaceRootHref(homePath: string): string {
  return homePath;
}

function rootSectionFolders(pool: WorkspacePoolPayload): Folder[] {
  const roots = pool.folders
    .filter(
      (folder) =>
        !folder.parentId && ROOT_SECTION_MODES.includes(folder.mode),
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
  const sections = rootSectionFolders(pool);
  if (preferred && sections.some((folder) => folder.path === preferred)) {
    return preferred;
  }
  return sections[0]?.path ?? null;
}

function selectedPostIdForView(
  pool: WorkspacePoolPayload,
  view: LocalWorkspaceView,
  preferred?: string | null,
): string | null {
  if (view.level === "post" || view.level === "edit") return view.postId;
  if (view.level === "trash") {
    const posts = pool.trashedPosts ?? [];
    if (preferred && posts.some((post) => post.id === preferred)) return preferred;
    return posts[0]?.id ?? null;
  }
  if (view.level !== "section") return null;
  const posts = poolPostsForFolder(pool, view.folderPath);
  if (preferred && posts.some((post) => post.id === preferred)) {
    return preferred;
  }
  return posts[0]?.id ?? null;
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
    const key =
      separatorIndex === -1 ? part : part.slice(0, separatorIndex);
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

function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
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
    window.localStorage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, next ? "1" : "0");
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

// Collapse an expanded sidebar; returns whether there was one to close, so
// Escape handlers can consume the key before falling through to exit-edit.
export function closeExpandedWorkspaceSidebar(): boolean {
  if (readSidebarCollapsed(false)) return false;
  setWorkspaceSidebarCollapsedPreference(true);
  return true;
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

  return { sidebarCollapsed, setSidebarCollapsed: setCollapsed, toggleSidebarCollapsed };
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
  sidebarWidthMemory = Number.isFinite(stored) && stored > 0
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

function readAssistantState(): AssistantSidebarState {
  if (assistantStateMemory) return assistantStateMemory;
  if (typeof window === "undefined") return "hidden";
  const saved = window.localStorage.getItem(WORKSPACE_ASSISTANT_STATE_KEY);
  assistantStateMemory =
    saved === "open" || saved === "pinned" ? saved : "hidden";
  return assistantStateMemory;
}

function readAssistantWidth(): number {
  if (assistantWidthMemory !== null) return assistantWidthMemory;
  if (typeof window === "undefined") return ASSISTANT_SIDEBAR_DEFAULT_WIDTH;
  const saved = Number(window.localStorage.getItem(WORKSPACE_ASSISTANT_WIDTH_KEY));
  assistantWidthMemory = clampAssistantWidth(saved);
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

function SidebarPinIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.5 2.75h5l-.65 4.15L13 9.05v1.2H9.75v4.5L9 15.5l-.75-.75v-4.5H5v-1.2L7.15 6.9 6.5 2.75Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.75" stroke="currentColor" strokeWidth="1.55" />
      <path d="m11.6 11.6 3.1 3.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4.75 5.5h8.5l-.55 9h-7.4l-.55-9ZM3.5 5.5h11M7 3.5h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}

function SharedIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.4" cy="7.2" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.6 14c.4-2.35 1.55-3.55 3.4-3.55S10 11.65 10.4 14M10.2 11c1.95-.35 3.35.55 3.85 2.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

type SidebarDocumentSort = "recent" | "alphabetical" | "created" | "edited";

function sidebarDocumentTitle(post: WorkspacePoolPost): string {
  return post.title.trim() || "Untitled";
}

function dateKey(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function SidebarActivity({
  documents,
  onOpenDocument,
}: {
  documents: WorkspacePoolPost[];
  onOpenDocument?: (postId: string) => void;
}) {
  const now = new Date();
  const [monthStart, setMonthStart] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [sort, setSort] = useState<SidebarDocumentSort>("recent");
  const datedDocuments = useMemo(() => {
    const byDate = new Map<string, WorkspacePoolPost[]>();
    for (const post of documents) {
      const key = dateKey(post.createdAt ?? post.date);
      if (!key) continue;
      const list = byDate.get(key) ?? [];
      list.push(post);
      byDate.set(key, list);
    }
    return byDate;
  }, [documents]);
  const sorted = useMemo(() => {
    const next = [...documents];
    if (sort === "alphabetical") {
      return next.sort((a, b) =>
        sidebarDocumentTitle(a).localeCompare(sidebarDocumentTitle(b), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    }
    const field = sort === "created" ? "createdAt" : "updatedAt";
    return next.sort((a, b) =>
      (b[field] ?? b.date ?? "").localeCompare(a[field] ?? a.date ?? ""),
    );
  }, [documents, sort]);
  const calendarDays = useMemo(() => {
    const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const start = new Date(first);
    const mondayOffset = (first.getDay() + 6) % 7;
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [monthStart]);
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(monthStart);
  const todayKey = dateKey(new Date().toISOString());

  return (
    <div className="post-editor-sidebar-activity">
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
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="post-editor-calendar-grid">
          {calendarDays.map((day) => {
            const key = dateKey(day.toISOString()) ?? "";
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
                disabled={posts.length === 0}
                onClick={() => posts[0]?.id && onOpenDocument?.(posts[0].id)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </section>
      <section className="post-editor-documents" aria-label="Documents">
        <header>
          <strong>Documents</strong>
          <select
            value={sort}
            aria-label="Sort documents"
            onChange={(event) => setSort(event.currentTarget.value as SidebarDocumentSort)}
          >
            <option value="recent">Recent</option>
            <option value="alphabetical">Alphabetical</option>
            <option value="created">Date created</option>
            <option value="edited">Last edited</option>
          </select>
        </header>
        <div className="post-editor-document-list">
          {sorted.slice(0, 30).map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => onOpenDocument?.(post.id)}
              title={sidebarDocumentTitle(post)}
            >
              <span>{sidebarDocumentTitle(post)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FolderShareIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.5 6.75 9 4.25l2.5 2.5M9 4.5v6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M4.25 9.25v3.5c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1v-3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function focusSidebarRow(
  nav: HTMLElement,
  direction: "first" | "last" | "next" | "previous",
) {
  const rows = Array.from(
    nav.querySelectorAll<HTMLButtonElement>(
      ".post-editor-folder-main, .post-editor-special-main",
    ),
  );
  if (rows.length === 0) return;

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

  rows[nextIndex]?.focus();
}

function onSidebarNavKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusSidebarRow(event.currentTarget, "next");
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusSidebarRow(event.currentTarget, "previous");
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

const FOLDER_EXPANDED_KEY = "write.folders.expanded";
const FOLDER_EXPANDED_EVENT = "write:folders-expanded";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const renderNode = (node: FolderTreeNode, depth: number): ReactNode => {
    const { folder, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(folder.id);
    const selected = folder.path === activeFolder;
    const count = counts[folder.path] ?? 0;
    const canNest = folder.path.split("/").length < MAX_FOLDER_DEPTH;
    const indent = 8 + depth * 15;
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
            <span className="post-editor-folder-disclosure is-empty" aria-hidden="true" />
          )}
          <button
            type="button"
            className="post-editor-folder-main"
            aria-current={selected ? "true" : undefined}
            title={collapsed ? folder.name : undefined}
            onFocus={() => prefetchFolder(folder.path)}
            onMouseEnter={() => prefetchFolder(folder.path)}
            onClick={() => onSelectFolder(folder.path)}
          >
            <span className="post-editor-folder-icon" aria-hidden="true">
              <SidebarFolderIcon mode={folder.mode} />
            </span>
            <span className="post-editor-folder-name">{folder.name}</span>
          </button>
          {canManageFolders && canNest && (
            <button
              type="button"
              className="post-editor-folder-add"
              aria-label={`New folder in ${folder.name}`}
              title="New folder"
              onClick={() => {
                setCreatingUnder(folder.path);
                setNewName("");
                setError(null);
                persistExpandedFolders(
                  new Set(persistedExpanded).add(folder.id),
                );
              }}
            >
              +
            </button>
          )}
          {canManageSharing && (
            <button
              type="button"
              className="post-editor-folder-share"
              aria-label={`Share ${folder.name}`}
              title="Share"
              onClick={() => onShareFolder(folder)}
            >
              <FolderShareIcon />
            </button>
          )}
          {count > 0 && (
            <span className="post-editor-folder-count" aria-hidden="true">
              {count}
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
  homePath,
  onSelectRoot,
  onSelectFolder,
  onOpenDocument,
  onToggleCollapsed,
  previewOpen = false,
  sharedCount = 0,
  showGuestSignIn = false,
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
  homePath?: string;
  onSelectRoot?: () => void;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onOpenDocument?: (postId: string) => void;
  onToggleCollapsed: () => void;
  previewOpen?: boolean;
  sharedCount?: number;
  showGuestSignIn?: boolean;
  trashCount?: number;
}) {
  const navFolders =
    folders.length > 0 || !canManageFolders ? folders : FALLBACK_FOLDERS;
  const [sharingFolder, setSharingFolder] = useState<Folder | null>(null);
  return (
    <aside
      className={`ac-sidebar ac-chrome post-editor-sidebar${
        collapsed ? " is-collapsed" : ""
      }`}
      aria-label="Folder navigation"
    >
      <div className="post-editor-sidebar-top">
        <WorkspaceMenuMount
          blogName={blog.name}
          canManageSharing={canManageSharing}
          handle={blog.handle}
          onHome={onSelectRoot}
        />
        <ShortcutTooltip label="Search" keys="⌘K">
          <button
            type="button"
            className="post-editor-sidebar-toggle"
            aria-label="Search"
            onClick={openCommandPalette}
          >
            <SearchIcon />
          </button>
        </ShortcutTooltip>
        <button
          type="button"
          className="post-editor-sidebar-toggle"
          aria-label={collapsed ? "Pin sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <SidebarPinIcon /> : <SidebarCollapseIcon />}
        </button>
      </div>

      <nav
        className="post-editor-folder-nav"
        aria-label="Folders"
        onKeyDown={onSidebarNavKeyDown}
      >
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
          onShareFolder={setSharingFolder}
        />
        <div className="post-editor-special-folders">
          <div
            className={`post-editor-folder-row post-editor-special-row${
              activeFolder === SHARED_FOLDER_PATH ? " is-active" : ""
            }`}
          >
            <button
              type="button"
              className="post-editor-folder-main post-editor-special-main"
              aria-current={activeFolder === SHARED_FOLDER_PATH ? "true" : undefined}
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
              aria-current={activeFolder === TRASH_FOLDER_PATH ? "true" : undefined}
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
      </nav>

      {(!collapsed || previewOpen) && (
        <SidebarActivity
          documents={documents}
          onOpenDocument={onOpenDocument}
        />
      )}

      {showGuestSignIn && (
        <div className="post-editor-sidebar-footer">
          <p className="post-editor-guest-note">
            Demo workspace, saved in this browser.
          </p>
          <a className="post-editor-guest-keep ac-btn ac-btn-gray" href="/start?to=home">
            Sign in to keep it
          </a>
        </div>
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
  homePath,
  onSelectFolder,
  onOpenDocument,
  onSelectRoot,
  prefetchFolders = true,
  onToggleCollapsed,
  escapeToCollapse = true,
  showGuestSignIn = false,
  sharedCount = 0,
  trashCount = 0,
}: {
  activeFolder: SidebarFolderId | null;
  blog: Blog;
  collapsed: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  counts: Record<string, number>;
  documents?: WorkspacePoolPost[];
  folders: Folder[];
  homePath?: string;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onOpenDocument?: (postId: string) => void;
  onSelectRoot?: () => void;
  prefetchFolders?: boolean;
  onToggleCollapsed: () => void;
  // Only the collapsed hover preview is an Escape overlay. The persistent
  // sidebar is workspace chrome, so Escape remains available for navigation.
  escapeToCollapse?: boolean;
  showGuestSignIn?: boolean;
  sharedCount?: number;
  trashCount?: number;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { width: sidebarWidth, setWidth: setSidebarWidth } =
    useWorkspaceSidebarWidth();
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--workspace-sidebar-width",
      `${sidebarWidth}px`,
    );
  }, [sidebarWidth]);
  const showPreview = useCallback(() => {
    if (
      collapsed &&
      !window.matchMedia("(max-width: 680px)").matches
    ) {
      setPreviewOpen(true);
    }
  }, [collapsed]);
  const hidePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);
  const selectFolder = useCallback(
    (folder: SidebarFolderId) => {
      setPreviewOpen(false);
      setMobileOpen(false);
      onSelectFolder(folder);
    },
    [onSelectFolder],
  );
  const selectRoot = useCallback(() => {
    setPreviewOpen(false);
    setMobileOpen(false);
    onSelectRoot?.();
  }, [onSelectRoot]);
  const closeSidebar = useCallback(() => {
    setPreviewOpen(false);
    setMobileOpen(false);
  }, []);
  const openSidebar = useCallback(() => {
    setPreviewOpen(false);
    if (window.matchMedia("(max-width: 680px)").matches) {
      setMobileOpen(true);
      return;
    }
    if (collapsed) onToggleCollapsed();
  }, [collapsed, onToggleCollapsed]);
  const toggleSidebar = useCallback(() => {
    setPreviewOpen(false);
    if (window.matchMedia("(max-width: 680px)").matches) {
      setMobileOpen(false);
      return;
    }
    onToggleCollapsed();
  }, [onToggleCollapsed]);

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

  useEscapeLayer(
    escapeToCollapse && (previewOpen || mobileOpen),
    "Sidebar preview",
    closeSidebar,
  );

  return (
    <>
      <div
        className={`post-workspace-sidebar-region${
          collapsed ? " is-collapsed" : ""
        }${previewOpen ? " is-preview-open" : ""}${
          mobileOpen ? " is-mobile-open" : ""
        }`}
        style={
          {
            "--workspace-sidebar-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
      >
        <button
          type="button"
          className="post-sidebar-reveal-button"
          aria-label="Show sidebar"
          aria-expanded={previewOpen || mobileOpen || !collapsed}
          onClick={openSidebar}
        >
          <SidebarRevealIcon />
        </button>
        <PostFolderSidebar
          blog={blog}
          activeFolder={activeFolder}
          collapsed={collapsed && !mobileOpen}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          counts={counts}
          documents={documents}
          folders={folders}
          homePath={homePath}
          onSelectFolder={selectFolder}
          onOpenDocument={onOpenDocument}
          onSelectRoot={selectRoot}
          prefetchFolders={prefetchFolders}
          previewOpen={previewOpen || mobileOpen}
          onToggleCollapsed={toggleSidebar}
          sharedCount={sharedCount}
          showGuestSignIn={showGuestSignIn}
          trashCount={trashCount}
        />
        {(!collapsed || previewOpen) && (
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
      <button
        type="button"
        className={`post-sidebar-backdrop${
          mobileOpen ? " is-open" : ""
        }`}
        aria-label="Hide sidebar"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={closeSidebar}
      />
    </>
  );
}

type LocalWorkspaceView =
  | { level: "root" }
  | { folderPath: string; level: "section" }
  | { folderPath: typeof TRASH_FOLDER_PATH; level: "trash" }
  | { folderPath: typeof SHARED_FOLDER_PATH; level: "shared" }
  | { folderPath: string; level: "post"; postId: string }
  | { folderPath: string; level: "edit"; postId: string };

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
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  if (!matchingHome) return { level: "root" };

  if (pathname === matchingHome) {
    const folderPath = url.searchParams.get("folder");
    if (folderPath === TRASH_FOLDER_PATH) {
      return { level: "trash", folderPath: TRASH_FOLDER_PATH };
    }
    if (folderPath === SHARED_FOLDER_PATH) {
      return { level: "shared", folderPath: SHARED_FOLDER_PATH };
    }
    if (folderPath && pool.folders.some((folder) => folder.path === folderPath)) {
      return { level: "section", folderPath };
    }
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
      ? findPoolPostById(pool, editId) ?? findPoolPostBySlug(pool, slug)
      : findPoolPostBySlug(pool, slug);
  if (!post) return { level: "root" };
  return {
    level: editRequested ? "edit" : "post",
    postId: post.id,
    folderPath: folderPathForPoolPost(pool, post),
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
  if (view.level === "root") return 0;
  if (view.level === "section" || view.level === "trash" || view.level === "shared") {
    return 1;
  }
  return 2;
}

function localViewActiveFolder(view: LocalWorkspaceView): SidebarFolderId | null {
  return view.level === "root" ? null : view.folderPath;
}

function isOptimisticPostId(postId: string): boolean {
  return postId.startsWith("optimistic-");
}

function workspaceActionErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function autoGrowTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
}

function WorkspaceRootLanding({
  counts,
  folders,
  onOpenSection,
  onSelectSection,
  selectedSectionPath,
}: {
  counts: Record<string, number>;
  folders: Folder[];
  onOpenSection: (folderPath: string) => void;
  onSelectSection: (folderPath: string) => void;
  selectedSectionPath: string | null;
}) {
  const activeId = selectedSectionPath
    ? `workspace-root-section-${domSafeId(selectedSectionPath)}`
    : undefined;

  return (
    <main className="workspace-root-page" aria-labelledby="workspace-root-title">
      <div className="workspace-root-inner">
        <h1 id="workspace-root-title">Folders</h1>
        <div
          className="workspace-root-sections"
          role="listbox"
          aria-label="Workspace sections"
          aria-activedescendant={activeId}
        >
          {folders.map((folder) => {
            const selected = folder.path === selectedSectionPath;
            const count = counts[folder.path] ?? 0;
            return (
              <button
                key={folder.id}
                id={`workspace-root-section-${domSafeId(folder.path)}`}
                type="button"
                className={`workspace-root-section${
                  selected ? " is-command-selected" : ""
                }`}
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-workspace-section-path={folder.path}
                onFocus={() => onSelectSection(folder.path)}
                onMouseEnter={() => onSelectSection(folder.path)}
                onClick={() => onOpenSection(folder.path)}
              >
                <span className="workspace-root-section-icon" aria-hidden="true">
                  <SidebarFolderIcon mode={folder.mode} />
                </span>
                <span className="workspace-root-section-copy">
                  <span className="workspace-root-section-name">
                    {folder.name}
                  </span>
                  <span className="workspace-root-section-meta">
                    {count === 1 ? "1 item" : `${count} items`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
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
  const [deleteTarget, setDeleteTarget] = useState<TrashDeleteTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trashedFolders = pool.trashedFolders ?? [];
  const trashedPosts = pool.trashedPosts ?? [];
  const trashedFolderIds = new Set(trashedFolders.map((folder) => folder.id));
  const rootTrashedFolders = trashedFolders.filter(
    (folder) => !folder.parentId || !trashedFolderIds.has(folder.parentId),
  );

  const restoreItem = useCallback(
    (postId: string) => {
      if (busyId) return;
      setBusyId(postId);
      setError(null);
      restorePostFromTrash(postId);
      void restoreEditablePostAction(handle, postId)
        .catch((restoreError) => {
          movePostToTrash(postId);
          setError(workspaceActionErrorMessage(restoreError, "Could not restore item"));
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
      void restoreFolderAction(handle, folderId)
        .catch((restoreError) => {
          moveFolderToTrash(folderId);
          setError(workspaceActionErrorMessage(restoreError, "Could not restore folder"));
        })
        .finally(() => setBusyId(null));
    },
    [busyId, handle],
  );

  const permanentlyDelete = useCallback(() => {
    if (!deleteTarget || busyId) return;
    const target = deleteTarget;
    setBusyId(target.id);
    setError(null);
    if (target.kind === "post") removeTrashedPost(target.id);
    else removeTrashedFolder(target.id);
    const request =
      target.kind === "post"
        ? permanentlyDeleteEditablePostAction(handle, target.id)
        : permanentlyDeleteFolderAction(handle, target.id);
    void request
      .then(() => setDeleteTarget(null))
      .catch((deleteError) => {
        setError(workspaceActionErrorMessage(deleteError, "Could not delete permanently"));
        void refreshWorkspacePool(handle, pool.blogId);
      })
      .finally(() => setBusyId(null));
  }, [busyId, deleteTarget, handle, pool.blogId]);

  return (
    <main className="workspace-collection-page workspace-trash-page">
      <header className="workspace-collection-header">
        <h1>Trash</h1>
      </header>
      {error && <p className="post-folder-error" role="alert">{error}</p>}
      {rootTrashedFolders.length === 0 && trashedPosts.length === 0 ? (
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
                    setDeleteTarget({ kind: "folder", id: folder.id, label: folder.name })
                  }
                >
                  Delete permanently
                </button>
              </div>
            </article>
          ))}
          {trashedPosts.map((post) => {
            const selected = post.id === selectedPostId;
            return (
              <article
                key={post.id}
                className={`workspace-trash-row${selected ? " is-command-selected" : ""}`}
                data-workspace-post-id={post.id}
                tabIndex={selected ? 0 : -1}
                onFocus={() => onSelectPost(post.id)}
                onMouseEnter={() => onSelectPost(post.id)}
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
        confirming={Boolean(deleteTarget && busyId === deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={permanentlyDelete}
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
        <p className="workspace-collection-empty">Nothing has been shared with you yet.</p>
      )}
    </main>
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
            background:
              "color-mix(in srgb, var(--muted) 18%, transparent)",
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
}: {
  allowedRemoteImages?: Set<string>;
  body: string;
  hideRemoteImages?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
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

function BookmarkViewBody({
  mode,
  post,
}: {
  mode: Exclude<BookmarkContentMode, "readable">;
  post: Post;
}) {
  const title = post.title.trim() || post.capture?.title?.trim() || "Bookmark";
  const screenshotUrl = safeBookmarkViewUrl(post.capture?.screenshotUrl);
  const screenshotTiles = (post.capture?.screenshotTiles ?? [])
    .map((tile) => ({ ...tile, url: safeBookmarkViewUrl(tile.url) }))
    .filter((tile) => tile.url)
    .sort((a, b) => a.index - b.index);
  const originalUrl =
    safeBookmarkViewUrl(post.capture?.url) ||
    safeBookmarkViewUrl(post.links?.[0]?.href);

  if (mode === "capture" && (screenshotTiles.length > 0 || screenshotUrl)) {
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

  const url = originalUrl;
  if (!url) {
    return <ErrorBody message="This bookmark view is not available yet." />;
  }

  return (
    <section className={`bookmark-reader-view is-${mode}`}>
      <iframe
        className="bookmark-reader-frame"
        src={url}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
      />
    </section>
  );
}

function WorkspacePostReader({
  blog,
  canManagePost,
  homePath,
  onNavigate,
  pool,
  poolPost,
}: {
  blog: Blog;
  canManagePost: boolean;
  homePath: string;
  onNavigate: (path: string) => Promise<void> | void;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
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

  useEffect(() => {
    if (entry.status === "idle" || stale) load(stale);
  }, [entry.status, load, stale]);

  const body =
    entry.status === "ready" ? entry.body.body : "";
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
  const bodySlot =
    post.type === "bookmark" && bookmarkContentMode !== "readable" ? (
      <BookmarkViewBody mode={bookmarkContentMode} post={post} />
    ) : entry.status === "ready" ? (
      <MarkdownBody
        allowedRemoteImages={new Set(bodyImageReplacements.values())}
        body={bodyMarkdown}
        hideRemoteImages={false}
      />
    ) : entry.status === "error" ? (
      <ErrorBody message={entry.error} />
    ) : (
      <LoadingBody />
    );
  const slots = { body: bodySlot };
  const ReaderComponent =
    post.type === "talk"
      ? TalkReader
      : post.type === "project"
        ? ProjectReader
        : Reader;
  const sectionPath = folderWorkspaceHref(
    homePath,
    folderPathForPoolPost(pool, poolPost),
  );

  return (
    <>
      <PostActionBar
        mode="read"
        owner
        blog={blog}
        post={post}
        adjacent={adjacentPublishedPostsForPool(pool, post.slug)}
        homePath={sectionPath}
        postPath={blogPostPath(blog, post)}
        bookmarkContentMode={bookmarkContentMode}
        canEditPost
        canManagePost={canManagePost}
        onNavigate={async (path) => {
          await onNavigate(path);
        }}
        onBookmarkContentModeChange={setBookmarkContentMode}
      />
      <ReaderComponent blog={blog} post={post} slots={slots} />
    </>
  );
}

function LocalWorkspacePostEditor({
  active,
  blog,
  canManagePost,
  homePath,
  onDeleteItem,
  onNavigate,
  pool,
  poolPost,
}: {
  active: boolean;
  blog: Blog;
  canManagePost: boolean;
  homePath: string;
  onDeleteItem?: FolderDeleteItem;
  onNavigate: (path: string) => Promise<void> | void;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
}) {
  const initialBody =
    pool.initialBodies?.find((body) => body.postId === poolPost.id) ?? null;
  const { entry, load, stale } = useWorkspacePostBody(
    pool.blogId,
    poolPost.id,
    initialBody,
  );
  useEffect(() => {
    if (entry.status === "idle" || stale) load(stale);
  }, [entry.status, load, stale]);

  const cachedBody = entry.status === "ready" ? entry.body.body : "";
  const post = useMemo(
    () => postFromPoolPost(poolPost, cachedBody),
    [cachedBody, poolPost],
  );
  const [draft, setDraft] = useState<DraftState>(() => {
    return localWorkspaceDraftSessions.get(poolPost.id) ?? initialDraft(post);
  });
  const draftRef = useRef(draft);
  const baseUpdatedAtRef = useRef(
    localWorkspaceServerRevisions.get(poolPost.id) ?? poolPost.updatedAt,
  );
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const bodyLoadedPostIdRef = useRef<string | null>(
    entry.status === "ready" && !stale ? poolPost.id : null,
  );
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const editorMountedRef = useRef(true);
  const coverRevisionRef = useRef(0);
  const initialPayloadKey = payloadKey(
    payloadFor(
      poolPost.id,
      initialDraft(post),
      post.slug,
      poolPost.updatedAt,
    ),
  );
  const lastSavedKeyRef = useRef(
    localWorkspacePendingSaveIds.has(poolPost.id)
      ? `pending:${poolPost.id}`
      : initialPayloadKey,
  );
  const latestKeyRef = useRef(initialPayloadKey);
  const [bodyToolbarHost, setBodyToolbarHost] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const usedSlugs = useMemo(
    () =>
      pool.posts
        .filter((candidate) => candidate.id !== poolPost.id)
        .map((candidate) => candidate.slug),
    [pool.posts, poolPost.id],
  );

  useEffect(() => {
    if (entry.status !== "ready") return;
    if (bodyLoadedPostIdRef.current === poolPost.id) return;
    bodyLoadedPostIdRef.current = poolPost.id;
    if (localWorkspaceDraftSessions.has(poolPost.id)) return;
    const current = draftRef.current;
    const next = { ...current, body: entry.body.body };
    draftRef.current = next;
    baseUpdatedAtRef.current =
      localWorkspaceServerRevisions.get(poolPost.id) ?? poolPost.updatedAt;
    const key = payloadKey(
      payloadFor(
        poolPost.id,
        next,
        post.slug,
        baseUpdatedAtRef.current,
      ),
    );
    latestKeyRef.current = key;
    if (!localWorkspacePendingSaveIds.has(poolPost.id)) {
      lastSavedKeyRef.current = key;
    }
    setDraft(next);
  }, [entry, poolPost.id, poolPost.updatedAt, post.slug]);

  useEffect(() => {
    if (
      localWorkspaceDraftSessions.has(poolPost.id) ||
      localWorkspacePendingSaveIds.has(poolPost.id)
    ) {
      return;
    }
    const next = initialDraft(post);
    if (entry.status !== "ready" || stale) {
      next.body = draftRef.current.body;
    } else {
      baseUpdatedAtRef.current =
        localWorkspaceServerRevisions.get(poolPost.id) ?? poolPost.updatedAt;
    }
    const nextKey = payloadKey(
      payloadFor(
        poolPost.id,
        next,
        post.slug,
        baseUpdatedAtRef.current,
      ),
    );
    const currentKey = payloadKey(
      payloadFor(
        poolPost.id,
        draftRef.current,
        post.slug,
        baseUpdatedAtRef.current,
      ),
    );
    if (nextKey === currentKey) return;
    draftRef.current = next;
    latestKeyRef.current = nextKey;
    lastSavedKeyRef.current = nextKey;
    setDraft(next);
  }, [entry.status, poolPost.id, poolPost.updatedAt, post, stale]);

  useEffect(() => {
    if (!active) return;
    window.requestAnimationFrame(() => {
      const title = titleRef.current;
      if (!title) return;
      title.focus({ preventScroll: true });
      title.setSelectionRange(title.value.length, title.value.length);
    });
  }, [active, poolPost.id]);

  useLayoutEffect(() => {
    if (active) finishEditTransition(poolPost.id);
  }, [active, poolPost.id]);

  useEffect(() => {
    autoGrowTextarea(titleRef.current);
  }, [draft.title]);

  useEffect(() => {
    autoGrowTextarea(excerptRef.current);
  }, [draft.excerpt]);

  useEffect(() => {
    editorMountedRef.current = true;
    return () => {
      editorMountedRef.current = false;
      coverRevisionRef.current += 1;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const updateDraft = useCallback(
    (patch: Partial<DraftState>) => {
      const next = { ...draftRef.current, ...patch };
      draftRef.current = next;
      latestKeyRef.current = payloadKey(
        payloadFor(
          poolPost.id,
          next,
          post.slug,
          baseUpdatedAtRef.current,
        ),
      );
      localWorkspaceDraftSessions.set(poolPost.id, next);
      markPostDirty(poolPost.id);
      bumpLocalDraftRevision(poolPost.id);
      setDraft(next);
    },
    [poolPost.id, post.slug],
  );

  const enqueueSave = useCallback(
    (
      nextDraft: DraftState,
      options: { onlyIfCurrent?: boolean; revalidate?: boolean } = {},
    ) => {
      const requestedKey = payloadKey(
        payloadFor(poolPost.id, nextDraft, post.slug),
      );
      const requestedRevision = localDraftRevision(poolPost.id);
      const queued = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            options.onlyIfCurrent &&
            (latestKeyRef.current !== requestedKey ||
              localDraftRevision(poolPost.id) !== requestedRevision)
          ) {
            return null;
          }
          if (lastSavedKeyRef.current === requestedKey) return null;

          const payload = payloadFor(
            poolPost.id,
            nextDraft,
            post.slug,
            localWorkspaceServerRevisions.get(poolPost.id) ??
              baseUpdatedAtRef.current,
          );
          const saved = await saveEditablePostAction(
            blog.handle,
            payload,
            { revalidate: options.revalidate },
          );
          // A superseded response must advance the revision used by the queued
          // draft, but it must never replace that newer local draft.
          baseUpdatedAtRef.current = saved.updatedAt;
          if (saved.updatedAt) {
            localWorkspaceServerRevisions.set(poolPost.id, saved.updatedAt);
          }
          return { requestedKey, requestedRevision, saved };
        });
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [blog.handle, poolPost.id, post.slug],
  );

  const deriveSlugFromTitle = useCallback(
    (titleValue: string) => {
      const title = titleValue.trim();
      if (!title || !isPlaceholderSlug(draft.slug)) return;
      updateDraft({
        slug: uniqueSlug(slugify(title, "post"), usedSlugs),
      });
    },
    [draft.slug, updateDraft, usedSlugs],
  );

  const saveDraftNow = useCallback(
    async (patch: Partial<DraftState> = {}) => {
      const nextDraft = { ...draftRef.current, ...patch };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      const requestedKey = payloadKey(
        payloadFor(poolPost.id, nextDraft, post.slug),
      );
      latestKeyRef.current = requestedKey;
      const hasLocalChanges = requestedKey !== lastSavedKeyRef.current;

      if (hasLocalChanges) {
        localWorkspaceDraftSessions.set(poolPost.id, nextDraft);
        markPostDirty(poolPost.id);
        bumpLocalDraftRevision(poolPost.id);
        updatePost(poolPost.id, {
          ...mergeDraftIntoWorkspacePost(poolPost, nextDraft),
          updatedAt: new Date().toISOString(),
        });
        updatePostBody(pool.blogId, poolPost.id, nextDraft.body);
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (!isOptimisticPostId(poolPost.id)) {
        let targetDraft = nextDraft;
        while (true) {
          const targetKey = payloadKey(
            payloadFor(poolPost.id, targetDraft, post.slug),
          );
          const targetRevision = localDraftRevision(poolPost.id);
          latestKeyRef.current = targetKey;
          const result = await enqueueSave(targetDraft, { revalidate: true });
          if (
            localDraftRevision(poolPost.id) !== targetRevision ||
            latestKeyRef.current !== targetKey
          ) {
            targetDraft = draftRef.current;
            continue;
          }

          localWorkspacePendingSaveIds.delete(poolPost.id);
          localWorkspaceDraftSessions.delete(poolPost.id);
          acknowledgePost(poolPost.id);
          if (result) {
            lastSavedKeyRef.current = result.requestedKey;
            applySavedWorkspacePost(result.saved, pool.blogId);
            acknowledgePostBody(
              pool.blogId,
              poolPost.id,
              result.saved.body,
              result.saved.updatedAt,
            );
          } else if (lastSavedKeyRef.current === targetKey) {
            acknowledgePostBody(
              pool.blogId,
              poolPost.id,
              targetDraft.body,
              baseUpdatedAtRef.current,
            );
          }
          break;
        }
      }

    },
    [enqueueSave, pool.blogId, poolPost, post.slug],
  );

  useEffect(() => {
    if (isOptimisticPostId(poolPost.id)) return;

    const requestedKey = payloadKey(payloadFor(
      poolPost.id,
      draft,
      post.slug,
    ));
    latestKeyRef.current = requestedKey;
    if (requestedKey === lastSavedKeyRef.current) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void enqueueSave(draft, {
        onlyIfCurrent: true,
        revalidate: false,
      })
        .then((result) => {
          if (
            !result ||
            latestKeyRef.current !== result.requestedKey ||
            localDraftRevision(poolPost.id) !== result.requestedRevision
          ) {
            return;
          }
          lastSavedKeyRef.current = result.requestedKey;
          localWorkspacePendingSaveIds.delete(poolPost.id);
          localWorkspaceDraftSessions.delete(poolPost.id);
          applySavedWorkspacePost(result.saved, pool.blogId);
          acknowledgePost(poolPost.id);
          acknowledgePostBody(
            pool.blogId,
            poolPost.id,
            result.saved.body,
            result.saved.updatedAt,
          );
        })
        .catch(() => {
          // Keep the local draft in place. A later edit will retry the save.
        });
    }, 800);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [draft, enqueueSave, pool.blogId, poolPost.id, post.slug]);

  useEffect(() => {
    if (!active) return;
    const stop = () => {
      void saveDraftNow();
    };
    window.addEventListener(STOP_LOCAL_EDITING_EVENT, stop);
    return () => window.removeEventListener(STOP_LOCAL_EDITING_EVENT, stop);
  }, [active, saveDraftNow]);

  const displayPost = useMemo(
    () =>
      postFromPoolPost(
        mergeDraftIntoWorkspacePost(poolPost, draft),
        draft.body,
      ),
    [draft, poolPost],
  );
  const resolvedHeaderCover = resolveCover(displayPost);
  const hasArticleHeaderImage =
    displayPost.type === "article" &&
    !isNoCoverValue(draft.cover) &&
    Boolean(resolvedHeaderCover);
  const selectCover = useCallback(
    (cover: string) => {
      coverRevisionRef.current += 1;
      setCoverUploadError(null);
      updateDraft({ cover, coverCaption: "" });
    },
    [updateDraft],
  );
  const shuffleCover = useCallback(() => {
    const cover = randomCover(
      COVER_PILE,
      isNoCoverValue(draftRef.current.cover) ? "" : draftRef.current.cover,
    );
    if (cover) selectCover(cover);
  }, [selectCover]);
  const uploadCover = useCallback(
    async (file: File) => {
      const uploadRevision = coverRevisionRef.current + 1;
      coverRevisionRef.current = uploadRevision;
      setCoverUploading(true);
      setCoverUploadError(null);
      try {
        const cover = await uploadMedia(file, {
          endpoint: mediaUploadEndpointForHandle(blog.handle),
        });
        if (
          editorMountedRef.current &&
          coverRevisionRef.current === uploadRevision
        ) {
          selectCover(cover);
        }
      } catch (error) {
        setCoverUploadError(
          error instanceof MediaUploadError
            ? error.message
            : "Header image could not be uploaded.",
        );
      } finally {
        if (editorMountedRef.current) setCoverUploading(false);
      }
    },
    [blog.handle, selectCover],
  );
  const removeCover = useCallback(() => {
    coverRevisionRef.current += 1;
    setCoverUploadError(null);
    updateDraft({ cover: NO_COVER_VALUE, coverCaption: "" });
  }, [updateDraft]);

  const containingFolderPath = folderPathForPoolPost(pool, poolPost);
  const containingFolderHref = folderWorkspaceHref(homePath, containingFolderPath);
  const renderedPostPath = blogPostPath(blog, {
    slug: slugify(draft.slug, post.slug),
  });
  const focusBody = useCallback(() => {
    document
      .querySelector<HTMLElement>(
        ".local-workspace-edit .body-editor-content",
      )
      ?.focus({ preventScroll: true });
  }, []);
  const deletePost = useCallback(() => {
    if (!onDeleteItem || deleting) return;
    setDeleting(true);
    void Promise.resolve(onDeleteItem(displayPost))
      .catch((error) => {
        console.warn("workspace post delete failed", error);
      })
      .finally(() => setDeleting(false));
  }, [deleting, displayPost, onDeleteItem]);

  return (
    <>
      <PostActionBar
        mode="edit"
        owner={canManagePost}
        canEditPost
        canManagePost={canManagePost}
        blog={blog}
        post={displayPost}
        adjacent={adjacentPublishedPostsForPool(pool, displayPost.slug)}
        homePath={containingFolderHref}
        postPath={renderedPostPath}
        draft={draft}
        deleting={deleting}
        hasHeaderImage={hasArticleHeaderImage}
        folders={pool.folders}
        onDelete={deletePost}
        onDone={async () => {
          await onNavigate(renderedPostPath);
        }}
        onAddHeaderImage={shuffleCover}
        onNavigate={async (path) => {
          await onNavigate(path);
        }}
        onSlugBlur={() => {
          updateDraft({ slug: slugify(draft.slug, post.slug) });
        }}
        onSlugInput={(value) => updateDraft({ slug: slugify(value, "") })}
        onUpdateDraft={updateDraft}
        onVisibilityChange={(status) => saveDraftNow({ status })}
      />
      <main className="local-workspace-edit" aria-label="Edit post">
        <EditReaderPreview
          blog={blog}
          post={displayPost}
          slots={{
            ...(displayPost.type === "article"
              ? {
                  cover: hasArticleHeaderImage ? (
                    <WorkspaceEditableCover
                      title={displayPost.title.trim() || "Untitled"}
                      cover={resolvedHeaderCover}
                      covers={COVER_PILE}
                      coverHeight={draft.coverHeight}
                      mediaEnabled
                      uploading={coverUploading}
                      error={coverUploadError}
                      onSelectCover={selectCover}
                      onCoverHeightChange={(coverHeight) =>
                        updateDraft({ coverHeight })
                      }
                      onUploadFile={uploadCover}
                      onRemoveCover={removeCover}
                    />
                  ) : null,
                }
              : {}),
            title: (
              <textarea
                ref={titleRef}
                className="reader-title edit-title-field"
                aria-label="Title"
                placeholder="Give it a title"
                rows={1}
                value={draft.title}
                onChange={(event) =>
                  updateDraft({
                    title: event.currentTarget.value.replace(/[\r\n]+/g, " "),
                  })
                }
                onBlur={(event) => deriveSlugFromTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return;
                  if (
                    event.key === "Enter" ||
                    event.key === "ArrowDown" ||
                    (event.key === "Tab" && !event.shiftKey)
                  ) {
                    event.preventDefault();
                    deriveSlugFromTitle(event.currentTarget.value);
                    excerptRef.current?.focus({ preventScroll: true });
                  }
                }}
              />
            ),
            excerpt: (
              <textarea
                ref={excerptRef}
                className="reader-dek edit-excerpt-field"
                aria-label="Excerpt"
                placeholder="Add a short description"
                rows={1}
                value={draft.excerpt}
                onChange={(event) =>
                  updateDraft({ excerpt: event.currentTarget.value })
                }
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return;
                  const target = event.currentTarget;
                  const atStart =
                    target.selectionStart === 0 && target.selectionEnd === 0;
                  const atEnd =
                    target.selectionStart === target.value.length &&
                    target.selectionEnd === target.value.length;
                  if (
                    (event.key === "ArrowUp" && atStart) ||
                    (event.key === "Tab" && event.shiftKey)
                  ) {
                    event.preventDefault();
                    titleRef.current?.focus({ preventScroll: true });
                    return;
                  }
                  if (
                    event.key === "Enter" ||
                    (event.key === "ArrowDown" && atEnd) ||
                    (event.key === "Tab" && !event.shiftKey)
                  ) {
                    event.preventDefault();
                    focusBody();
                  }
                }}
              />
            ),
            body: (
              <div>
                <div
                  ref={setBodyToolbarHost}
                  className="body-editor-toolbar-anchor"
                />
                <LocalWorkspaceBodyEditor
                  value={draft.body}
                  onChange={(body) => updateDraft({ body })}
                  onNavigateField={(direction) => {
                    if (direction === "next") {
                      dateRef.current?.focus({ preventScroll: true });
                    } else {
                      excerptRef.current?.focus({ preventScroll: true });
                      const excerpt = excerptRef.current;
                      if (excerpt) {
                        excerpt.setSelectionRange(
                          excerpt.value.length,
                          excerpt.value.length,
                        );
                      }
                    }
                  }}
                  mediaEnabled
                  postType={displayPost.type}
                  toolbarHost={bodyToolbarHost}
                  uploadEndpoint={mediaUploadEndpointForHandle(blog.handle)}
                />
              </div>
            ),
            byline: (
              <PostByline
                blog={blog}
                post={displayPost}
                dateControl={
                  <label className="post-edit-date-control">
                    <span className="sr-only">Post date</span>
                    <input
                      ref={dateRef}
                      type="date"
                      value={draft.date.slice(0, 10)}
                      onChange={(event) =>
                        updateDraft({ date: event.currentTarget.value })
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowUp" ||
                          (event.key === "Tab" && event.shiftKey)
                        ) {
                          event.preventDefault();
                          focusBody();
                        }
                      }}
                    />
                  </label>
                }
              />
            ),
          }}
        />
      </main>
    </>
  );
}

function LocalWorkspaceContent({
  blog,
  canCreateItems,
  canEditItems,
  canManagePost,
  createBookmarkRequestKey,
  editFolderRequestKey,
  handle,
  homePath,
  onNavigate,
  onCaptureResolved,
  onCreateItem,
  onDeleteItem,
  onDeleteFolder,
  onOpenSection,
  onOpenPost,
  onSelectPost,
  onSelectSection,
  pool,
  selectedSectionPath,
  selectedPostId,
  view,
}: {
  blog: Blog;
  canCreateItems: boolean;
  canEditItems: boolean;
  canManagePost: boolean;
  createBookmarkRequestKey: number;
  editFolderRequestKey: number;
  handle: string;
  homePath: string;
  onNavigate: (path: string) => Promise<void> | void;
  onCaptureResolved?: FolderCaptureResolved;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onDeleteFolder?: (folder: Folder) => Promise<void> | void;
  onOpenSection: (folderPath: string) => void;
  onOpenPost: (post: Post) => void;
  onSelectPost: (postId: string) => void;
  onSelectSection: (folderPath: string) => void;
  pool: WorkspacePoolPayload;
  selectedSectionPath: string | null;
  selectedPostId: string | null;
  view: LocalWorkspaceView;
}) {
  let page: ReactNode;
  let activePost: WorkspacePoolPost | null = null;

  if (view.level === "root") {
    page = (
      <WorkspaceRootLanding
        counts={pool.counts}
        folders={rootSectionFolders(pool)}
        selectedSectionPath={selectedSectionPath}
        onSelectSection={onSelectSection}
        onOpenSection={onOpenSection}
      />
    );
  } else if (view.level === "trash") {
    page = (
      <TrashPage
        handle={handle}
        pool={pool}
        selectedPostId={selectedPostId}
        onSelectPost={onSelectPost}
      />
    );
  } else if (view.level === "shared") {
    page = <SharedPage pool={pool} />;
  } else if (view.level === "section") {
    const folder = pool.folders.find((entry) => entry.path === view.folderPath);
    if (!folder) {
      page = (
        <WorkspaceRootLanding
          counts={pool.counts}
          folders={rootSectionFolders(pool)}
          selectedSectionPath={selectedSectionPath}
          onSelectSection={onSelectSection}
          onOpenSection={onOpenSection}
        />
      );
    } else {
      const items = poolPostsForFolder(pool, folder.path).map((post) =>
        postFromPoolPost(post),
      );
      activePost = selectedPostId
        ? findPoolPostById(pool, selectedPostId)
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
          createBookmarkRequestKey={createBookmarkRequestKey}
          editRequestKey={editFolderRequestKey}
          onSelectPost={onSelectPost}
          selectedPostId={selectedPostId}
        />
      );
    }
  } else {
    const post = findPoolPostById(pool, view.postId);
    activePost = post;
    page = post ? (
      <WorkspacePostReader
        blog={blog}
        canManagePost={canManagePost}
        homePath={homePath}
        onNavigate={onNavigate}
        pool={pool}
        poolPost={post}
      />
    ) : (
      <WorkspaceRootLanding
        counts={pool.counts}
        folders={rootSectionFolders(pool)}
        selectedSectionPath={selectedSectionPath}
        onSelectSection={onSelectSection}
        onOpenSection={onOpenSection}
      />
    );
  }

  const editorVisible = view.level === "edit" && Boolean(activePost);
  const shouldWarmEditor = Boolean(activePost) && canEditItems;

  return (
    <>
      <div className="local-workspace-surface" hidden={editorVisible}>
        {page}
      </div>
      {shouldWarmEditor && activePost && (
        <div className="local-workspace-surface" hidden={!editorVisible}>
      <LocalWorkspacePostEditor
            key={activePost.id}
            active={editorVisible}
            blog={blog}
            canManagePost={canManagePost}
            homePath={homePath}
            onDeleteItem={onDeleteItem}
            onNavigate={onNavigate}
            pool={pool}
            poolPost={activePost}
          />
        </div>
      )}
    </>
  );
}

function LocalWorkspaceShell({
  blog,
  canManageFolders,
  canManageSharing,
  className,
  homePath,
  initialPool,
  initialSidebarCollapsed,
  initialView,
  showGuestSignIn,
}: {
  blog: Blog;
  canManageFolders: boolean;
  canManageSharing: boolean;
  children: ReactNode;
  className: string;
  homePath: string;
  initialPool: WorkspacePoolPayload;
  initialSidebarCollapsed: boolean;
  initialView: LocalWorkspaceView;
  showGuestSignIn: boolean;
}) {
  const { pool } = useWorkspacePool();
  const [view, setView] = useState<LocalWorkspaceView>(initialView);
  const sourcePool = pool?.blogId === initialPool.blogId ? pool : initialPool;
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
  const displayPoolRef = useRef(displayPool);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const cancelledOptimisticPostIdsRef = useRef(new Set<string>());
  const gTapRef = useRef(0);
  const mounted = typeof window !== "undefined";
  const viewRef = useRef(view);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    selectedPostIdForView(initialPool, initialView),
  );
  const [selectedSectionPath, setSelectedSectionPath] = useState<string | null>(
    initialView.level === "root"
      ? validRootSectionPath(initialPool, null)
      : null,
  );
  const selectedSectionPathRef = useRef(selectedSectionPath);
  const [createBookmarkRequestKey, setCreateBookmarkRequestKey] = useState(0);
  const [editFolderRequestKey, setEditFolderRequestKey] = useState(0);
  const [pendingDeletePostId, setPendingDeletePostId] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const { state: assistantState, width: assistantWidth } =
    useWorkspaceAssistantPreferences();
  const [assistantComposer, setAssistantComposer] = useState("");
  const [assistantAttachments, setAssistantAttachments] = useState<
    AssistantAttachment[]
  >([]);
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  const changeAssistantState = useCallback(
    (next: AssistantSidebarState) => setWorkspaceAssistantState(next),
    [],
  );
  const changeAssistantWidth = useCallback(
    (next: number) => setWorkspaceAssistantWidth(next),
    [],
  );
  // Layer 1 of the provider ladder: the on-device model through the Mac
  // app's bridge, with agent tools executing against this pool.
  const assistant = useNativeAssistant({
    handle: displayPool.blog.handle,
    getPool: () => displayPoolRef.current,
    getView: () => {
      const current = viewRef.current;
      if (current.level === "root") return { level: "root" };
      if (current.level === "post" || current.level === "edit") {
        return {
          level: current.level,
          folderPath: current.folderPath,
          postId: current.postId,
        };
      }
      return { level: "section", folderPath: current.folderPath };
    },
  });

  useEffect(() => {
    displayPoolRef.current = displayPool;
  }, [displayPool]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

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
      if ("selectedSectionPath" in options) {
        setSelectedSectionPath(
          validRootSectionPath(
            displayPoolRef.current,
            options.selectedSectionPath ?? null,
          ),
        );
      } else if (nextView.level === "root") {
        setSelectedSectionPath(
          validRootSectionPath(
            displayPoolRef.current,
            selectedSectionPathRef.current,
          ),
        );
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
    [],
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
      window.history.replaceState(null, "", href);
      viewRef.current = nextView;
      setView(nextView);
      const nextSelectedPostId =
        "selectedPostId" in options
          ? (options.selectedPostId ?? null)
          : selectedPostIdForView(displayPoolRef.current, nextView);
      setSelectedPostId(nextSelectedPostId);
      if ("selectedSectionPath" in options) {
        setSelectedSectionPath(
          validRootSectionPath(
            displayPoolRef.current,
            options.selectedSectionPath ?? null,
          ),
        );
      } else if (nextView.level === "root") {
        setSelectedSectionPath(
          validRootSectionPath(
            displayPoolRef.current,
            selectedSectionPathRef.current,
          ),
        );
      }
    },
    [],
  );

  const navigateRoot = useCallback(
    (nextSelectedSectionPath?: string | null) => {
      navigateToView(
        { level: "root" },
        workspaceRootHref(homePath),
        {
          selectedSectionPath:
            nextSelectedSectionPath ?? selectedSectionPathRef.current,
        },
      );
    },
    [homePath, navigateToView],
  );

  const navigateSection = useCallback(
    (folderPath: SidebarFolderId, nextSelectedPostId?: string | null) => {
      const nextView: LocalWorkspaceView =
        folderPath === TRASH_FOLDER_PATH
          ? { level: "trash", folderPath: TRASH_FOLDER_PATH }
          : folderPath === SHARED_FOLDER_PATH
            ? { level: "shared", folderPath: SHARED_FOLDER_PATH }
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
      const nextFolderPath =
        folderPath ?? folderPathForPoolPost(displayPool, post);
      const optimisticEdit = mode === "edit" && isOptimisticPostId(post.id);
      if (mode === "edit") beginEditTransition(post.id);
      navigateToView(
        {
          level: mode === "edit" ? "edit" : "post",
          postId: post.id,
          folderPath: nextFolderPath,
        },
        optimisticEdit
          ? folderWorkspaceHref(homePath, nextFolderPath)
          : mode === "edit"
            ? blogPostEditPath(displayPool.blog, post)
          : blogPostPath(displayPool.blog, post),
      );
    },
    [displayPool, homePath, navigateToView],
  );

  const openCreatedPost = useCallback(
    (post: WorkspacePoolPost) => {
      openPoolPost(post, folderPathForPoolPost(displayPoolRef.current, post), "edit");
    },
    [openPoolPost],
  );

  const reconcileCreatedPost = useCallback(
    (temporaryPostId: string, savedPost: WorkspacePoolPost) => {
      const current = viewRef.current;
      if (
        (current.level !== "edit" && current.level !== "post") ||
        current.postId !== temporaryPostId
      ) {
        return;
      }
      const nextView: LocalWorkspaceView = {
        level: current.level,
        postId: savedPost.id,
        folderPath: folderPathForPoolPost(displayPoolRef.current, savedPost),
      };
      replaceWithView(
        nextView,
        current.level === "edit"
          ? blogPostEditPath(displayPoolRef.current.blog, savedPost)
          : blogPostPath(displayPoolRef.current.blog, savedPost),
        { selectedPostId: savedPost.id },
      );
    },
    [replaceWithView],
  );

  const createWorkspaceItem = useCallback<FolderCreateItem>(
    (request) => {
      if (!canManageFolders) return;
      const pool = displayPoolRef.current;
      const temp = optimisticWorkspacePost(pool, request);
      addPost(temp);

      if (request.type === "bookmark") {
        if (
          viewRef.current.level !== "section" ||
          viewRef.current.folderPath !== request.folderPath
        ) {
          navigateSection(request.folderPath, temp.id);
        } else {
          setSelectedPostId(temp.id);
        }
      } else {
        openPoolPost(temp, request.folderPath, "edit");
      }

      void (async () => {
        let attempt = 0;
        while (getWorkspacePost(temp.id)) {
          try {
          const saved =
            request.type === "bookmark"
              ? await createFolderItemAction(pool.blog.handle, "bookmarks", {
                  url: request.url,
                  description: request.description,
                  title: request.title,
                })
              : request.type === "note"
                ? await createFolderItemAction(pool.blog.handle, "notes", {
                    title: request.title,
                  })
                : await createWorkspacePostAction(
                    pool.blog.handle,
                    "article",
                    request.folderPath,
                  );
          const poolPost = narrowPostFromPost(saved, pool.blogId);
          if (!poolPost) {
            throw new Error("Created item did not include an id");
          }
          if (cancelledOptimisticPostIdsRef.current.has(temp.id)) {
            cancelledOptimisticPostIdsRef.current.delete(temp.id);
            void deleteEditablePostAction(pool.blog.handle, poolPost.id).catch(
              (error) => console.warn("cancelled item cleanup failed", error),
            );
            return;
          }
          if (poolPost.updatedAt) {
            localWorkspaceServerRevisions.set(poolPost.id, poolPost.updatedAt);
          }
          const reconciled = mergeSavedWorkspacePost(
            poolPost,
            getWorkspacePost(temp.id),
          );
          const liveDraft = localWorkspaceDraftSessions.get(temp.id);
          const merged = liveDraft
            ? mergeDraftIntoWorkspacePost(reconciled, liveDraft)
            : reconciled;
          if (liveDraft) {
            localWorkspacePendingSaveIds.add(merged.id);
            localWorkspaceDraftSessions.set(merged.id, liveDraft);
            localWorkspaceDraftSessions.delete(temp.id);
            transferLocalDraftRevision(temp.id, merged.id);
            updatePostBody(pool.blogId, merged.id, liveDraft.body);
          }
          replacePost(temp.id, merged);
          if (request.type === "bookmark") {
            setSelectedPostId((current) =>
              current === temp.id ? merged.id : current,
            );
          } else {
            reconcileCreatedPost(temp.id, merged);
          }
          if (liveDraft) {
            const transferredRevision = localDraftRevision(merged.id);
            const transferredPayload = payloadFor(
              merged.id,
              liveDraft,
              merged.slug,
              merged.updatedAt,
            );
            const transferredKey = payloadKey(transferredPayload);
            void saveEditablePostAction(pool.blog.handle, transferredPayload, {
              revalidate: false,
            })
              .then((savedDraft) => {
                if (savedDraft.updatedAt) {
                  localWorkspaceServerRevisions.set(
                    merged.id,
                    savedDraft.updatedAt,
                  );
                }
                if (!localWorkspacePendingSaveIds.has(merged.id)) return;
                if (localDraftRevision(merged.id) !== transferredRevision) return;
                const currentDraft = localWorkspaceDraftSessions.get(merged.id);
                if (
                  currentDraft &&
                  payloadKey(
                    payloadFor(merged.id, currentDraft, merged.slug),
                  ) !== transferredKey
                ) {
                  return;
                }
                localWorkspacePendingSaveIds.delete(merged.id);
                localWorkspaceDraftSessions.delete(merged.id);
                applySavedWorkspacePost(savedDraft, pool.blogId);
                acknowledgePost(merged.id);
                acknowledgePostBody(
                  pool.blogId,
                  merged.id,
                  savedDraft.body,
                  savedDraft.updatedAt,
                );
              })
              .catch(() => {
                // The remounted editor retains the draft and retries autosave.
              });
          }
          return;
          } catch (error) {
            if (
              cancelledOptimisticPostIdsRef.current.has(temp.id) ||
              !getWorkspacePost(temp.id)
            ) {
              return;
            }
            attempt += 1;
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
    },
    [canManageFolders, navigateSection, openPoolPost, reconcileCreatedPost],
  );

  const deleteWorkspaceItem = useCallback<FolderDeleteItem>(
    async (post) => {
      if (!canManageFolders || !post.id) {
        throw new Error("You cannot edit this blog");
      }
      const pool = displayPoolRef.current;
      const poolPost = findPoolPostById(pool, post.id);
      if (!poolPost) throw new Error("Post not found");
      const folderPath = folderPathForPoolPost(pool, poolPost);
      if (isOptimisticPostId(post.id)) {
        cancelledOptimisticPostIdsRef.current.add(post.id);
        localWorkspacePendingSaveIds.delete(post.id);
        localWorkspaceDraftSessions.delete(post.id);
        localWorkspaceDraftRevisions.delete(post.id);
        localWorkspaceServerRevisions.delete(post.id);
        removePost(post.id);
        setSelectedPostId((current) => (current === post.id ? null : current));
        const currentView = viewRef.current;
        if (
          (currentView.level === "post" || currentView.level === "edit") &&
          currentView.postId === post.id
        ) {
          navigateSection(folderPath);
        }
        return;
      }
      localWorkspacePendingSaveIds.delete(post.id);
      localWorkspaceDraftSessions.delete(post.id);
      localWorkspaceDraftRevisions.delete(post.id);
      localWorkspaceServerRevisions.delete(post.id);
      movePostToTrash(post.id);
      setSelectedPostId((current) => (current === post.id ? null : current));
      const currentView = viewRef.current;
      if (
        (currentView.level === "post" || currentView.level === "edit") &&
        currentView.postId === post.id
      ) {
        navigateSection(folderPath);
      }

      try {
        await deleteEditablePostAction(pool.blog.handle, post.id);
      } catch (error) {
        restorePostFromTrash(poolPost.id);
        throw error;
      }
    },
    [canManageFolders, navigateSection],
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

  const requestDeleteTarget = useCallback(() => {
    const current = viewRef.current;
    const postId =
      selectedPostId ??
      (current.level === "post" || current.level === "edit"
        ? current.postId
        : null);
    if (postId && findPoolPostById(displayPoolRef.current, postId)) {
      setPendingDeletePostId(postId);
    }
  }, [selectedPostId]);

  const confirmDeleteTarget = useCallback(() => {
    if (!pendingDeletePostId || deletingTarget) return;
    const poolPost = findPoolPostById(
      displayPoolRef.current,
      pendingDeletePostId,
    );
    if (!poolPost) {
      setPendingDeletePostId(null);
      return;
    }
    setDeletingTarget(true);
    void Promise.resolve(deleteWorkspaceItem(postFromPoolPost(poolPost)))
      .then(() => setPendingDeletePostId(null))
      .catch((error) => console.warn("workspace item delete failed", error))
      .finally(() => setDeletingTarget(false));
  }, [deleteWorkspaceItem, deletingTarget, pendingDeletePostId]);

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
      const warmedBody = displayPool.initialBodies?.find(
        (body) => body.postId === poolPost.id,
      )?.body;
      const opensDirectlyInEdit =
        poolPost.type === "note" ||
        (!poolPost.title.trim() &&
          !(poolPost.excerpt ?? "").trim() &&
          !(warmedBody ?? "").trim() &&
          (poolPost.wordCount ?? 0) === 0);
      openPoolPost(
        poolPost,
        view.level === "section" ? view.folderPath : undefined,
        opensDirectlyInEdit ? "edit" : "read",
      );
    },
    [displayPool, openPoolPost, view],
  );

  const visiblePosts = useMemo(() => {
    if (view.level === "trash") {
      return displayPool.trashedPosts ?? [];
    }
    if (view.level === "section") {
      return poolPostsForFolder(displayPool, view.folderPath);
    }
    if (view.level === "post" || view.level === "edit") {
      return poolPostsForFolder(displayPool, view.folderPath);
    }
    return [];
  }, [displayPool, view]);

  const effectiveSelectedPostId =
    selectedPostId && visiblePosts.some((post) => post.id === selectedPostId)
      ? selectedPostId
      : (visiblePosts[0]?.id ?? null);
  const effectiveSelectedSectionPath = validRootSectionPath(
    displayPool,
    selectedSectionPath,
  );

  useEffect(() => {
    if (!mounted) return;
    const selector =
      view.level === "root" && effectiveSelectedSectionPath
        ? `[data-workspace-section-path="${cssAttributeValue(
            effectiveSelectedSectionPath,
          )}"]`
        : effectiveSelectedPostId
          ? `[data-workspace-post-id="${cssAttributeValue(effectiveSelectedPostId)}"]`
          : null;
    if (!selector) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(selector)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [effectiveSelectedPostId, effectiveSelectedSectionPath, mounted, view.level]);

  const openPostId = useCallback(
    (postId: string, mode: "read" | "edit" = "read") => {
      const post = findPoolPostById(displayPool, postId);
      if (!post) return;
      const nextMode = post.type === "note" && mode === "read" ? "edit" : mode;
      openPoolPost(
        post,
        view.level === "section" || view.level === "post" || view.level === "edit"
          ? view.folderPath
          : undefined,
        nextMode,
      );
    },
    [displayPool, openPoolPost, view],
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
      setSelectedPostId(nextId);
    },
    [effectiveSelectedPostId, openPostId, view, visiblePosts],
  );

  const visiblePostIdsInDocumentOrder = useCallback(() => {
    if (typeof document === "undefined") return visiblePosts.map((post) => post.id);
    const ids = visibleWorkspaceItems("data-workspace-post-id")
      .map((element) => element.dataset.workspacePostId)
      .filter((id): id is string => Boolean(id));
    return ids.length > 0 ? ids : visiblePosts.map((post) => post.id);
  }, [visiblePosts]);

  const selectSpatial = useCallback(
    (direction: SpatialDirection) => {
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

      const root = current.level === "root";
      const attribute = root
        ? "data-workspace-section-path"
        : "data-workspace-post-id";
      const selectedValue = root
        ? effectiveSelectedSectionPath
        : effectiveSelectedPostId;
      const items = visibleWorkspaceItems(attribute);
      const currentElement = selectedValue
        ? items.find((element) =>
            root
              ? element.dataset.workspaceSectionPath === selectedValue
              : element.dataset.workspacePostId === selectedValue,
          ) ?? null
        : null;
      const next = spatialNeighbor(items, currentElement, direction);
      if (!next) return;
      if (root) {
        const path = next.dataset.workspaceSectionPath;
        if (path) setSelectedSectionPath(path);
      } else {
        const postId = next.dataset.workspacePostId;
        if (postId) setSelectedPostId(postId);
      }
    },
    [effectiveSelectedPostId, effectiveSelectedSectionPath],
  );

  const selectRelativeSection = useCallback((direction: 1 | -1) => {
    const sections = rootSectionFolders(displayPoolRef.current);
    if (sections.length === 0) return;
    const currentPath =
      selectedSectionPathRef.current ?? sections[0]?.path ?? null;
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
    if (nextPath) setSelectedSectionPath(nextPath);
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

  const openItemByIndex = useCallback(
    (index: number) => {
      const current = viewRef.current;
      if (current.level === "root") {
        openSectionByIndex(index);
        return;
      }
    if (current.level !== "section" && current.level !== "trash") return;
      const postId = visiblePostIdsInDocumentOrder()[index];
      if (postId) openPostId(postId);
    },
    [openPostId, openSectionByIndex, visiblePostIdsInDocumentOrder],
  );

  const openSelected = useCallback(() => {
    if (viewRef.current.level === "root") {
      const sectionPath =
        validRootSectionPath(
          displayPoolRef.current,
          selectedSectionPathRef.current,
        ) ?? rootSectionFolders(displayPoolRef.current)[0]?.path;
      if (sectionPath) navigateSection(sectionPath);
      return;
    }
    const current = viewRef.current;
    const postId =
      effectiveSelectedPostId ??
      visiblePostIdsInDocumentOrder()[0] ??
      (current.level === "post" || current.level === "edit"
        ? current.postId
        : null);
    if (postId) openPostId(postId);
  }, [effectiveSelectedPostId, navigateSection, openPostId, visiblePostIdsInDocumentOrder]);

  const stopEditing = useCallback(() => {
    const current = viewRef.current;
    if (current.level !== "edit") return;
    const post = findPoolPostById(displayPoolRef.current, current.postId);
    if (!post) {
      navigateSection(current.folderPath, current.postId);
      return;
    }
    navigateToView(
      { level: "post", postId: post.id, folderPath: current.folderPath },
      blogPostPath(displayPoolRef.current.blog, post),
      { selectedPostId: post.id },
    );
  }, [navigateSection, navigateToView]);

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
      window.dispatchEvent(new Event("write:open-workspace-settings"));
    }
  }, [openPostId]);

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
          : folderWorkspaceHref(homePath, nextView.folderPath);
      navigateToView(nextView, href);
    },
    [displayPool, homePath, navigateToView, openPoolPost],
  );

  const navigateUp = useCallback(() => {
    if (view.level === "edit") {
      stopEditing();
      return true;
    }
    if (view.level === "post") {
      navigateSection(view.folderPath, view.postId);
      return true;
    }
    if (
      view.level === "section" ||
      view.level === "trash" ||
      view.level === "shared"
    ) {
      navigateRoot(view.folderPath);
      return true;
    }
    return false;
  }, [navigateRoot, navigateSection, stopEditing, view]);

  useEffect(() => {
    const onPopState = () => {
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
      setSelectedPostId((current) =>
        selectedPostIdForView(displayPool, nextView, current),
      );
      if (nextView.level === "root") {
        setSelectedSectionPath((current) =>
          validRootSectionPath(displayPool, current),
        );
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
      window.scrollBy({ top: direction === "down" ? step : -step, behavior: "auto" });
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
      const currentFolder =
        current.level === "root"
          ? null
          : displayPoolRef.current.folders.find(
              (folder) => folder.path === current.folderPath,
            ) ?? null;
      const targetFolder =
        (currentFolder?.mode === desiredMode ? currentFolder : null) ??
        displayPoolRef.current.folders.find(
          (folder) => folder.mode === desiredMode,
        );
      const folderPath = targetFolder?.path ?? sidebarFolderPathForPostType(kind);

      if (kind === "bookmark") {
        if (
          current.level !== "section" ||
          current.folderPath !== folderPath
        ) {
          navigateSection(folderPath);
        }
        setCreateBookmarkRequestKey((value) => value + 1);
        return;
      }

      createWorkspaceItem({ type: kind, folderPath });
    },
    [createWorkspaceItem, navigateSection],
  );

  const commandSurface = useMemo(
    () => ({
      blog: displayPool.blog,
      handle: displayPool.blog.handle,
      homePath,
      viewLevel: view.level,
      canCreate: canManageFolders,
      canEdit: canManageFolders,
      canManagePost: canManageFolders,
      activeFolderPath: localViewActiveFolder(view),
      activePostId:
        view.level === "post" || view.level === "edit" ? view.postId : null,
      selectedSectionPath: effectiveSelectedSectionPath,
      selectedPostId: effectiveSelectedPostId,
      getRootSectionPaths: () =>
        rootSectionFolders(displayPoolRef.current).map((folder) => folder.path),
      getVisiblePostIds: visiblePostIdsInDocumentOrder,
      getPost: (postId: string) =>
        findPoolPostById(displayPoolRef.current, postId),
      selectPost: (postId: string | null) => setSelectedPostId(postId),
      selectSection: (folderPath: string | null) =>
        setSelectedSectionPath(
          validRootSectionPath(displayPoolRef.current, folderPath),
        ),
      selectSpatial,
      selectNext: () => {
        if (viewRef.current.level === "post") {
          scrollReader("down", "line");
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
        if (viewRef.current.level === "root") {
          selectRelativeSection(-1);
          return;
        }
        selectRelativePost(-1);
      },
      openSelected,
      openItemByIndex,
      openSectionByIndex,
      openPost: openPostId,
      editCurrent,
      stopEditing,
      requestDeleteTarget,
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
      afterDelete: (postId: string) => {
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
      homePath,
      navigateRoot,
      navigateSection,
      navigateUp,
      openCreatedPost,
      openSelected,
      openItemByIndex,
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
      effectiveSelectedSectionPath,
      effectiveSelectedPostId,
      stopEditing,
      view,
      visiblePostIdsInDocumentOrder,
    ],
  );

  useWorkspaceCommandSurface(mounted ? commandSurface : null);

  const content = (
    <LocalWorkspaceContent
      blog={displayPool.blog}
      canCreateItems={canManageFolders}
      canEditItems={canManageFolders}
      canManagePost={canManageFolders}
      createBookmarkRequestKey={createBookmarkRequestKey}
      editFolderRequestKey={editFolderRequestKey}
      handle={displayPool.blog.handle}
      homePath={homePath}
      onNavigate={navigatePath}
      onCaptureResolved={applyResolvedCapture}
      onCreateItem={createWorkspaceItem}
      onDeleteItem={deleteWorkspaceItem}
      onDeleteFolder={deleteWorkspaceFolder}
      onOpenSection={navigateSection}
      onOpenPost={openPost}
      onSelectPost={setSelectedPostId}
      onSelectSection={(folderPath) =>
        setSelectedSectionPath(
          validRootSectionPath(displayPoolRef.current, folderPath),
        )
      }
      pool={displayPool}
      selectedSectionPath={effectiveSelectedSectionPath}
      selectedPostId={effectiveSelectedPostId}
      view={view}
    />
  );

  const atRoot = view.level === "root";
  const effectiveSidebarCollapsed = sidebarCollapsed;
  const assistantContext = useMemo(() => {
    if (view.level === "post" || view.level === "edit") {
      const post = findPoolPostById(displayPool, view.postId);
      return {
        label: post?.title.trim() || "Untitled",
        detail: view.level === "edit" ? "Editing" : "Post",
      };
    }
    if (view.level === "section") {
      const folder = displayPool.folders.find(
        (candidate) => candidate.path === view.folderPath,
      );
      return { label: folder?.name ?? view.folderPath, detail: "Folder" };
    }
    if (view.level === "trash") return { label: "Trash" };
    if (view.level === "shared") return { label: "Shared with me" };
    return { label: displayPool.blog.name, detail: "Workspace" };
  }, [displayPool, view]);

  return (
    <div
      className={`post-editor-shell applecms has-sidebar ${className}${
        effectiveSidebarCollapsed ? " is-sidebar-collapsed" : ""
      }${assistantState === "pinned" ? " has-assistant-pinned" : ""}`}
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
        homePath={homePath}
        onSelectFolder={navigateSection}
        onOpenDocument={(postId) => openPostId(postId)}
        onSelectRoot={navigateRoot}
        onToggleCollapsed={toggleSidebarCollapsed}
        escapeToCollapse={!atRoot}
        prefetchFolders={false}
        sharedCount={displayPool.sharedEntries?.length ?? 0}
        showGuestSignIn={showGuestSignIn}
        trashCount={
          (displayPool.trashedPosts?.length ?? 0) +
          (displayPool.trashedFolders?.length ?? 0)
        }
      />
      <div
        ref={contentRef}
        className={`post-editor-content${
          localViewActiveFolder(view) === "blog" ? " is-blog-folder-view" : ""
        }`}
      >
        {content}
      </div>
      <AssistantSidebar
        className="workspace-assistant-shell"
        state={assistantState}
        onStateChange={changeAssistantState}
        width={assistantWidth}
        onWidthChange={changeAssistantWidth}
        layout="overlay"
        context={assistantContext}
        composerValue={assistantComposer}
        onComposerChange={setAssistantComposer}
        attachments={assistantAttachments}
        onFilesSelected={(files) => {
          setAssistantAttachments((current) => [
            ...current,
            ...files.map((file) => ({
              id: `${file.name}:${file.size}:${file.lastModified}`,
              name: file.name,
              size: file.size,
            })),
          ]);
        }}
        onRemoveAttachment={(attachment) =>
          setAssistantAttachments((current) =>
            current.filter((candidate) => candidate.id !== attachment.id),
          )
        }
        onSubmit={(submission) => {
          setAssistantComposer("");
          setAssistantAttachments([]);
          void assistant.submit(submission.text);
        }}
        submitting={assistant.submitting}
        composerPlaceholder={
          assistant.capabilities?.available
            ? "Ask or act, on this Mac"
            : "Ask about this page"
        }
        accept="image/*,.pdf,.txt,.md"
      >
        <AssistantConversation
          capabilities={assistant.capabilities}
          messages={assistant.messages}
          submitting={assistant.submitting}
        />
      </AssistantSidebar>
      <ConfirmationDialog
        open={Boolean(pendingDeletePostId)}
        title="Move this item to Trash?"
        message="You can restore it later from Trash."
        confirmLabel="Move to Trash"
        confirmingLabel="Moving"
        confirming={deletingTarget}
        onCancel={() => setPendingDeletePostId(null)}
        onConfirm={confirmDeleteTarget}
      />
    </div>
  );
}

export function BlogHomeWorkspaceShell({
  activeFolder = null,
  blog,
  children,
  counts,
  canManageFolders = false,
  canManageSharing = false,
  folders,
  homePath,
  initialSidebarCollapsed = false,
  initialPool,
  showGuestSignIn = false,
}: {
  activeFolder?: SidebarFolderId | null;
  blog: Blog;
  children: ReactNode;
  counts: Record<string, number>;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  folders: Folder[];
  homePath: string;
  initialSidebarCollapsed?: boolean;
  initialPool?: WorkspacePoolPayload | null;
  showGuestSignIn?: boolean;
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
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          className="is-home-workspace-shell"
          homePath={homePath}
          initialPool={initialPool}
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialView={
            activeFolder === TRASH_FOLDER_PATH
              ? { level: "trash", folderPath: TRASH_FOLDER_PATH }
              : activeFolder === SHARED_FOLDER_PATH
                ? { level: "shared", folderPath: SHARED_FOLDER_PATH }
                : activeFolder
                  ? { level: "section", folderPath: activeFolder }
                  : { level: "root" }
          }
          showGuestSignIn={showGuestSignIn}
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
        onToggleCollapsed={toggleSidebarCollapsed}
        showGuestSignIn={showGuestSignIn}
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
  showGuestSignIn = false,
}: {
  adjacent: AdjacentPosts;
  blog: Blog;
  children: ReactNode;
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
  showGuestSignIn?: boolean;
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
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          className="is-read-workspace-shell"
          homePath={homePath}
          initialPool={localInitialPool}
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialView={
            post.id
              ? {
                  level: initialMode === "edit" ? "edit" : "post",
                  postId: post.id,
                  folderPath: sidebarFolderPathForPostType(post.type),
                }
              : { level: "root" }
          }
          showGuestSignIn={showGuestSignIn}
        >
          <PostActionBar
            mode="read"
            owner
            blog={blog}
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
        showGuestSignIn={showGuestSignIn}
      />
      <div className="post-editor-content">
        <PostActionBar
          mode="read"
          owner
          blog={blog}
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
