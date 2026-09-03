"use client";

import {
  getWorkspaceSelection,
  setWorkspaceSelection,
  subscribeWorkspaceSelection,
  type WorkspaceSelectionState,
} from "@/lib/workspace/selection-store";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  createFolderItemAction,
  createWorkspacePostAction,
  deleteEditablePostAction,
  movePostToFolderAction,
  toggleEditablePostStarredAction,
  trashFolderAction,
} from "@/app/editor/actions";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { readItemTypeForEditAction } from "@/app/editor/item-type-actions";
import type { ItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import {
  useWorkspaceCommandSurface,
} from "@/components/keyboard/CommandLayer";
import {
  type FolderCaptureResolved,
  type FolderCreateItem,
  type FolderDeleteItem,
} from "@/components/FolderPage";
import {
  PostActionBar,
} from "@/components/PostActionBar";
import { UpdatedBuildNotice } from "@/components/workspace/UpdatedBuildNotice";

const ItemTypeStudio = dynamic(() =>
  import("@/components/workspace/ItemTypeStudio").then(
    (module) => module.ItemTypeStudio,
  ),
);


import {
  createOptimisticWorkspacePost,
  mergeCreatedWorkspacePost,
  nextWorkspacePostAfterDelete,
  shouldOpenWorkspacePostInEdit,
  useLocalWorkspaceItemIdentity,
} from "@/components/workspace/useLocalWorkspaceInteraction";
import {
  AssistantSidebar,
  type AssistantSidebarState,
} from "@/components/workspace/assistant";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { AssistantConversationState } from "@/components/workspace/assistant/AssistantConversationState";
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
import {
  conversationIdFromThreadKey,
  useNativeAssistant,
} from "@/components/workspace/assistant/useNativeAssistant";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import {
  openWorkspaceItemDraftRevision,
  patchOpenWorkspaceItemDraftIfCurrent,
  readOpenWorkspaceItemDraft,
  readOpenWorkspaceItemSelection,
  subscribeOpenWorkspaceItemDrafts,
  type WorkspaceItemTextPatch,
  type WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";
import type {
  Blog,
  Folder,
  FolderMode,
  Post,
  ItemKind,
} from "@/lib/content";
import {
  findPoolPostById,
  folderPathForPoolPost,
  narrowPostFromPost,
  poolPostsForFolder,
  postFromPoolPost,
  starredPoolPosts,
} from "@/lib/pool/selectors";
import {
  addPost,
  acknowledgePost,
  acknowledgePostDocument,
  ensurePostDocument,
  prefetchPostDocument,
  getCachedWorkspacePostDocument,
  getWorkspacePost,
  markPostDirty,
  moveFolderToTrash,
  movePost,
  movePostToTrash,
  refreshWorkspacePool,
  removePost,
  restoreFolderFromTrash,
  restorePostFromTrash,
  replacePost,
  updatePost,
  updatePostDocument,
  useWorkspacePool,
} from "@/lib/pool/store";
import { WorkspaceProvider } from "@/lib/pool/WorkspaceProvider";
import { useWorkspaceLiveSync } from "@/lib/pool/useWorkspaceLiveSync";
import type {
  WorkspaceInitialDocument,
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import {
  blogWorkspacePostEditPath,
  blogWorkspacePostPath,
} from "@/lib/public-paths";
import {
  initialDraft,
  isPlaceholderSlug,
  payloadFor,
  payloadKey,
  slugify,
  uniqueSlug,
} from "@/lib/post-edit-draft";
import type { SpatialDirection } from "@/lib/commands/types";
import type { AgentFocusEvent } from "@/lib/collab/agent-focus";
import type { AdjacentPublishedPosts } from "@/lib/store";
import {
  markdownSubtitle,
  replaceMarkdownSubtitle,
} from "@/lib/markdown-subtitle";
import {
  SHARED_FOLDER_PATH,
  STARRED_FOLDER_PATH,
  TRASH_FOLDER_PATH,
} from "@/lib/workspace-paths";
import {
  disarmWorkspaceHover,
} from "@/lib/workspace-hover";
import {
  cssAttributeValue,
  currentLocalView,
  folderWorkspaceHref,
  isOptimisticPostId,
  localViewActiveFolder,
  localWorkspaceViewDepth,
  rootSectionFolders,
  selectedPostIdForView,
  spatialNeighbor,
  validRootSectionPath,
  viewFromUrl,
  visibleWorkspaceItems,
  workspaceRootHref,
  workspaceSettingsHref,
  type LocalWorkspaceView,
  type SidebarFolderId,
  type WorkspaceActiveRegion,
} from "@/lib/workspace/local-view";
import {
  bumpLocalDraftRevision,
  documentWithUpdatedBody,
  localDraftRevision,
  localWorkspaceDraftRevisions,
  localWorkspaceDraftSessions,
  localWorkspacePendingSaveIds,
  localWorkspaceServerRevisions,
  mergeDraftIntoWorkspacePost,
  persistLocalWorkspaceDraft,
  transferLocalDraftRevision,
  updateCachedDocumentBody,
} from "@/lib/workspace/draft-sessions";
import { registerWorkspaceRowCommands } from "@/lib/workspace/command-bus";
import {
  WORKSPACE_COMPACT_MEDIA_QUERY,
  WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  WorkspaceSidebarChrome,
  focusSidebarRow,
  setWorkspaceAssistantState,
  setWorkspaceAssistantWidth,
  useWorkspaceAssistantPreferences,
  useWorkspaceSidebarCollapsed,
} from "@/components/workspace/WorkspaceSidebarChrome";
import { useClientHydrated } from "@/lib/use-client-hydrated";
import {
  WorkspaceSelectionToolbar,
  runTrashOperation,
} from "@/components/workspace/WorkspaceSpecialPages";
import {
  collaboratorColor,
} from "@/components/workspace/WorkspaceItemViews";
import { LocalWorkspaceContent } from "@/components/workspace/WorkspaceRootPages";
import {
  rememberedRootFolderPath,
  rootFolderPathForSelection,
  shouldClearWorkspaceSelection,
  shouldMoveSelectionIntoSidebar,
  workspaceEscapeTarget,
  workspaceHrefWithSearchReturn,
  workspaceHierarchyUpTarget,
  workspaceSearchHref,
  type WorkspaceSearchLocation,
} from "@/lib/workspace-navigation";
import { beginMeasuredEditTransition } from "@/lib/edit-transition";
import {
  deletePersistedWorkspaceDraft,
} from "@/lib/pool/storage";
import {
  extendSelectionByKeyboard,
  marqueeSelectionIds,
  selectionFromClick,
  type SelectionRectangle,
} from "@/lib/workspace-selection";
import { homeFolderModeForPostType } from "@/lib/workspace-item-presentation";
import {
  recordWorkspaceDocumentOpened,
} from "@/lib/workspace-activity";

/** A folder's workspace-unique path segment, e.g. "blog" or "notes". */
export type { SidebarFolderId } from "@/lib/workspace/local-view";

type AdjacentPosts = AdjacentPublishedPosts;

function beginEditTransition(postId: string) {
  if (typeof document === "undefined" || typeof performance === "undefined")
    return;
  beginMeasuredEditTransition(
    document.documentElement.dataset,
    postId,
    performance.now(),
  );
}

const STOP_LOCAL_EDITING_EVENT = "texttext:stop-local-editing";

export function sidebarFolderPathForPostType(type: ItemKind): SidebarFolderId {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
}

/**
 * Run a view change inside a sliding view transition when the platform has
 * the API: push slides the new view in from the right over the old one,
 * pop slides the old view out to the right revealing the new beneath -
 * the native drill-in/drill-out grammar. Direction null (same depth, e.g.
 * folder switch or read/edit mode change) and reduced motion apply the
 * change instantly. The pseudo-element animations live in workspace.css
 * under html[data-nav-transition].
 */
let viewTransitionsBroken = false;
// Set while an interactive swipe drives history: the drag paints its own
// motion (a tracked clone), so the popstate that its history call triggers
// must apply the view instantly, not run a second slide on top.
let navAnimationSuppressed = false;

/**
 * The single-layer slide: the live content element eases in from the
 * incoming direction. Used where the two-layer view transition cannot run -
 * notably the Mac app, whose WKWebView exposes startViewTransition and
 * swaps correctly but never runs the pseudo-element animations (measured:
 * an 800ms transition "finishes" in 7ms), so the API path looks exactly
 * like no animation at all.
 */
function animateContentSlide(direction: "push" | "pop") {
  const content = document.querySelector<HTMLElement>(".post-editor-content");
  content?.animate(
    [
      {
        transform: `translateX(${direction === "push" ? 96 : -96}px)`,
        opacity: 0.55,
      },
      { transform: "translateX(0)", opacity: 1 },
    ],
    { duration: 220, easing: "cubic-bezier(.2,.75,.25,1)" },
  );
}

function runViewTransition(direction: "push" | "pop" | null, apply: () => void) {
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => {
      finished: Promise<void>;
      skipTransition?: () => void;
    };
  };
  if (!direction || navAnimationSuppressed) {
    apply();
    return;
  }
  // Deliberately NOT gated on prefers-reduced-motion: the owner runs
  // macOS with Reduce Motion on and wants these slides anyway (owner
  // decision, 2026-09-02). The navigation slide is spatial feedback, not
  // decoration.
  if (
    viewTransitionsBroken ||
    typeof doc.startViewTransition !== "function" ||
    (window as { __TEXTTEXT_APP__?: boolean }).__TEXTTEXT_APP__ === true
  ) {
    // Commit synchronously so the slide runs on the NEW view. A plain
    // apply() is an async React update, so animating right after it slid
    // the OLD content for a frame before the swap - which read as no slide
    // at all. flushSync lands the new view first, then it slides in.
    flushSync(apply);
    animateContentSlide(direction);
    return;
  }
  // Navigation must NEVER depend on the transition machinery. Everything
  // below is arranged so that a broken implementation (a callback that
  // never runs, a finished promise that never settles, a compositor that
  // freezes on the captured snapshot - WKWebView is not Safari) costs one
  // watchdog interval once, applies the change anyway, and turns the
  // decoration off for the rest of the session.
  let applied = false;
  const applyOnce = () => {
    if (applied) return;
    applied = true;
    apply();
  };
  const cleanup = () => {
    if (document.documentElement.dataset.navTransition === direction) {
      delete document.documentElement.dataset.navTransition;
    }
  };
  document.documentElement.dataset.navTransition = direction;
  let transition: { finished: Promise<void>; skipTransition?: () => void };
  try {
    transition = doc.startViewTransition(() => {
      flushSync(applyOnce);
    });
  } catch {
    cleanup();
    applyOnce();
    return;
  }
  // Two hang modes, two verdicts. A callback that never ran means the
  // navigation itself was eaten - skip, apply, and stop trusting the
  // implementation for this session. A callback that ran but whose finish
  // lags just means a busy main thread (hydration, a heavy first paint);
  // clean up the direction attribute and let it settle - one slow frame
  // must not cost the whole session its slides.
  const watchdog = window.setTimeout(() => {
    if (!applied) {
      viewTransitionsBroken = true;
      try {
        transition.skipTransition?.();
      } catch {
        /* teardown is best-effort */
      }
      applyOnce();
    }
    cleanup();
  }, 600);
  void transition.finished
    .catch(() => {})
    .then(() => {
      window.clearTimeout(watchdog);
      applyOnce();
      cleanup();
    });
}

/** Which list views keep a remembered scroll position (item views manage
 * their own). Search memory is per query so a new search starts at the top. */
function viewScrollMemoryKey(view: LocalWorkspaceView): string | null {
  if (view.level === "post" || view.level === "edit") return null;
  if (view.level === "root") return "root";
  if (view.level === "search") return `search:${view.source}:${view.query}`;
  if (view.level === "settings") return "settings";
  return `${view.level}:${view.folderPath}`;
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
  initialAssistantState,
  initialAssistantWidth,
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
  initialAssistantState?: AssistantSidebarState;
  initialAssistantWidth?: number;
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
  const displayPoolRef = useRef(displayPool);
  const loadItemTypeStudioPreviewDocuments = useCallback(
    async (folderPath: string) => {
      const currentPool = displayPoolRef.current;
      const candidates = currentPool.posts
        .filter(
          (post) => folderPathForPoolPost(currentPool, post) === folderPath,
        )
        .slice(0, 12);
      await Promise.all(
        candidates.map((post) =>
          ensurePostDocument(currentPool.blogId, post.id),
        ),
      );
      return candidates.flatMap((post) => {
        const cached = getCachedWorkspacePostDocument(
          currentPool.blogId,
          post.id,
        );
        return cached
          ? [{ folderPath, document: cached.document }]
          : [];
      });
    },
    [],
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef<{
    left: number;
    top: number;
  } | null>(null);
  // Where each list view's scroller sat when the person left it. Back or
  // forward returns to that spot instead of the top; a top reset behind
  // WebKit's swipe snapshot reads as a full page refresh.
  const contentScrollMemoryRef = useRef(new Map<string, number>());
  // Our position in the session's history, so the swipe drag knows whether a
  // back target (index > 0) or forward target (index < max) exists before it
  // commits to a direction. Every pushState carries the index in state.
  const navIndexRef = useRef(0);
  const navMaxRef = useRef(0);
  const cancelledOptimisticPostIdsRef = useRef(new Set<string>());
  const gTapRef = useRef(0);
  const initialUrlSyncedRef = useRef(false);
  // Warm the documents the person is most likely to open next, off the
  // critical path. Opening an item whose body is not local shows a skeleton
  // for a network round trip; after this, the recent items open with their
  // content already in hand. ensurePostDocument dedupes, so overlap with the
  // hover prefetch costs nothing.
  useEffect(() => {
    const warm = () => {
      const recent = [...initialPool.posts]
        .sort((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        )
        .slice(0, 8);
      for (const post of recent) prefetchPostDocument(post.id);
    };
    const idle = (
      window as unknown as {
        requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const handle = idle
      ? idle(warm, { timeout: 3000 })
      : window.setTimeout(warm, 1200);
    return () => {
      if (idle) {
        (window as unknown as { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback?.(handle as number);
      } else {
        window.clearTimeout(handle as number);
      }
    };
    // One warm pass per workspace; the pool identity is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPool.blogId]);
  const mounted = typeof window !== "undefined";
  const viewRef = useRef(view);
  const initialSelectedPostId = selectedPostIdForView(initialPool, initialView);
  // Selection lives in the module store (see selection-store.ts) so writers
  // do not re-render this whole component. The shell still subscribes for
  // now; leaf components carry their own subscriptions.
  const [] = useState(() => {
    if (typeof window !== "undefined") {
      setWorkspaceSelection({
        activeId: initialSelectedPostId,
        anchorId: initialSelectedPostId,
        ids: new Set(initialSelectedPostId ? [initialSelectedPostId] : []),
      });
    }
    return null;
  });
  const serverSelection = useMemo<WorkspaceSelectionState>(
    () => ({
      activeId: initialSelectedPostId,
      anchorId: initialSelectedPostId,
      ids: new Set(initialSelectedPostId ? [initialSelectedPostId] : []),
    }),
    [initialSelectedPostId],
  );
  const workspaceSelection = useSyncExternalStore(
    subscribeWorkspaceSelection,
    getWorkspaceSelection,
    () => serverSelection,
  );
  const selectedPostId = workspaceSelection.activeId;
  const selectedPostIds = workspaceSelection.ids as Set<string>;
  const setSelectedPostId = useCallback(
    (
      next: string | null | ((current: string | null) => string | null),
    ) => {
      const value =
        typeof next === "function"
          ? next(getWorkspaceSelection().activeId)
          : next;
      setWorkspaceSelection({ activeId: value });
    },
    [],
  );
  const setSelectedPostIds = useCallback(
    (next: Set<string> | ((current: Set<string>) => Set<string>)) => {
      const value =
        typeof next === "function"
          ? next(new Set(getWorkspaceSelection().ids))
          : next;
      setWorkspaceSelection({ ids: value });
    },
    [],
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
  /**
   * A look opened to be changed, rather than a new one being made.
   *
   * Reading it is a round trip, and it can answer "this one was not designed
   * here", so the studio opens on what came back rather than on an assumption.
   */
  /**
   * Why a look could not be reopened, when it could not.
   *
   * Said out loud rather than by opening an editor on nothing: a built-in, an
   * import, a duplicate and a look designed by an older version of the
   * designer each fail for a different reason, and each is a different thing
   * to tell someone.
   */
  const [lookNotice, setLookNotice] = useState<string | null>(null);
  const [itemTypeStudioEditing, setItemTypeStudioEditing] = useState<{
    templateId: string;
    baseVersion: number;
    blueprint: ItemTypeBlueprint;
  } | null>(null);
  const [itemTypeStudioFolderPath, setItemTypeStudioFolderPath] = useState<
    string | null
  >(null);
  const { state: assistantState, width: assistantWidth } =
    useWorkspaceAssistantPreferences(initialAssistantState, initialAssistantWidth);
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
    // Peeking only exists for a collapsed sidebar; the cleanup below clears
    // it whenever the sidebar expands and this binding unwinds.
    if (!sidebarCollapsed) return;
    let peeking = false;
    let sidebarWidth = WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
    const setPeeking = (next: boolean) => {
      if (peeking === next) return;
      peeking = next;
      setLeftEdgePeeking(next);
    };
    const trackEdges = (event: PointerEvent) => {
      // The common case - mouse anywhere but the left edge, not peeking -
      // must cost nothing. This handler runs on EVERY pointermove, and it
      // used to read getComputedStyle (a forced style recalculation),
      // getSelection and matchMedia each time; on a 120Hz pointer that was a
      // steady tax on hover framerate.
      if (!peeking && event.clientX > 24) return;
      if (
        event.buttons !== 0 ||
        marqueeRectangle ||
        window.matchMedia(WORKSPACE_COMPACT_MEDIA_QUERY).matches
      ) {
        setPeeking(false);
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        setPeeking(false);
        return;
      }
      if (!peeking) {
        sidebarWidth =
          Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--workspace-sidebar-width",
            ),
          ) || WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
      }
      setPeeking(
        event.clientX <= 24 || (peeking && event.clientX <= sidebarWidth),
      );
    };
    const clearPeeks = () => setPeeking(false);
    window.addEventListener("pointermove", trackEdges, { passive: true });
    window.addEventListener("blur", clearPeeks);
    return () => {
      window.removeEventListener("pointermove", trackEdges);
      window.removeEventListener("blur", clearPeeks);
      setLeftEdgePeeking(false);
    };
  }, [marqueeRectangle, sidebarCollapsed]);

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
      setWorkspaceSelection({ anchorId: anchorId });
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
    setWorkspaceSelection({ anchorId: postId });
    setSelectedPostId(postId);
    setSelectedPostIds(new Set(postId ? [postId] : []));
    if (postId) {
      lastActivePostIdRef.current = postId;
      bodySelectionActiveRef.current = true;
      setSelectedSectionPath(null);
    }
  }, []);

  const clearPostSelection = useCallback(() => {
    setWorkspaceSelection({ anchorId: null });
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
    const existingIndex = (window.history.state as { ttNavIndex?: number } | null)
      ?.ttNavIndex;
    if (typeof existingIndex === "number") {
      navIndexRef.current = existingIndex;
      navMaxRef.current = Math.max(navMaxRef.current, existingIndex);
    } else {
      window.history.replaceState({ ttNavIndex: 0 }, "");
    }
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

  // Record list scroll continuously rather than at navigation time: opening
  // a note swaps the folder surface for the warmed editor surface, which
  // collapses the scroller and clamps scrollTop to 0 before any
  // navigation-time read could see the real position. The clamp guard skips
  // exactly that state (nothing scrollable = nothing worth remembering).
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const record = () => {
      const key = viewScrollMemoryKey(viewRef.current);
      if (!key) return;
      if (content.scrollHeight <= content.clientHeight + 4) return;
      contentScrollMemoryRef.current.set(key, content.scrollTop);
    };
    content.addEventListener("scroll", record, { passive: true });
    return () => content.removeEventListener("scroll", record);
  }, []);

  // Put a returning list view back where it was, before paint. If the
  // surface is still collapsed on the first attempt (a hidden-surface swap
  // settling), retry across a few frames rather than losing the position.
  useLayoutEffect(() => {
    const key = viewScrollMemoryKey(view);
    if (!key) return;
    const saved = contentScrollMemoryRef.current.get(key);
    if (saved === undefined || saved === 0) return;
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const content = contentRef.current;
      if (!content) return;
      content.scrollTop = saved;
      if (Math.abs(content.scrollTop - saved) <= 1 || tries >= 3) return;
      tries += 1;
      frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [view]);

  const openedPostId =
    view.level === "post" || view.level === "edit" ? view.postId : null;
  useEffect(() => {
    if (!openedPostId) return;
    recordWorkspaceDocumentOpened(displayPool.blog.handle, openedPostId);
  }, [displayPool.blog.handle, openedPostId]);

  // Reading keys work like the browser's: Space, Shift+Space, PageUp/Down,
  // Home/End and the arrows scroll natively only when the scrolling element
  // itself has focus. Opening a READ view leaves focus on the clicked list
  // row (where Space would re-activate the button); hand it to the scroller.
  // Edit views keep their own focus - the editor claims the caret.
  const readViewPostId = view.level === "post" ? view.postId : null;
  useEffect(() => {
    if (!readViewPostId) return;
    const content = contentRef.current;
    if (!content) return;
    const active = document.activeElement;
    // Never steal focus from a field the person is typing in.
    if (
      active instanceof HTMLElement &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA")
    ) {
      return;
    }
    content.focus({ preventScroll: true });
  }, [readViewPostId]);

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
      navIndexRef.current += 1;
      navMaxRef.current = navIndexRef.current;
      window.history.pushState({ ttNavIndex: navIndexRef.current }, "", href);
      const previousDepth = localWorkspaceViewDepth(previousView);
      const nextDepth = localWorkspaceViewDepth(nextView);
      const direction =
        nextDepth > previousDepth
          ? ("push" as const)
          : nextDepth < previousDepth
            ? ("pop" as const)
            : null;
      runViewTransition(direction, () => {
        viewRef.current = nextView;
        setView(nextView);
        const nextSelectedPostId =
          "selectedPostId" in options
            ? (options.selectedPostId ?? null)
            : selectedPostIdForView(displayPoolRef.current, nextView);
        setSelectedPostId(nextSelectedPostId);
        setWorkspaceSelection({ anchorId: nextSelectedPostId });
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
      });
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
      window.history.replaceState({ ttNavIndex: navIndexRef.current }, "", href);
      viewRef.current = nextView;
      setView(nextView);
      const nextSelectedPostId =
        "selectedPostId" in options
          ? (options.selectedPostId ?? null)
          : selectedPostIdForView(displayPoolRef.current, nextView);
      setSelectedPostId(nextSelectedPostId);
      setWorkspaceSelection({ anchorId: nextSelectedPostId });
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

  const pendingOpenTokenRef = useRef(0);
  const openPoolPost = useCallback(
    function openPoolPostSelf(
      post: WorkspacePoolPost,
      folderPath?: string,
      mode: "read" | "edit" = "read",
      force = false,
    ) {
      // Keep edit transitions inside the workspace shell so existing notes and
      // posts feel instant; the URL still mirrors the canonical edit route.
      //
      // The view switches ONLY once the document is locally available, so an
      // opened item always appears fully formed - never a skeleton, never an
      // empty surface that populates a beat later (owner, 2026-09-02: that
      // reads as ghosting). Hover/selection prefetch and the idle warm make
      // the ready path the common one; a cold document holds the current
      // view for the fetch (typically well under 100ms) and then swaps
      // atomically.
      const currentPool = displayPoolRef.current;
      const warmedBody =
        getCachedWorkspacePostDocument(currentPool.blogId, post.id)?.document
          .content.body ??
        currentPool.initialDocuments?.find(
          (document) => document.postId === post.id,
        )?.document.content.body;
      const documentLocallyAvailable =
        warmedBody !== undefined ||
        Boolean(post.document) ||
        isOptimisticPostId(post.id);
      if (!documentLocallyAvailable && !force) {
        const token = ++pendingOpenTokenRef.current;
        void ensurePostDocument(currentPool.blogId, post.id)
          .catch(() => {})
          .then(() => {
            if (pendingOpenTokenRef.current !== token) return;
            // force: a failed fetch must still open (the error body says
            // why) rather than silently eating the click.
            openPoolPostSelf(post, folderPath, mode, true);
          });
        return;
      }
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
              const mergedDocument = merged.document;
              if (!mergedDocument) {
                throw new Error("Created item did not retain its document");
              }
              updatePostDocument(
                pool.blogId,
                merged.id,
                documentWithUpdatedBody(mergedDocument, liveDraft.body),
              );
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
              if (getWorkspaceSelection().anchorId === temp.id) {
                setWorkspaceSelection({ anchorId: merged.id });
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
        getWorkspaceSelection().anchorId &&
        !visibleIds.has(getWorkspaceSelection().anchorId!)
      ) {
        setWorkspaceSelection({ anchorId: null });
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

      let document = getCachedWorkspacePostDocument(
        currentPool.blogId,
        postId,
      )?.document;
      if (!document) {
        await ensurePostDocument(currentPool.blogId, postId);
        document =
          getCachedWorkspacePostDocument(currentPool.blogId, postId)
            ?.document ??
          currentPool.initialDocuments?.find(
            (candidate) => candidate.postId === postId,
          )?.document;
      }
      if (!document) throw new Error("Could not load the item document");
      const body = document.content.body;
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
        updateCachedDocumentBody(currentPool.blogId, postId, nextDraft.body);
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
          const document = getCachedWorkspacePostDocument(
            currentPool.blogId,
            postId,
          )?.document;
          if (document) {
            acknowledgePostDocument(
              currentPool.blogId,
              postId,
              documentWithUpdatedBody(document, nextDraft.body),
              poolPost.revision,
              savedAt,
            );
          }
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
            const restoredDocument = updateCachedDocumentBody(
              currentPool.blogId,
              postId,
              currentText.body,
            );
            if (!existingDraft) {
              acknowledgePost(postId);
              acknowledgePostDocument(
                currentPool.blogId,
                postId,
                restoredDocument,
                poolPost.revision,
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
        anchorId: getWorkspaceSelection().anchorId,
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

  // Row-level commands as a bus: rows call these at event time instead of
  // receiving them as props through three layers (see command-bus.ts).
  // Latest-refs because several handlers are defined later in this
  // component; the bus registration itself happens once.
  const handleItemClickRef = useRef(handleItemClick);
  const openPostIdRef = useRef<(postId: string, mode?: "read" | "edit") => void>(
    () => {},
  );
  const activatePostSelectionRef = useRef<(postId: string) => void>(() => {});
  const navigateTagRef = useRef<(tag: string) => void>(() => {});
  const deleteWorkspaceItemRef = useRef<
    ((post: Post) => void | Promise<void>) | null
  >(null);
  const activateRegionRef = useRef<(region: WorkspaceActiveRegion) => void>(
    () => {},
  );
  useEffect(
    () =>
      registerWorkspaceRowCommands({
        itemClick: (postId, event) => handleItemClickRef.current(postId, event),
        openPost: (postId, mode) => openPostIdRef.current(postId, mode),
        selectPost: (postId) => {
          activateRegionRef.current("body");
          activatePostSelectionRef.current(postId);
        },
        openTag: (tag) => navigateTagRef.current(tag),
        requestDeletePost: (post) => deleteWorkspaceItemRef.current?.(post),
      }),
    // Registered once; handlers dereference live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    handleItemClickRef.current = handleItemClick;
    openPostIdRef.current = openPostId;
    activatePostSelectionRef.current = activatePostSelection;
    navigateTagRef.current = navigateTag;
    deleteWorkspaceItemRef.current = deleteWorkspaceItem;
    activateRegionRef.current = activateRegion;
  });

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
        anchorId: getWorkspaceSelection().anchorId,
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
    const applyPopStateView = (nextView: LocalWorkspaceView) => {
      const previousView = viewRef.current;
      if (
        previousView.level === "edit" &&
        (nextView.level !== "edit" || nextView.postId !== previousView.postId)
      ) {
        window.dispatchEvent(new Event(STOP_LOCAL_EDITING_EVENT));
      }
      const previousDepth = localWorkspaceViewDepth(previousView);
      const nextDepth = localWorkspaceViewDepth(nextView);
      const direction =
        nextDepth > previousDepth
          ? ("push" as const)
          : nextDepth < previousDepth
            ? ("pop" as const)
            : null;
      runViewTransition(direction, () => {
        viewRef.current = nextView;
        setView(nextView);
        const nextSelectedPostId = selectedPostIdForView(displayPool, nextView);
        setWorkspaceSelection({ anchorId: nextSelectedPostId });
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
      });
    };
    const onPopState = () => {
      disarmWorkspaceHover();
      const landedIndex = (window.history.state as { ttNavIndex?: number } | null)
        ?.ttNavIndex;
      if (typeof landedIndex === "number") navIndexRef.current = landedIndex;
      const nextView = currentLocalView(displayPool, homePath);
      // History traversal into an item must hold the current view until the
      // document is local, exactly like a click-open: switching immediately
      // rendered the reader's nothing-yet branch, which is a white page for
      // however long the fetch takes (a swipe-forward in the Mac app made
      // this a visible, sometimes long, blank).
      if (nextView.level === "post" || nextView.level === "edit") {
        const post = findPoolPostById(displayPool, nextView.postId);
        const warmed =
          getCachedWorkspacePostDocument(displayPool.blogId, nextView.postId) ??
          displayPool.initialDocuments?.find(
            (document) => document.postId === nextView.postId,
          );
        const documentLocallyAvailable =
          Boolean(warmed) ||
          Boolean(post?.document) ||
          isOptimisticPostId(nextView.postId);
        if (post && !documentLocallyAvailable) {
          const token = ++pendingOpenTokenRef.current;
          void ensurePostDocument(displayPool.blogId, nextView.postId)
            .catch(() => {})
            .then(() => {
              if (pendingOpenTokenRef.current !== token) return;
              applyPopStateView(nextView);
            });
          return;
        }
      }
      applyPopStateView(nextView);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [displayPool, homePath]);

  // Interactive back/forward swipe. The Mac shell (AppWebView.scrollWheel)
  // recognizes the gesture from NSEvent - real phase and per-frame finger
  // translation, which the DOM wheel stream lacks - and calls
  // window.__ttNavSwipe with begin/move/end plus cumulative finger travel in
  // points. The page paints the reveal with iOS/Safari layering:
  //   back (item -> home): the item is ON TOP and slides away to the right,
  //     uncovering home, which sits still underneath.
  //   forward (home -> item): the item slides IN from the right ON TOP of
  //     home, which stays put.
  // So the layer that moves and its stacking differ by direction; both clone
  // the OUTGOING view once (cheap) and navigate so the destination is live.
  useEffect(() => {
    if (!(window as { __TEXTTEXT_APP__?: boolean }).__TEXTTEXT_APP__) return;

    // How far (fraction of width) the finger must travel to commit. Kept low
    // so a natural swipe completes without an aggressive flick.
    const COMMIT_FRACTION = 0.3;

    let lastPointer = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let drag: {
      direction: "back" | "forward";
      width: number;
      clone: HTMLElement;
      real: HTMLElement;
      translate: number;
      startIndex: number;
    } | null = null;
    let inertGesture = false;

    const overHorizontalScroller = (): boolean => {
      let el = document.elementFromPoint(lastPointer.x, lastPointer.y);
      while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 4) {
          const overflowX = getComputedStyle(el).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    // On forward the incoming item IS the real content, lifted above a frozen
    // home clone and translated; clear those inline styles when done.
    const clearRealDragStyles = (real: HTMLElement) => {
      real.style.transform = "";
      real.style.position = "";
      real.style.zIndex = "";
      real.style.willChange = "";
    };

    const paint = () => {
      if (!drag) return;
      if (drag.direction === "back") {
        const x = Math.max(0, Math.min(drag.width, drag.translate));
        drag.clone.style.transform = `translateX(${x}px)`;
      } else {
        const x = Math.max(0, Math.min(drag.width, drag.width + drag.translate));
        drag.real.style.transform = `translateX(${x}px)`;
      }
    };

    const beginDrag = (direction: "back" | "forward"): boolean => {
      const content = contentRef.current;
      if (!content) return false;
      const rect = content.getBoundingClientRect();
      if (rect.width < 1) return false;
      const clone = content.cloneNode(true) as HTMLElement;
      clone.removeAttribute("id");
      clone.style.position = "fixed";
      clone.style.left = `${rect.left}px`;
      clone.style.top = `${rect.top}px`;
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
      clone.style.margin = "0";
      clone.style.pointerEvents = "none";
      clone.style.overflow = "hidden";
      clone.style.background = "var(--bg)";
      clone.style.willChange = "transform";
      clone.style.transform = "translateX(0)";
      clone.setAttribute("aria-hidden", "true");
      try {
        clone.scrollTop = content.scrollTop;
      } catch {
        /* nested scroll fidelity is best-effort */
      }
      if (direction === "back") {
        // Item clone rides on top and slides away to reveal home underneath.
        clone.style.zIndex = "60";
      } else {
        // Home clone is frozen underneath; the real content (about to become
        // the item) is lifted above it and slid in from the right.
        clone.style.zIndex = "1";
        content.style.position = "relative";
        content.style.zIndex = "2";
        content.style.willChange = "transform";
        content.style.transform = `translateX(${rect.width}px)`;
      }
      document.body.appendChild(clone);
      navAnimationSuppressed = true;
      const startIndex = navIndexRef.current;
      if (direction === "back") window.history.back();
      else window.history.forward();
      drag = {
        direction,
        width: rect.width,
        clone,
        real: content,
        translate: 0,
        startIndex,
      };
      return true;
    };

    const finishDrag = (commit: boolean) => {
      if (!drag) return;
      const active = drag;
      drag = null;

      const mover = active.direction === "back" ? active.clone : active.real;
      const from = mover.style.transform || "translateX(0)";
      const to =
        active.direction === "back"
          ? commit
            ? `translateX(${active.width}px)`
            : "translateX(0)"
          : commit
            ? "translateX(0)"
            : `translateX(${active.width}px)`;

      const animation = mover.animate(
        [{ transform: from }, { transform: to }],
        { duration: 200, easing: "cubic-bezier(.25,.8,.35,1)", fill: "forwards" },
      );

      const cleanup = () => {
        // Return to the pre-drag entry when cancelling; correcting to the
        // recorded index self-heals a fast flick where the start move had
        // not settled yet.
        const restoreIndex = () => {
          const delta = active.startIndex - navIndexRef.current;
          if (delta !== 0) window.history.go(delta);
        };
        if (active.direction === "back") {
          if (!commit) restoreIndex();
          active.clone.remove();
        } else {
          if (!commit) restoreIndex();
          clearRealDragStyles(active.real);
          active.clone.remove();
        }
        window.setTimeout(() => {
          if (!commit && navIndexRef.current !== active.startIndex) {
            window.history.go(active.startIndex - navIndexRef.current);
          }
          window.setTimeout(() => {
            navAnimationSuppressed = false;
          }, 80);
        }, 60);
      };

      animation.addEventListener("finish", cleanup, { once: true });
      window.setTimeout(() => {
        if (active.clone.isConnected) {
          try {
            animation.cancel();
          } catch {
            /* already gone */
          }
          cleanup();
        }
      }, 280);
    };

    const bridge = (phase: "begin" | "move" | "end", dx: number) => {
      if (phase === "begin") {
        inertGesture = false;
        // NSEvent scrollingDeltaX (natural scrolling): swipe right, going
        // back, is positive; swipe left, forward, negative.
        const direction: "back" | "forward" = dx > 0 ? "back" : "forward";
        const canBack = navIndexRef.current > 0;
        const canForward = navIndexRef.current < navMaxRef.current;
        if (
          (direction === "back" ? !canBack : !canForward) ||
          overHorizontalScroller()
        ) {
          inertGesture = true;
          return;
        }
        if (beginDrag(direction)) {
          drag!.translate = dx;
          paint();
        }
        return;
      }
      if (phase === "move") {
        if (!drag) return;
        drag.translate = dx;
        paint();
        return;
      }
      // end
      if (inertGesture) {
        inertGesture = false;
        return;
      }
      if (!drag) return;
      finishDrag(Math.abs(drag.translate) > drag.width * COMMIT_FRACTION);
    };

    (window as { __ttNavSwipe?: typeof bridge }).__ttNavSwipe = bridge;
    return () => {
      window.removeEventListener("pointermove", onPointer);
      delete (window as { __ttNavSwipe?: typeof bridge }).__ttNavSwipe;
      if (drag) {
        if (drag.direction === "forward") clearRealDragStyles(drag.real);
        drag.clone.remove();
        drag = null;
        navAnimationSuppressed = false;
      }
    };
  }, []);

  const readerScrollBlocked = useCallback(() => {
    if (typeof document === "undefined") return true;
    // A live menu, popover, or the shortcut sheet owns the keyboard.
    return Boolean(document.querySelector('[data-post-edit-menu-open="true"]'));
  }, []);

  const scrollReader = useCallback(
    (direction: "up" | "down", amount: "line" | "half" | "page") => {
      if (typeof window === "undefined" || readerScrollBlocked()) return;
      // The workspace scrolls in .post-editor-content, never the window; the
      // window variant of these commands ran and moved nothing, which is why
      // Space "did not work" in the reader.
      const scroller = contentRef.current;
      const viewport = scroller?.clientHeight || window.innerHeight || 800;
      const step =
        amount === "line"
          ? Math.max(64, Math.round(viewport * 0.16))
          : amount === "half"
            ? Math.round(viewport * 0.5)
            : Math.round(viewport * 0.9);
      const top = direction === "down" ? step : -step;
      if (scroller) scroller.scrollBy({ top, behavior: "auto" });
      else window.scrollBy({ top, behavior: "auto" });
    },
    [readerScrollBlocked],
  );

  const scrollReaderEdge = useCallback(
    (edge: "top" | "bottom") => {
      if (typeof window === "undefined" || readerScrollBlocked()) return;
      const scroller = contentRef.current;
      if (scroller) {
        const top =
          edge === "top" ? 0 : scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
        return;
      }
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
      readerScrollerFocused: () =>
        Boolean(
          contentRef.current &&
            document.activeElement instanceof Node &&
            contentRef.current.contains(document.activeElement),
        ),
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
      // A document view has no items to marquee-select, and the
      // preventDefault below is exactly what killed native click-drag text
      // selection from the page margins ("like reading an article in a
      // browser" - owner, 2026-09-02). Reading and writing views keep the
      // browser's own drag, selection and context-menu behavior untouched.
      const level = viewRef.current.level;
      if (level === "post" || level === "edit") return;
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

      // Item geometry is measured ONCE when the drag crosses the threshold:
      // rect-reading every row on every pointermove forced one layout per
      // item per event. Items do not move during a marquee drag (the list
      // does not scroll under it), and the selection state only writes when
      // the id set actually changed.
      let items: { id: string; rectangle: SelectionRectangle }[] | null = null;
      let lastSelectionKey = "";
      let frame = 0;
      let latestX = startX;
      let latestY = startY;
      const move = (moveEvent: PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5
        ) {
          return;
        }
        dragging = true;
        latestX = moveEvent.clientX;
        latestY = moveEvent.clientY;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const rectangle: SelectionRectangle = {
            left: Math.min(startX, latestX),
            right: Math.max(startX, latestX),
            top: Math.min(startY, latestY),
            bottom: Math.max(startY, latestY),
          };
          setMarqueeRectangle(rectangle);
          items ??= visibleWorkspaceItems("data-workspace-post-id").flatMap(
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
          const ordered = Array.from(next);
          const selectionKey = ordered.join("|");
          if (selectionKey === lastSelectionKey) return;
          lastSelectionKey = selectionKey;
          applyPostSelection({
            activeId: ordered.at(-1) ?? null,
            anchorId: ordered[0] ?? null,
            selectedIds: next,
          });
        });
      };
      const finish = () => {
        if (frame) cancelAnimationFrame(frame);
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
      onUseAssistantPrompt={(prompt) => {
        assistantComposer.setText(prompt);
        changeAssistantState("pinned");
      }}
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
        onBuildItemType={(folder) => {
          setItemTypeStudioEditing(null);
          setItemTypeStudioFolderPath(folder.path);
        }}
        onChangeItemType={(folder) => {
          void (async () => {
            const templateId = folder.defaultTemplate?.id ?? "";
            if (!templateId || templateId.startsWith("texttext.")) {
              // Built-ins are compiled in code and have no design to reopen.
              // Offering an editor here would open one on nothing.
              setLookNotice(
                "This folder uses a built-in look. Build one with AI to make a version you can change.",
              );
              return;
            }
            const read = await readItemTypeForEditAction(
              displayPool.blog.handle,
              templateId,
            );
            if (!read.ok) {
              setLookNotice(read.error);
              return;
            }
            if (!read.blueprint) {
              // Four different reasons, and each is a different thing to say.
              setLookNotice(
                read.state === "needs-migration"
                  ? "This look was designed with an older version of the designer, so changing it here would alter how it renders. Build a new one from it instead."
                  : read.state === "unreadable"
                    ? "This look's saved design could not be read, so it cannot be reopened."
                    : "This look was saved from a document, imported, or duplicated rather than designed, so there is no design to reopen. Build one with AI instead.",
              );
              return;
            }
            setItemTypeStudioEditing({
              templateId,
              baseVersion: read.version,
              blueprint: read.blueprint,
            });
            setItemTypeStudioFolderPath(folder.path);
          })();
        }}
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

        <AssistantConversationState
          activeConversationId={assistant.activeConversationId}
          contextKey={assistant.conversationContextKey}
          handle={displayPool.blog.handle}
          ownerScopeReady={assistant.ownerScopeReady}
          storeKey={assistant.conversationStoreKey}
        >
          {(conversation) => (
        <AssistantSidebar
          workspaceHandle={displayPool.blog.handle}
          agent={assistantAgentIdentity(
            assistant.cloudProvider,
            assistant.nativeConnection,
            collaboratorColor,
            assistant.runningJobs > 0,
          )}
          onNewConversation={assistant.startNewConversation}
          hasConversation={conversation.messages.length > 0}
          activeConversationId={assistant.activeConversationId}
          conversations={conversation.conversations}
          onOpenConversation={assistant.openConversation}
          onSearchConversations={assistant.searchConversations}
          onToggleConversationPinned={assistant.toggleConversationPinned}
          onDeleteConversation={assistant.deleteConversation}
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
          pendingCount={conversation.pendingProposalCount}
          pendingConversations={conversation.pendingConversations}
          onOpenPendingConversation={(conversation) => {
            assistant.openConversationInContext(
              conversation.contextKey,
              conversation.id,
            );
            if (conversation.contextKey.startsWith("item:")) {
              openPostId(conversation.contextKey.slice("item:".length));
              return;
            }
            if (conversation.contextKey.startsWith("place:")) {
              navigatePath(conversation.contextKey.slice("place:".length));
            }
          }}
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
            messages={conversation.messages}
            starterContext={starterContextFromChip(assistantContext)}
            viewerName={blog.author}
            quickActions={assistant.quickActions}
            submitting={assistant.submitting}
            onApplyProposal={assistant.applyProposal}
            onOpenJob={(job) => {
              // Open the conversation the job reports into, then jump to its
              // context: items open directly, places navigate by their stored
              // URL. Without the conversation switch, clicking a job that ran
              // in the place already on screen visibly did nothing.
              const conversationId = conversationIdFromThreadKey(job.threadKey);
              if (conversationId) {
                assistant.openConversationInContext(
                  job.contextKey,
                  conversationId,
                );
              }
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
          )}
        </AssistantConversationState>
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
          editing={itemTypeStudioEditing ?? undefined}
          initialFolderPath={itemTypeStudioFolderPath}
          onClose={() => {
            setItemTypeStudioFolderPath(null);
            setItemTypeStudioEditing(null);
          }}
          loadPreviewDocuments={loadItemTypeStudioPreviewDocuments}
        />
      ) : null}
      <ConfirmationDialog
        open={Boolean(lookNotice)}
        title="This look cannot be reopened"
        message={lookNotice ?? ""}
        confirmLabel="OK"
        onCancel={() => setLookNotice(null)}
        onConfirm={() => setLookNotice(null)}
      />
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
  initialAssistantState,
  initialAssistantWidth,
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
  initialAssistantState?: AssistantSidebarState;
  initialAssistantWidth?: number;
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
          initialAssistantState={initialAssistantState}
          initialAssistantWidth={initialAssistantWidth}
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
  initialAssistantState,
  initialAssistantWidth,
  initialPool,
  initialPostDocument,
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
  initialAssistantState?: AssistantSidebarState;
  initialAssistantWidth?: number;
  initialPool?: WorkspacePoolPayload | null;
  initialPostDocument?: WorkspaceInitialDocument | null;
  initialMode?: "read" | "edit";
  post: Post;
  postPath: string;
}) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);
  const localInitialPool = useMemo(() => {
    if (!initialPool || !initialPostDocument) return initialPool;
    return {
      ...initialPool,
      initialDocuments: [
        ...(initialPool.initialDocuments ?? []).filter(
          (document) => document.postId !== initialPostDocument.postId,
        ),
        initialPostDocument,
      ],
    };
  }, [initialPool, initialPostDocument]);
  const localInitialPost =
    localInitialPool && post.id
      ? findPoolPostById(localInitialPool, post.id)
      : null;
  const localInitialMode =
    initialMode === "edit" ||
    (localInitialPost &&
      shouldOpenWorkspacePostInEdit(
        localInitialPost,
        initialPostDocument?.document.content.body,
      ))
      ? "edit"
      : "read";
  const localInitialFolderPath = localInitialPost
    ? folderPathForPoolPost(localInitialPool!, localInitialPost)
    : sidebarFolderPathForPostType(post.type);

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
        initialDocument={initialPostDocument}
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
          initialAssistantState={initialAssistantState}
          initialAssistantWidth={initialAssistantWidth}
          initialView={
            post.id
              ? {
                  level: localInitialMode === "edit" ? "edit" : "post",
                  postId: post.id,
                  folderPath: localInitialFolderPath,
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
              localInitialFolderPath,
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
