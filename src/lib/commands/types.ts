import type { Appearance } from "@/lib/workspace/appearance";
import type { Blog, ItemKind } from "@/lib/content";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";

export type CommandShortcut = {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  label: string;
  allowTypingTarget?: boolean;
  requiresWorkspace?: boolean;
  /** One-shot: do NOT run again on key auto-repeat. The DEFAULT is that a
   * held key repeats, like every native app; only commands that would misfire
   * on repeat (create, delete, toggles, dialogs) opt out. Keys must never be
   * swallowed silently - a repeat on a one-shot is still preventDefaulted so
   * the browser does not act on it either, but nothing else is eaten. */
  once?: boolean;
  /** Do not intercept while the reader's scroller is focused: the browser's
   * own key scrolling (with native auto-repeat and animation) is the exact
   * behavior wanted, and interception replaced it with single jumps. */
  nativeWhenReaderFocused?: boolean;
};

type CommandRunResult = void | Promise<void>;

type CommandWorkspaceLevel =
  | "root"
  | "section"
  | "trash"
  | "shared"
  | "starred"
  | "settings"
  | "post"
  | "edit";

export type SpatialDirection = "up" | "down" | "left" | "right";

export type CommandWorkspaceSurface = {
  blog: Blog;
  handle: string;
  homePath: string;
  viewLevel: CommandWorkspaceLevel;
  canCreate: boolean;
  canEdit: boolean;
  canManagePost: boolean;
  activeFolderPath: string | null;
  activePostId: string | null;
  /** Source of the open document's body, for the outline. The pool's list
   * projection deliberately carries no body, and the command context does not
   * always have a pool at all, so the shell hands it over directly. */
  getActiveDocumentBody?: () => string | null;
  selectedSectionPath: string | null;
  selectedPostId: string | null;
  selectedPostIds: readonly string[];
  getRootSectionPaths: () => string[];
  getNavigationTargetPaths: () => string[];
  getVisiblePostIds: () => string[];
  getPost: (postId: string) => WorkspacePoolPost | null;
  selectPost: (postId: string | null) => void;
  selectSection: (folderPath: string | null) => void;
  selectSpatial: (direction: SpatialDirection) => void;
  extendSelection: (direction: -1 | 1) => void;
  /** Cmd+A over a list: select everything shown. */
  selectAllVisible: () => void;
  /** Home / End, or Cmd+Up / Cmd+Down: jump to the ends of the list. */
  selectEdge: (edge: "first" | "last") => void;
  /** Cmd+D: copies of the selected items, beside them. */
  duplicateSelected: () => void;
  /** Cmd+C then Cmd+V: remember a selection, then copy it in here. */
  copySelection: () => void;
  pasteCopied: () => void;
  /** Escape from a selection of many back to one. */
  clearSelection: () => void;
  /** Cycle light, dark, system. */
  cycleAppearance: () => void;
  /** Set the appearance outright (the palette lists all three). */
  setAppearance: (appearance: Appearance) => void;
  /** The stored appearance, for the palette to mark the current choice. */
  currentAppearance?: () => Appearance;
  /** An item is open for reading and its pane can scroll. */
  readerScrollable: () => boolean;
  selectNext: () => void;
  selectPrevious: () => void;
  openSelected: () => void;
  openItemByIndex: (index: number) => void;
  navigateToNavTargetByIndex: (index: number) => void;
  openSectionByIndex: (index: number) => void;
  openPost: (postId: string, mode?: "read" | "edit") => void;
  editCurrent: () => void;
  stopEditing: () => void;
  requestDeleteTarget: (postIds?: readonly string[]) => void;
  toggleStarSelected: () => void;
  scrollReader: (direction: "up" | "down", amount: "line" | "half" | "page") => void;
  scrollReaderEdge: (edge: "top" | "bottom") => void;
  /** True while the reader's scroll container holds focus, so shortcuts
   * marked nativeWhenReaderFocused can defer to native key scrolling. */
  readerScrollerFocused: () => boolean;
  readerTapG: () => void;
  openAdjacentPost: (direction: 1 | -1) => void;
  createItem?: (kind: CreatePostKind) => void;
  openCreatedPost?: (post: WorkspacePoolPost) => void;
  reconcileCreatedPost?: (
    temporaryPostId: string,
    savedPost: WorkspacePoolPost,
  ) => void;
  openFolder: (folderPath: string) => void;
  navigateRoot: () => void;
  navigateUp: () => boolean;
  navigateForward: () => boolean;
  /** Close the open document's tab and land on its neighbour. */
  closeActiveTab?: () => void;
  /** Open a document as a background tab, leaving the current one open. */
  openInNewTab?: (postId: string) => void;
  /** Bring back the most recently closed tab and go to it. */
  reopenClosedTab?: () => void;
  /** Move to the tab `step` places away, wrapping. */
  cycleTab?: (step: number) => void;
  escapeCurrent: () => boolean;
  focusSearch: () => void;
  openSettings: () => void;
  afterDelete: (postId: string) => void;
  startBookmarkCreate?: () => void;
};

export type CommandContext = {
  pool: WorkspacePoolPayload | null;
  workspace: CommandWorkspaceSurface | null;
  navigate: (path: string) => void;
  refresh: () => void;
  openPalette: (query?: string) => void;
  openShortcuts: () => void;
  openAddAgent?: (postId: string) => void;
  closePalette: () => void;
  /**
   * `report` (the default) is the app telling you what it just did, in a
   * dark pill at the bottom left. `hint` is the app teaching you the way
   * back - "Changed your mind? Hit esc" - which is a different kind of
   * sentence and should not look like a receipt.
   */
  toast: (
    message: string,
    action?: { label: string; run: () => void },
    tone?: "report" | "hint",
  ) => void;
};

export type AppCommand = {
  id: string;
  label: string;
  group: string;
  shortcut?: CommandShortcut | CommandShortcut[];
  showInShortcutSheet?: boolean;
  /**
   * Whether the palette lists this command. False for the numbered families
   * (⌘1-⌘9 and 1-9): eighteen rows of "Open navigation target 4" bury the
   * commands someone is actually hunting for, and nobody reaches the fourth
   * sidebar target by searching for it. They stay on the keyboard and in the
   * shortcut sheet, which is where a numbered range belongs.
   */
  showInPalette?: boolean;
  when: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => CommandRunResult;
};

export type CreatePostKind = Extract<ItemKind, "article" | "note" | "bookmark">;
