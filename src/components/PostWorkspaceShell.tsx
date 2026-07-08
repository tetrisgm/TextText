"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  createSubfolderAction,
  saveEditablePostAction,
} from "@/app/editor/actions";
import {
  useEscapeLayer,
  useWorkspaceCommandSurface,
} from "@/components/keyboard/CommandLayer";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/keyboard/CommandPalette";
import { FolderPage } from "@/components/FolderPage";
import { PostActionBar } from "@/components/PostActionBar";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { EditReaderPreview } from "@/components/editor/EditReaderPreview";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceMenuMount } from "@/components/workspace/WorkspaceMenuMount";
import type { Blog, Folder, FolderMode, Post, PostType } from "@/lib/content";
import { BLOG_FOLDER_PATH } from "@/lib/content";
import {
  adjacentPublishedPostsForPool,
  findPoolPostById,
  findPoolPostBySlug,
  folderPathForPoolPost,
  poolPostsForFolder,
  postFromPoolPost,
} from "@/lib/pool/selectors";
import {
  updatePost,
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
import type { AdjacentPublishedPosts } from "@/lib/store";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  WORKSPACE_SIDEBAR_COOKIE_MAX_AGE,
  WORKSPACE_SIDEBAR_STORAGE_KEY,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";

/** A folder's workspace-unique path segment, e.g. "blog" or "notes". */
export type SidebarFolderId = string;

type AdjacentPosts = AdjacentPublishedPosts;

let sidebarCollapsedMemory: boolean | null = null;
const sidebarCollapsedListeners = new Set<() => void>();

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

/** Client-safe mirror of store.ts folderPathForPostType. */
export function sidebarFolderPathForPostType(type: PostType): SidebarFolderId {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
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
    nav.querySelectorAll<HTMLButtonElement>(".post-editor-folder-row"),
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
const MAX_FOLDER_DEPTH = 4;

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
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const foldersByPath = new Map(folders.map((f) => [f.path, f]));

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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

  // Load persisted expand state, then force-open the ancestors of the active
  // folder so the current selection is always visible.
  useEffect(() => {
    const next = new Set<string>();
    try {
      const raw = window.localStorage.getItem(FOLDER_EXPANDED_KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) next.add(id);
    } catch {
      // ignore malformed storage
    }
    let node = activeFolder ? foldersByPath.get(activeFolder) : undefined;
    while (node?.parentId) {
      next.add(node.parentId);
      node = foldersById.get(node.parentId);
    }
    setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder]);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(
          FOLDER_EXPANDED_KEY,
          JSON.stringify([...next]),
        );
      } catch {
        // ignore
      }
      return next;
    });
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
      if (parent) setExpanded((c) => new Set(c).add(parent.id));
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
                setExpanded((c) => new Set(c).add(folder.id));
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
  prefetchFolders = true,
  canManageFolders = false,
  canManageSharing = false,
  folders,
  homePath,
  onSelectRoot,
  onSelectFolder,
  onToggleCollapsed,
  showGuestSignIn = false,
}: {
  blog: Blog;
  activeFolder: SidebarFolderId | null;
  collapsed: boolean;
  counts: Record<string, number>;
  prefetchFolders?: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  folders: Folder[];
  homePath?: string;
  onSelectRoot?: () => void;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onToggleCollapsed: () => void;
  showGuestSignIn?: boolean;
}) {
  const navFolders =
    folders.length > 0 || !canManageFolders ? folders : FALLBACK_FOLDERS;
  const [sharingFolder, setSharingFolder] = useState<Folder | null>(null);
  const homeContent = (
    <>
      <span className="post-editor-home-icon" aria-hidden="true">
        <FolderIcon />
      </span>
      <span className="post-editor-home-copy">
        <span className="post-editor-home-name">{blog.name}</span>
        <span className="post-editor-home-meta">Workspace</span>
      </span>
    </>
  );

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
          settingsHref={homePath ?? "/"}
          fallback={
            homePath ? (
              <a
                className="post-editor-home-link"
                href={workspaceRootHref(homePath)}
                onClick={(event) => {
                  if (!onSelectRoot) return;
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onSelectRoot();
                }}
              >
                {homeContent}
              </a>
            ) : (
              <div className="post-editor-home-link is-static">{homeContent}</div>
            )
          }
        />
        <button
          type="button"
          className="post-editor-sidebar-toggle"
          aria-label="Open command palette"
          title="Command palette"
          style={{
            color: "var(--ink)",
            font: "700 12px/1 var(--font-body)",
            letterSpacing: "0",
          }}
          onClick={openCommandPalette}
        >
          <span aria-hidden="true">⌘K</span>
        </button>
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
      </nav>

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
  folders,
  homePath,
  onSelectFolder,
  onSelectRoot,
  prefetchFolders = true,
  onToggleCollapsed,
  escapeToCollapse = true,
  showGuestSignIn = false,
}: {
  activeFolder: SidebarFolderId | null;
  blog: Blog;
  collapsed: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  counts: Record<string, number>;
  folders: Folder[];
  homePath?: string;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onSelectRoot?: () => void;
  prefetchFolders?: boolean;
  onToggleCollapsed: () => void;
  // Only the collapsed hover preview is an Escape overlay. The persistent
  // sidebar is workspace chrome, so Escape remains available for navigation.
  escapeToCollapse?: boolean;
  showGuestSignIn?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const showPreview = useCallback(() => {
    if (collapsed) setPreviewOpen(true);
  }, [collapsed]);
  const hidePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);
  const selectFolder = useCallback(
    (folder: SidebarFolderId) => {
      // Selecting from the hover preview should also dismiss the overlay.
      setPreviewOpen(false);
      onSelectFolder(folder);
    },
    [onSelectFolder],
  );
  const selectRoot = useCallback(() => {
    setPreviewOpen(false);
    onSelectRoot?.();
  }, [onSelectRoot]);
  const closeSidebar = useCallback(() => {
    setPreviewOpen(false);
    if (!collapsed) onToggleCollapsed();
  }, [collapsed, onToggleCollapsed]);
  const openSidebar = useCallback(() => {
    setPreviewOpen(false);
    if (collapsed) onToggleCollapsed();
  }, [collapsed, onToggleCollapsed]);
  const toggleSidebar = useCallback(() => {
    setPreviewOpen(false);
    onToggleCollapsed();
  }, [onToggleCollapsed]);

  useEscapeLayer(
    escapeToCollapse && previewOpen,
    "Sidebar preview",
    hidePreview,
  );

  return (
    <>
      <div
        className={`post-workspace-sidebar-region${
          collapsed ? " is-collapsed" : ""
        }${previewOpen ? " is-preview-open" : ""}`}
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
      >
        {collapsed && (
          <button
            type="button"
            className="post-sidebar-reveal-button"
            aria-label="Show sidebar"
            aria-expanded={previewOpen}
            onClick={openSidebar}
          >
            <SidebarRevealIcon />
          </button>
        )}
        <PostFolderSidebar
          blog={blog}
          activeFolder={activeFolder}
          collapsed={collapsed}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          counts={counts}
          folders={folders}
          homePath={homePath}
          onSelectFolder={selectFolder}
          onSelectRoot={selectRoot}
          prefetchFolders={prefetchFolders}
          onToggleCollapsed={toggleSidebar}
          showGuestSignIn={showGuestSignIn}
        />
      </div>
      <button
        type="button"
        className="post-sidebar-backdrop"
        aria-label="Hide sidebar"
        tabIndex={collapsed ? -1 : 0}
        onClick={closeSidebar}
      />
    </>
  );
}

