"use client";

// The workspace sidebar: collapse/width/assistant-preference stores (module
// state - one tab, one sidebar), the folder tree, and the chrome component
// with its resize handle. Extracted from the PostWorkspaceShell monolith.

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  createSubfolderAction,
  renameFolderAction,
} from "@/app/editor/actions";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import {
  useEscapeLayer,
} from "@/components/keyboard/CommandLayer";
// Loaded on demand. The picker carries the template gallery, and with it the
// document renderer and react-markdown; imported statically it put all of
// that in the sidebar's chunk group on every home load.
const FolderLookPicker = dynamic(() =>
  import("@/components/workspace/FolderLookPicker").then(
    (module) => module.FolderLookPicker,
  ),
);
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceMenuMount } from "@/components/workspace/WorkspaceMenuMount";
import {
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH,
  ASSISTANT_SIDEBAR_MAX_WIDTH,
  ASSISTANT_SIDEBAR_MIN_WIDTH,
  type AssistantSidebarState,
} from "@/components/workspace/assistant/constants";
import type {
  Blog,
  Folder,
  FolderMode,
} from "@/lib/content";
import {
  updateFolder,
} from "@/lib/pool/store";
import type {
  WorkspacePoolPost,
} from "@/lib/pool/types";
import {
  WORKSPACE_ASSISTANT_COOKIE_MAX_AGE,
  WORKSPACE_ASSISTANT_STATE_COOKIE,
  WORKSPACE_ASSISTANT_WIDTH_COOKIE,
} from "@/lib/workspace-assistant-prefs";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  WORKSPACE_SIDEBAR_COOKIE_MAX_AGE,
  WORKSPACE_SIDEBAR_STORAGE_KEY,
  WORKSPACE_SIDEBAR_WIDTH_COOKIE,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";
import {
  SHARED_FOLDER_PATH,
  STARRED_FOLDER_PATH,
  TRASH_FOLDER_PATH,
} from "@/lib/workspace-paths";
import {
  disarmWorkspaceHover,
} from "@/lib/workspace-hover";
import {
  folderWorkspaceHref,
  type SidebarFolderId,
} from "@/lib/workspace/local-view";
import {
  calendarDaysForMonth,
  calendarDocumentAction,
  groupDocumentsByActivityDate,
  localDateKey,
} from "@/lib/workspace-activity";


let sidebarCollapsedMemory: boolean | null = null;
const sidebarCollapsedListeners = new Set<() => void>();
let sidebarWidthMemory: number | null = null;
const sidebarWidthListeners = new Set<() => void>();

const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = "texttext:workspace-sidebar-width";
export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 252;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;
export const WORKSPACE_COMPACT_MEDIA_QUERY = "(max-width: 1024px)";

const WORKSPACE_ASSISTANT_STATE_KEY = "texttext:workspace-assistant-state";
const WORKSPACE_ASSISTANT_STATE_MIGRATION_KEY =
  "texttext:workspace-assistant-state:v5";
/// Below this the document column cannot give up the room, so the rail stays a
/// thing you summon rather than a thing that is open.
export const ASSISTANT_PINNED_MIN_WIDTH = 1100;
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










/** Client-safe mirror of store.ts folderPathForPostType. */







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

/**
 * Write the sidebar width everywhere the variable is scoped: the root, every
 * .post-editor-shell (whose stylesheet redeclares a default that would shadow
 * the root value), and the sidebar region's own inline declaration.
 */
function applySidebarWidthVariable(width: number) {
  if (typeof document === "undefined") return;
  const value = `${width}px`;
  document.documentElement.style.setProperty(
    "--workspace-sidebar-width",
    value,
  );
  for (const el of document.querySelectorAll<HTMLElement>(
    ".post-editor-shell, .post-workspace-sidebar-region",
  )) {
    el.style.setProperty("--workspace-sidebar-width", value);
  }
}

