import type { Blog, PostType } from "@/lib/content";
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
};

export type CommandRunResult = void | Promise<void>;

export type CommandWorkspaceLevel =
  | "root"
  | "section"
  | "trash"
  | "shared"
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
  selectedSectionPath: string | null;
  selectedPostId: string | null;
  getRootSectionPaths: () => string[];
  getVisiblePostIds: () => string[];
  getPost: (postId: string) => WorkspacePoolPost | null;
  selectPost: (postId: string | null) => void;
  selectSection: (folderPath: string | null) => void;
  selectSpatial: (direction: SpatialDirection) => void;
  selectNext: () => void;
  selectPrevious: () => void;
  openSelected: () => void;
  openItemByIndex: (index: number) => void;
  openSectionByIndex: (index: number) => void;
  openPost: (postId: string, mode?: "read" | "edit") => void;
  editCurrent: () => void;
  stopEditing: () => void;
  requestDeleteTarget: () => void;
  scrollReader: (direction: "up" | "down", amount: "line" | "half" | "page") => void;
  scrollReaderEdge: (edge: "top" | "bottom") => void;
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
  closePalette: () => void;
  toast: (
    message: string,
    action?: { label: string; run: () => void },
  ) => void;
};

export type AppCommand = {
  id: string;
  label: string;
  group: string;
  shortcut?: CommandShortcut | CommandShortcut[];
  showInShortcutSheet?: boolean;
  when: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => CommandRunResult;
};

export type CreatePostKind = Extract<PostType, "article" | "note" | "bookmark">;

export type DynamicCommandFactory = (ctx: CommandContext) => AppCommand[];