type LocalWorkspaceView =
  | { level: "root" }
  | { folderPath: string; level: "section" }
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

function localViewActiveFolder(view: LocalWorkspaceView): SidebarFolderId | null {
  return view.level === "root" ? null : view.folderPath;
}

function isOptimisticPostId(postId: string): boolean {
  return postId.startsWith("optimistic-");
}

function autoGrowTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
}

function WorkspaceRootLanding({
  blog,
  counts,
  folders,
  onOpenSection,
  onSelectSection,
  selectedSectionPath,
}: {
  blog: Blog;
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
        <span className="workspace-root-eyebrow">Workspace</span>
        <h1 id="workspace-root-title">{blog.name}</h1>
        <p>Choose a section.</p>
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

function MarkdownBody({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: "h2",
        img: ({ src, alt }) => (
          <span className="reader-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={typeof src === "string" ? src : ""}
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
        ),
      }}
    >
      {body}
    </ReactMarkdown>
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
  const { entry, load } = useWorkspacePostBody(pool.blogId, poolPost.id);

  useEffect(() => {
    if (entry.status === "idle") load();
  }, [entry.status, load]);

  const body =
    entry.status === "ready" ? entry.body.body : "";
  const post = postFromPoolPost(poolPost, body);
  const bodySlot =
    entry.status === "ready" ? (
      <MarkdownBody body={entry.body.body} />
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
        canEditPost
        canManagePost={canManagePost}
        onNavigate={onNavigate}
      />
      <ReaderComponent blog={blog} post={post} slots={slots} />
    </>
  );
}

function LocalWorkspacePostEditor({
  blog,
  pool,
  poolPost,
}: {
  blog: Blog;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
}) {
  const post = useMemo(() => postFromPoolPost(poolPost), [poolPost]);
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(post));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const previousPostIdRef = useRef(poolPost.id);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedKeyRef = useRef(
    payloadKey(payloadFor(poolPost.id, initialDraft(post), post.slug)),
  );
  const latestKeyRef = useRef(lastSavedKeyRef.current);
  const usedSlugs = useMemo(
    () =>
      pool.posts
        .filter((candidate) => candidate.id !== poolPost.id)
        .map((candidate) => candidate.slug),
    [pool.posts, poolPost.id],
  );

  useEffect(() => {
    const wasOptimistic = isOptimisticPostId(previousPostIdRef.current);
    previousPostIdRef.current = poolPost.id;
    const nextDraft = initialDraft(post);
    setDraft(nextDraft);
    lastSavedKeyRef.current = wasOptimistic
      ? ""
      : payloadKey(payloadFor(poolPost.id, nextDraft, post.slug));
    latestKeyRef.current = lastSavedKeyRef.current;
    // Re-seed only when the editor changes items. Pool updates for the same
    // item are usually our own local keystrokes and must not mark the draft
    // saved before the debounced server save runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolPost.id]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      const title = titleRef.current;
      if (!title) return;
      title.focus({ preventScroll: true });
      title.setSelectionRange(title.value.length, title.value.length);
    });
  }, [poolPost.id]);

  useEffect(() => {
    autoGrowTextarea(titleRef.current);
  }, [draft.title]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const updateDraft = useCallback(
    (patch: Partial<DraftState>) => {
      setDraft((current) => {
        const next = { ...current, ...patch };
        updatePost(poolPost.id, {
          title: next.title,
          excerpt: next.excerpt || undefined,
          slug: next.slug,
          updatedAt: new Date().toISOString(),
        });
        return next;
      });
    },
    [poolPost.id],
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

  useEffect(() => {
    if (isOptimisticPostId(poolPost.id)) return;

    const payload = payloadFor(poolPost.id, draft, post.slug);
    const key = payloadKey(payload);
    latestKeyRef.current = key;
    if (key === lastSavedKeyRef.current) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const sentKey = key;
      void saveEditablePostAction(blog.handle, payload)
        .then((saved) => {
          if (latestKeyRef.current !== sentKey) return;
          lastSavedKeyRef.current = sentKey;
          updatePost(poolPost.id, {
            slug: saved.slug,
            title: saved.title,
            excerpt: saved.excerpt,
            updatedAt: saved.updatedAt,
          });
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
  }, [blog.handle, draft, poolPost.id, post.slug]);

  const displayPost = useMemo<Post>(
    () => ({
      ...post,
      title: draft.title,
      excerpt: draft.excerpt || undefined,
      body: draft.body,
      status: draft.status,
      slug: draft.slug || post.slug,
    }),
    [draft, post],
  );

  return (
    <main className="local-workspace-edit" aria-label="Edit post">
      <EditReaderPreview
        blog={blog}
        post={displayPost}
        slots={{
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
                if (event.key === "Enter") {
                  event.preventDefault();
                  deriveSlugFromTitle(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }}
            />
          ),
          body: <div className="local-workspace-edit-empty-body" />,
        }}
      />
    </main>
  );
}

function LocalWorkspaceContent({
  blog,
  canCreateItems,
  canEditItems,
  canManagePost,
  createBookmarkRequestKey,
  handle,
  homePath,
  onNavigate,
  onOpenSection,
  onOpenPost,
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
  handle: string;
  homePath: string;
  onNavigate: (path: string) => Promise<void> | void;
  onOpenSection: (folderPath: string) => void;
  onOpenPost: (post: Post) => void;
  onSelectSection: (folderPath: string) => void;
  pool: WorkspacePoolPayload;
  selectedSectionPath: string | null;
  selectedPostId: string | null;
  view: LocalWorkspaceView;
}) {
  if (view.level === "root") {
    return (
      <WorkspaceRootLanding
        blog={blog}
        counts={pool.counts}
        folders={rootSectionFolders(pool)}
        selectedSectionPath={selectedSectionPath}
        onSelectSection={onSelectSection}
        onOpenSection={onOpenSection}
      />
    );
  }

  if (view.level === "section") {
    const folder = pool.folders.find((entry) => entry.path === view.folderPath);
    if (!folder) {
      return (
        <WorkspaceRootLanding
          blog={blog}
          counts={pool.counts}
          folders={rootSectionFolders(pool)}
          selectedSectionPath={selectedSectionPath}
          onSelectSection={onSelectSection}
          onOpenSection={onOpenSection}
        />
      );
    }
    const items = poolPostsForFolder(pool, folder.path).map((post) =>
      postFromPoolPost(post),
    );
    return (
      <FolderPage
        blog={blog}
        folder={folder}
        handle={handle}
        items={items}
        canCreateItems={canCreateItems}
        canEditItems={canEditItems}
        onOpenPost={onOpenPost}
        createBookmarkRequestKey={createBookmarkRequestKey}
        selectedPostId={selectedPostId}
      />
    );
  }

  const post = findPoolPostById(pool, view.postId);
  if (!post) {
    return (
      <WorkspaceRootLanding
        blog={blog}
        counts={pool.counts}
        folders={rootSectionFolders(pool)}
        selectedSectionPath={selectedSectionPath}
        onSelectSection={onSelectSection}
        onOpenSection={onOpenSection}
      />
    );
  }
  if (view.level === "edit") {
    return (
      <LocalWorkspacePostEditor
        blog={blog}
        pool={pool}
        poolPost={post}
      />
    );
  }
  return (
    <WorkspacePostReader
      blog={blog}
      canManagePost={canManagePost}
      homePath={homePath}
      onNavigate={onNavigate}
      pool={pool}
      poolPost={post}
    />
  );
}

function LocalWorkspaceShell({
  blog,
  canManageFolders,
  canManageSharing,
  children,
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
  const displayPool = pool?.blogId === initialPool.blogId ? pool : initialPool;
  const displayPoolRef = useRef(displayPool);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<LocalWorkspaceView>(initialView);
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
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    displayPoolRef.current = displayPool;
  }, [displayPool]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    selectedSectionPathRef.current = selectedSectionPath;
  }, [selectedSectionPath]);

  useEffect(() => {
    const nextView = currentLocalView(displayPool, homePath);
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
  }, [displayPool, homePath]);

  const navigateToView = useCallback(
    (
      nextView: LocalWorkspaceView,
      href: string,
      options: {
        selectedPostId?: string | null;
        selectedSectionPath?: string | null;
      } = {},
    ) => {
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
      navigateToView(
        { level: "section", folderPath },
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
      const nextFolderPath =
        folderPath ?? folderPathForPoolPost(displayPool, post);
      navigateToView(
        {
          level: mode === "edit" ? "edit" : "post",
          postId: post.id,
          folderPath: nextFolderPath,
        },
        mode === "edit"
          ? blogPostEditPath(displayPool.blog, post)
          : blogPostPath(displayPool.blog, post),
      );
    },
    [displayPool, navigateToView],
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
      if (current.level !== "edit" || current.postId !== temporaryPostId) {
        return;
      }
      const nextView: LocalWorkspaceView = {
        level: "edit",
        postId: savedPost.id,
        folderPath: folderPathForPoolPost(displayPoolRef.current, savedPost),
      };
      replaceWithView(
        nextView,
        blogPostEditPath(displayPoolRef.current.blog, savedPost),
      );
    },
    [replaceWithView],
  );

  const openPost = useCallback(
    (post: Post) => {
      if (!post.id) return;
      const poolPost = findPoolPostById(displayPool, post.id);
      if (!poolPost) return;
      openPoolPost(poolPost, view.level === "section" ? view.folderPath : undefined);
    },
    [displayPool, openPoolPost, view],
  );

  const visiblePosts = useMemo(() => {
    if (view.level === "section") {
      return poolPostsForFolder(displayPool, view.folderPath);
    }
    if (view.level === "post" || view.level === "edit") {
      return poolPostsForFolder(displayPool, view.folderPath);
    }
    return [];
  }, [displayPool, view]);

  useEffect(() => {
    if (view.level !== "section") return;
    setSelectedPostId((current) => {
      if (current && visiblePosts.some((post) => post.id === current)) {
        return current;
      }
      return visiblePosts[0]?.id ?? null;
    });
  }, [view.level, visiblePosts]);

  useEffect(() => {
    if (view.level !== "root") return;
    setSelectedSectionPath((current) =>
      validRootSectionPath(displayPool, current),
    );
  }, [displayPool, view.level]);

  useEffect(() => {
    if (!mounted) return;
    const selector =
      view.level === "root" && selectedSectionPath
        ? `[data-workspace-section-path="${cssAttributeValue(
            selectedSectionPath,
          )}"]`
        : selectedPostId
          ? `[data-workspace-post-id="${cssAttributeValue(selectedPostId)}"]`
          : null;
    if (!selector) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(selector)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [mounted, selectedPostId, selectedSectionPath, view.level]);

  const openPostId = useCallback(
    (postId: string, mode: "read" | "edit" = "read") => {
      const post = findPoolPostById(displayPool, postId);
      if (!post) return;
      openPoolPost(
        post,
        view.level === "section" || view.level === "post" || view.level === "edit"
          ? view.folderPath
          : undefined,
        mode,
      );
    },
    [displayPool, openPoolPost, view],
  );

  const selectRelativePost = useCallback(
    (direction: 1 | -1) => {
      const ids = visiblePosts.map((post) => post.id);
      if (ids.length === 0) return;
      const currentId =
        selectedPostId ??
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
    [openPostId, selectedPostId, view, visiblePosts],
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
      selectedPostId ??
      (current.level === "post" || current.level === "edit"
        ? current.postId
        : null);
    if (postId) openPostId(postId);
  }, [navigateSection, openPostId, selectedPostId]);

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
    if (view.level === "post" || view.level === "edit") {
      navigateSection(view.folderPath, view.postId);
      return true;
    }
    if (view.level === "section") {
      navigateRoot(view.folderPath);
      return true;
    }
    return false;
  }, [navigateRoot, navigateSection, view]);

  useEffect(() => {
    const onPopState = () => {
      const nextView = currentLocalView(displayPool, homePath);
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
      selectedSectionPath,
      selectedPostId,
      getRootSectionPaths: () =>
        rootSectionFolders(displayPoolRef.current).map((folder) => folder.path),
      getVisiblePostIds: () => visiblePosts.map((post) => post.id),
      getPost: (postId: string) =>
        findPoolPostById(displayPoolRef.current, postId),
      selectPost: (postId: string | null) => setSelectedPostId(postId),
      selectSection: (folderPath: string | null) =>
        setSelectedSectionPath(
          validRootSectionPath(displayPoolRef.current, folderPath),
        ),
      selectNext: () => {
        if (viewRef.current.level === "root") {
          selectRelativeSection(1);
          return;
        }
        selectRelativePost(1);
      },
      selectPrevious: () => {
        if (viewRef.current.level === "root") {
          selectRelativeSection(-1);
          return;
        }
        selectRelativePost(-1);
      },
      openSelected,
      openSectionByIndex,
      openPost: openPostId,
      openCreatedPost,
      reconcileCreatedPost,
      openFolder: navigateSection,
      navigateRoot,
      navigateUp,
      afterDelete: (postId: string) => {
        if (selectedPostId === postId) setSelectedPostId(null);
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
      displayPool,
      homePath,
      navigateRoot,
      navigateSection,
      navigateUp,
      openCreatedPost,
      openSelected,
      openSectionByIndex,
      openPostId,
      reconcileCreatedPost,
      selectRelativePost,
      selectRelativeSection,
      selectedSectionPath,
      selectedPostId,
      view,
      visiblePosts,
    ],
  );

  useWorkspaceCommandSurface(mounted ? commandSurface : null);

  const content = mounted ? (
    <LocalWorkspaceContent
      blog={displayPool.blog}
      canCreateItems={canManageFolders}
      canEditItems={canManageFolders}
      canManagePost={canManageFolders}
      createBookmarkRequestKey={createBookmarkRequestKey}
      handle={displayPool.blog.handle}
      homePath={homePath}
      onNavigate={navigatePath}
      onOpenSection={navigateSection}
      onOpenPost={openPost}
      onSelectSection={(folderPath) =>
        setSelectedSectionPath(
          validRootSectionPath(displayPoolRef.current, folderPath),
        )
      }
      pool={displayPool}
      selectedSectionPath={selectedSectionPath}
      selectedPostId={selectedPostId}
      view={view}
    />
  ) : (
    children
  );

  // The root is the top of the route and the sidebar is its content: always
  // show the sidebar open there, whatever the persisted collapse preference.
  const atRoot = view.level === "root";
  const effectiveSidebarCollapsed = atRoot ? false : sidebarCollapsed;

  return (
    <div
      className={`post-editor-shell applecms has-sidebar ${className}${
        effectiveSidebarCollapsed ? " is-sidebar-collapsed" : ""
      }`}
    >
      <WorkspaceSidebarChrome
        blog={displayPool.blog ?? blog}
        activeFolder={localViewActiveFolder(view)}
        canManageFolders={canManageFolders}
        canManageSharing={canManageSharing}
        collapsed={effectiveSidebarCollapsed}
        counts={displayPool.counts}
        folders={displayPool.folders}
        homePath={homePath}
        onSelectFolder={navigateSection}
        onSelectRoot={navigateRoot}
        onToggleCollapsed={toggleSidebarCollapsed}
        escapeToCollapse={!atRoot}
        prefetchFolders={false}
        showGuestSignIn={showGuestSignIn}
      />
      <div
        className={`post-editor-content${
          localViewActiveFolder(view) === "blog" ? " is-blog-folder-view" : ""
        }`}
      >
        {content}
      </div>
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
            activeFolder
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
  post: Post;
  postPath: string;
  showGuestSignIn?: boolean;
}) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  const selectSidebarFolder = useCallback(
    (folder: SidebarFolderId) => {
      router.push(folderWorkspaceHref(homePath, folder));
    },
    [homePath, router],
  );

  if (initialPool) {
    return (
      <WorkspaceProvider
        initialPool={initialPool}
        initialBody={initialPostBody}
      >
        <LocalWorkspaceShell
          blog={blog}
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
          className="is-read-workspace-shell"
          homePath={homePath}
          initialPool={initialPool}
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialView={
            post.id
              ? {
                  level: "post",
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