function writeSidebarWidthFactCookie(width: number) {
  if (typeof document === "undefined") return;
  document.cookie = `${WORKSPACE_SIDEBAR_WIDTH_COOKIE}=${Math.round(width)}; path=/; max-age=${WORKSPACE_SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
}

function setWorkspaceSidebarWidth(next: number) {
  sidebarWidthMemory = clampSidebarWidth(next);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY,
      String(sidebarWidthMemory),
    );
  }
  writeSidebarWidthFactCookie(sidebarWidthMemory);
  for (const listener of sidebarWidthListeners) listener();
}

export function useWorkspaceSidebarWidth(initialWidth?: number) {
  const width = useSyncExternalStore(
    subscribeSidebarWidth,
    readSidebarWidth,
    () => initialWidth ?? WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  );
  // Keep the first-paint fact cache current (localStorage predates the
  // cookie for existing browsers).
  useEffect(() => {
    writeSidebarWidthFactCookie(width);
  }, [width]);
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

export function setWorkspaceAssistantState(next: AssistantSidebarState) {
  assistantStateMemory = next;
  window.localStorage.setItem(WORKSPACE_ASSISTANT_STATE_KEY, next);
  emitAssistantPreferences();
}

export function setWorkspaceAssistantWidth(next: number) {
  assistantWidthMemory = clampAssistantWidth(next);
  window.localStorage.setItem(
    WORKSPACE_ASSISTANT_WIDTH_KEY,
    String(assistantWidthMemory),
  );
  emitAssistantPreferences();
}

function writeAssistantFactCookies(
  state: AssistantSidebarState,
  width: number,
) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const suffix = `; Path=/; Max-Age=${WORKSPACE_ASSISTANT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  document.cookie = `${WORKSPACE_ASSISTANT_STATE_COOKIE}=${
    state === "pinned" ? "pinned" : "hidden"
  }${suffix}`;
  document.cookie = `${WORKSPACE_ASSISTANT_WIDTH_COOKIE}=${Math.round(width)}${suffix}`;
}

export function useWorkspaceAssistantPreferences(
  initialState?: AssistantSidebarState,
  initialWidth?: number,
) {
  const state = useSyncExternalStore(
    subscribeAssistantPreferences,
    readAssistantState,
    () => initialState ?? ("hidden" as AssistantSidebarState),
  );
  const width = useSyncExternalStore(
    subscribeAssistantPreferences,
    readAssistantWidth,
    () => initialWidth ?? ASSISTANT_SIDEBAR_DEFAULT_WIDTH,
  );
  // Keep the first-paint fact cache current so the next SSR paints the rail
  // exactly as this window resolved it - no pop-in, no resize.
  useEffect(() => {
    writeAssistantFactCookies(state, clampAssistantWidth(width));
  }, [state, width]);
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

export function SidebarFolderIcon({ mode }: { mode: FolderMode }) {
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

/**
 * The floating history controls.
 *
 * Back and forward go through the shell's `__ttNavGo` rather than
 * `window.history`, because the trail bookkeeping the swipe and the keys both
 * rely on lives there: a raw traversal moves the browser without telling the
 * shell, and the next gesture then reads an index that no longer describes
 * where we are. Falling back to the raw call keeps the buttons working on the
 * server-rendered pages, which have no shell to ask.
 *
 * Previous/next item is NOT here. The action bar already carries that pair as
 * left and right chevrons, and adding a second pair as up and down chevrons in
 * a different place gave one action two controls that disagreed about both
 * their arrows and where they lived (owner, 2026-09-04).
 */
export function WorkspaceHistoryControls() {
  const go = (direction: "back" | "forward") => {
    const shell = (
      window as { __ttNavGo?: (direction: "back" | "forward") => boolean }
    ).__ttNavGo;
    if (shell?.(direction)) return;
    if (direction === "back") window.history.back();
    else window.history.forward();
  };
  return (
    <>
      <ShortcutTooltip command="navigation.back" placement="bottom">
        <button
          type="button"
          className="workspace-round-button"
          aria-label="Go back"
          onClick={() => go("back")}
        >
          <HistoryChevron direction="back" />
        </button>
      </ShortcutTooltip>
      <ShortcutTooltip command="navigation.forward" placement="bottom">
        <button
          type="button"
          className="workspace-round-button"
          aria-label="Go forward"
          onClick={() => go("forward")}
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

export function focusSidebarRow(
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
/** Raised by the bar; the folder tree opens its inline name field. */
const NEW_FOLDER_EVENT = "texttext:new-folder";

function NewItemGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" />
      <path d="M8 5.5v5M5.5 8h5" />
    </svg>
  );
}

function NewFolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 5.25A1.75 1.75 0 0 1 4.25 3.5h2.6l1.4 1.5h3.5a1.75 1.75 0 0 1 1.75 1.75v4.5a1.75 1.75 0 0 1-1.75 1.75h-7.5A1.75 1.75 0 0 1 2.5 11.25z" />
      <path d="M8 7.5v3M6.5 9h3" />
    </svg>
  );
}

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
  onChangeItemType,
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
  onChangeItemType?: (folder: Folder) => void;
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
  useEffect(() => {
    const onNewFolder = (event: Event) => {
      const parentPath =
        (event as CustomEvent<{ parentPath?: string }>).detail?.parentPath ?? "";
      setCreatingUnder(parentPath);
      setNewName("");
      setError(null);
      if (parentPath) {
        const parent = foldersByPath.get(parentPath);
        if (parent) persistExpandedFolders(new Set(persistedExpanded).add(parent.id));
      }
    };
    window.addEventListener(NEW_FOLDER_EVENT, onNewFolder);
    return () => window.removeEventListener(NEW_FOLDER_EVENT, onNewFolder);
  }, [foldersByPath, persistedExpanded]);
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
            onMouseEnter={() => prefetchFolder(folder.path)}
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
                        onChangeItemType?.(folder);
                      }}
                    >
                      Change this look
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

  return (
    <>
      {creatingUnder === "" && (
        <div className="post-editor-new-folder-form" style={{ paddingLeft: 15 }}>
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
                void submitNewFolder("");
              } else if (event.key === "Escape") {
                setCreatingUnder(null);
                setNewName("");
              }
            }}
            onBlur={() => {
              if (!newName.trim()) setCreatingUnder(null);
            }}
            aria-label="New folder name"
          />
          {error && (
            <span className="post-editor-new-folder-error">{error}</span>
          )}
        </div>
      )}
      {tree.map((node) => renderNode(node, 0))}
    </>
  );
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
  onChangeItemType,
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
  onChangeItemType?: (folder: Folder) => void;
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
          onChangeItemType={onChangeItemType}
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
  onNewItem,
  onSettings,
  onBuildItemType,
  onChangeItemType,
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
  /** The bar's New item control; runs the workspace's create command. */
  onNewItem?: () => void;
  onSettings?: () => void;
  onBuildItemType?: (folder: Folder) => void;
  onChangeItemType?: (folder: Folder) => void;
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
  const [actionBarHost, setActionBarHost] = useState<HTMLDivElement | null>(
    null,
  );
  const { width: sidebarWidth, setWidth: setSidebarWidth } =
    useWorkspaceSidebarWidth();
  useLayoutEffect(() => {
    applySidebarWidthVariable(sidebarWidth);
  }, [sidebarWidth]);
  useLayoutEffect(() => {
    const content = document.querySelector<HTMLElement>(
      ".post-editor-shell .post-editor-content",
    );
    if (!content) return;

    const host = document.createElement("div");
    host.className = "workspace-action-bar-host";
    content.prepend(host);
    const frame = window.requestAnimationFrame(() => setActionBarHost(host));

    return () => {
      window.cancelAnimationFrame(frame);
      host.remove();
    };
  }, []);
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
      // Drag writes the layout variable directly; the store (and the React
      // re-render it triggers) commits once on release, so the drag itself
      // is pure style work. The resizing class suspends the content margin
      // transition (an eased margin chasing every pointer sample reflows
      // continuously and smears stale text pixels in WebKit) and the
      // sidebar's backdrop-filter (a blur layer moving live leaves repaint
      // artifacts); removing the class on release forces one clean
      // recomposite that clears any leftover pixels.
      document.documentElement.classList.add("is-sidebar-resizing");
      let lastWidth = startWidth;
      const onPointerMove = (moveEvent: PointerEvent) => {
        const viewportLimit = Math.max(
          WORKSPACE_SIDEBAR_MIN_WIDTH,
          window.innerWidth - 360,
        );
        lastWidth = clampSidebarWidth(
          Math.min(viewportLimit, startWidth + moveEvent.clientX - startX),
        );
        applySidebarWidthVariable(lastWidth);
      };
      const finish = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.documentElement.classList.remove("is-sidebar-resizing");
        setSidebarWidth(lastWidth);
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
          onChangeItemType={onChangeItemType}
          prefetchFolders={prefetchFolders}
          onToggleCollapsed={toggleSidebar}
          sharedCount={sharedCount}
          starredCount={starredCount}
          trashCount={trashCount}
        />
      </div>
      {/* Outside the sidebar region: its overflow clip cut the handle's
          hit area to a ~5px sliver, which read as "impossible to resize".
          Fixed-positioned on the width variable, it tracks a drag live. */}
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
      {actionBarHost ? (
        createPortal(
          <div className="workspace-action-bar ac-chrome" aria-label="Workspace controls">
            <nav
              className="workspace-history-chrome workspace-action-bar-slot is-left"
              aria-label="Workspace history"
            >
              <WorkspaceHistoryControls />
              <div className="workspace-action-bar-tools" role="group" aria-label="Create">
                {onNewItem && (
                  <button
                    type="button"
                    className="workspace-action-bar-tool"
                    title="New item (C)"
                    aria-label="New item"
                    onClick={onNewItem}
                  >
                    <NewItemGlyph />
                  </button>
                )}
                {canManageFolders && (
                  <button
                    type="button"
                    className="workspace-action-bar-tool"
                    title={activeFolder ? "New folder inside this folder" : "New folder"}
                    aria-label="New folder"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent(NEW_FOLDER_EVENT, {
                          detail: { parentPath: activeFolder ?? "" },
                        }),
                      )
                    }
                  >
                    <NewFolderGlyph />
                  </button>
                )}
              </div>
            </nav>
            <div
              className="workspace-action-bar-slot is-middle"
              aria-hidden="true"
            />
            <div className="workspace-action-bar-slot is-right" />
          </div>,
          actionBarHost,
        )
      ) : (
        <div className="workspace-history-chrome ac-chrome">
          <WorkspaceHistoryControls />
        </div>
      )}
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
