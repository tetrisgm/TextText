"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createSubfolderAction } from "@/app/editor/actions";
import { PostActionBar } from "@/components/PostActionBar";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceMenuMount } from "@/components/workspace/WorkspaceMenuMount";
import type { Blog, Folder, FolderMode, Post, PostType } from "@/lib/content";
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

// Rendered only if a caller cannot provide real folders, so the sidebar never
// collapses to nothing; real pages thread getFolders results through.
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

/** Client-safe mirror of store.ts folderPathForPostType. */
export function sidebarFolderPathForPostType(type: PostType): SidebarFolderId {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
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

function readSidebarCollapsed(fallback = true): boolean {
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
  if (readSidebarCollapsed(true)) return false;
  setWorkspaceSidebarCollapsedPreference(true);
  return true;
}

export function useWorkspaceSidebarCollapsed(initialCollapsed = true) {
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
  canManageSharing,
  canManageFolders,
  onSelectFolder,
  onShareFolder,
}: {
  blog: Blog;
  folders: Folder[];
  activeFolder: SidebarFolderId;
  counts: Record<string, number>;
  collapsed: boolean;
  canManageSharing: boolean;
  canManageFolders: boolean;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onShareFolder: (folder: Folder) => void;
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
    let node = foldersByPath.get(activeFolder);
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
  canManageFolders = false,
  canManageSharing = false,
  folders,
  homePath,
  onSelectFolder,
  onToggleCollapsed,
  showGuestSignIn = false,
}: {
  blog: Blog;
  activeFolder: SidebarFolderId;
  collapsed: boolean;
  counts: Record<string, number>;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  folders: Folder[];
  homePath?: string;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onToggleCollapsed: () => void;
  showGuestSignIn?: boolean;
}) {
  const navFolders = folders.length > 0 ? folders : FALLBACK_FOLDERS;
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
              <a className="post-editor-home-link" href={homePath}>
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
          canManageFolders={canManageFolders}
          canManageSharing={canManageSharing}
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
  onToggleCollapsed,
  showGuestSignIn = false,
}: {
  activeFolder: SidebarFolderId;
  blog: Blog;
  collapsed: boolean;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  counts: Record<string, number>;
  folders: Folder[];
  homePath?: string;
  onSelectFolder: (folder: SidebarFolderId) => void;
  onToggleCollapsed: () => void;
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

  useEffect(() => {
    if (collapsed) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSidebar();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSidebar, collapsed]);

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

export function BlogHomeWorkspaceShell({
  activeFolder = "blog",
  blog,
  children,
  counts,
  canManageFolders = false,
  canManageSharing = false,
  folders,
  homePath,
  initialSidebarCollapsed = true,
  showGuestSignIn = false,
}: {
  activeFolder?: SidebarFolderId;
  blog: Blog;
  children: ReactNode;
  counts: Record<string, number>;
  canManageFolders?: boolean;
  canManageSharing?: boolean;
  folders: Folder[];
  homePath: string;
  initialSidebarCollapsed?: boolean;
  showGuestSignIn?: boolean;
}) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  // Folders carry real server-rendered contents, so selecting one is a real
  // navigation (the server fetches that folder's items), not a history swap.
  const selectFolder = useCallback(
    (folder: SidebarFolderId) => {
      router.push(
        folder === "blog"
          ? homePath
          : `${homePath}?folder=${encodeURIComponent(folder)}`,
      );
    },
    [homePath, router],
  );

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
  initialSidebarCollapsed = true,
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
  post: Post;
  postPath: string;
  showGuestSignIn?: boolean;
}) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);

  // Folder rows always navigate to the workspace home (with the folder open),
  // so every shell shares one sidebar behavior and the reader never gets
  // stranded in a folder view without its post.
  const selectSidebarFolder = useCallback(
    (folder: SidebarFolderId) => {
      router.push(
        folder === "blog" ? homePath : `${homePath}?folder=${folder}`,
      );
    },
    [homePath, router],
  );

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
