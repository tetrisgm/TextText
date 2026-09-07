"use client";

import { scheduleAfterLoadIdle } from "@/lib/after-load-idle";

// The workspace's root, search and tag pages plus the content router that
// picks between them. Extracted from the PostWorkspaceShell monolith.

import {
  TrashPage,
  SharedPage,
  StarredPage,
} from "@/components/workspace/WorkspaceSpecialPages";
import { WorkspacePostReader } from "@/components/workspace/WorkspaceItemViews";

/**
 * Loaded on demand in the workspace. The published folder route keeps its
 * static FolderPage import so public folders still render on the server.
 */
const FolderPage = dynamic(
  () =>
    import("@/components/FolderPage").then((module) => module.FolderPage),
  { ssr: false },
);

/** Fetch the folder chunk while the workspace is idle, before navigation. */
function useWarmFolderPageChunk(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const preload = (
      FolderPage as unknown as {
        preload?: () => void;
      }
    ).preload;
    const warm = () => {
      if (preload) preload();
      else void import("@/components/FolderPage");
    };
    const idle = (
      window as unknown as {
        requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;
    if (idle) {
      const handle = idle(warm, { timeout: 2500 });
      return () =>
        (window as unknown as { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(warm, 600);
    return () => window.clearTimeout(timer);
  }, [enabled]);
}

/**
 * Loaded on demand. The editor carries Yjs, y-protocols and the
 * collaborative machinery, and the workspace was parsing all of it to show a
 * list. It is mounted on the first idle after an item opens (see
 * warmEditorReady), so by the time anyone presses E the chunk is long since
 * fetched.
 */
const LocalUnifiedWorkspacePostEditor = dynamic(
  () =>
    import("@/components/workspace/WorkspaceItemEditor").then(
      (module) => module.LocalUnifiedWorkspacePostEditor,
    ),
  { ssr: false },
);

/**
 * Fetch the editor's chunk while the workspace is idle, long before anyone
 * opens anything.
 *
 * Splitting it out took it off the parse path for the list, which is the
 * point; but a note opens STRAIGHT into the editor, and without this the
 * open waited on the download. Warming it at idle keeps both: the list never
 * parses the editor, and by the time an item is opened the chunk is already
 * in hand.
 */
function useWarmEditorChunk(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const preload = (
      LocalUnifiedWorkspacePostEditor as unknown as {
        preload?: () => void;
      }
    ).preload;
    // After the cold path, never during it: an idle slot used to arrive while
    // the pool fetch was pending, and the editor's 228KB downloaded before the
    // list was visible. But soon after: the warm editor mounts only once this
    // chunk is here, and an item opened and edited before that mounts the
    // editor cold, where the collab baseline can land after the first
    // keystrokes (owner, 2026-09-05: a deletion came back). A short quiet
    // period after load is enough to stay off the first paint.
    return scheduleAfterLoadIdle(() => {
      if (preload) preload();
      else void import("@/components/workspace/WorkspaceItemEditor");
    }, 300);
  }, [enabled]);
}

const WorkspaceSettings = dynamic(() =>
  import("@/components/workspace/WorkspaceSettings").then(
    (module) => module.WorkspaceSettings,
  ),
);

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MouseEvent as ReactMouseEvent,
} from "react";
import type {ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  updateBlogAction,
  createRootFolderAction,
} from "@/app/editor/actions";
import {
  type FolderCaptureResolved,
  type FolderCreateItem,
  type FolderDeleteItem,
} from "@/components/workspace/UniversalItemComposer";
import { WorkspaceActionSearch } from "@/components/workspace/WorkspaceActionSearch";
import { WorkspaceSearchButton } from "@/components/workspace/WorkspaceSearchButton";
import {
  WorkspacePostOption,
  domSafeId,
} from "@/components/workspace/WorkspacePostOption";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import { WorkspaceViewModeControl } from "@/components/workspace/WorkspaceViewModeControl";
import {
  type WorkspaceItemIdentityRegistry,
} from "@/components/workspace/useLocalWorkspaceInteraction";
import type {
  Blog,
  BlogHomeView,
  Folder,
  Post,
} from "@/lib/content";
import {
  folderPathForPoolPost,
  poolPostsForFolder,
  poolPostsForTag,
  postFromPoolPost,
} from "@/lib/pool/selectors";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import {
  cssAttributeValue,
  rootSectionFolders,
  workspaceSettingsHref,
  type LocalWorkspaceView,
} from "@/lib/workspace/local-view";
import {
  type WorkspaceSearchLocation,
} from "@/lib/workspace-navigation";
import {
  parseWorkspaceDateQuery,
  searchWorkspace,
  workspaceRootBodyMode,
  workspaceSearchHandoffIndex,
  type WorkspaceDeepSearchMatch,
  type WorkspaceSearchResult,
} from "@/lib/workspace-search";
import { refreshWorkspacePool } from "@/lib/pool/store";
import { chipCensus } from "@/lib/workspace/item-labels";
import {
  WORKSPACE_DOCUMENT_OPENED_EVENT,
  documentsForActivityDate,
  readWorkspaceDocumentOpenHistory,
  sortSidebarDocuments,
  type SidebarDocumentSort,
  type WorkspaceDocumentOpenHistory,
} from "@/lib/workspace-activity";


export function HighlightSearchText({
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

export function WorkspaceSearchActionBar({ onSearch }: { onSearch: () => void }) {
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

export function WorkspaceRootSearchActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="workspace-root-action-bar is-inline-search applecms"
      aria-label="Workspace actions"
    >
      <div className="workspace-root-action-toolbar ac-chrome">{children}</div>
    </div>
  );
}



export function WorkspaceRootLanding({
  canManageItems,
  focusRequestKey,
  onOpenPost,
  onOpenSection,
  onQueryChange,
  onSelectPost,
  onSelectSection,
  pool,
  query,
  source,
  selectedPostId,
  selectedSectionPath,
  assistantConnection,
  assistantCloudProvider,
  onBuildItemType,
  onFocusCapture,
  onUseAssistantPrompt,
  settingsHref,
}: {
  canManageItems: boolean;
  focusRequestKey: number;
  onOpenPost: (postId: string) => void;
  onOpenSection: (folderPath: string) => void;
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
  onFocusCapture: (folderPath: string) => void;
  onUseAssistantPrompt: (prompt: string) => void;
  settingsHref: string;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [deepSearch, setDeepSearch] = useState<{
    query: string;
    matches: WorkspaceDeepSearchMatch[];
  }>({ query: "", matches: [] });
  const [searchFailure, setSearchFailure] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [sort, setSort] = useState<SidebarDocumentSort>("recent");
  // Home's layout is the workspace's one stored layout choice, so it travels
  // with the workspace instead of with the browser that set it. Every folder
  // page, Blog included, takes its layout from the look on the folder; this
  // control governs Home and nothing else.
  const [recentViewMode, setRecentViewMode] = useState<BlogHomeView>(
    pool.blog.homeLayout,
  );
  const [homeViewError, setHomeViewError] = useState<string | null>(null);
  const [showStartHere, setShowStartHere] = useState(false);
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
        setHomeViewError("The layout could not be saved. Your items are unchanged. Choose the layout again to retry.");
      });
    },
    [canManageItems, pool.blog.handle, recentViewMode],
  );
  const [itemFilter, setItemFilter] = useState<
    "all" | "article" | "note" | "bookmark"
  >("all");
  // The server cannot see localStorage. Start both sides from the same list,
  // then layer personal recency on after hydration so a previously opened
  // document cannot reorder the Library while React is attaching to it.
  const [openHistory, setOpenHistory] = useState<WorkspaceDocumentOpenHistory>(
    {},
  );
  const [firstFolder, setFirstFolder] = useState<Folder | null>(null);
  const [creatingFirstFolder, setCreatingFirstFolder] = useState(false);
  const [firstFolderError, setFirstFolderError] = useState<string | null>(null);
  const creationFolders = useMemo(() => rootSectionFolders(pool), [pool]);
  const creationFolder = creationFolders.find((folder) => folder.mode === "notes");
  const createFirstFolder = async () => {
    if (creatingFirstFolder || !canManageItems) return;
    setCreatingFirstFolder(true);
    setFirstFolderError(null);
    try {
      const folder = await createRootFolderAction(pool.blog.handle, "Notes");
      setFirstFolder(folder);
      void refreshWorkspacePool(pool.blog.handle, pool.blogId);
    } catch {
      setFirstFolderError("The notes folder could not be confirmed. No note has been saved. Check your connection and try again.");
    } finally {
      setCreatingFirstFolder(false);
    }
  };
  const openFirstNote = () => {
    if (creationFolder) onFocusCapture(creationFolder.path);
    else if (firstFolder) void refreshWorkspacePool(pool.blog.handle, pool.blogId);
    else void createFirstFolder();
  };
  const activeId = selectedSectionPath
    ? `workspace-root-section-${domSafeId(selectedSectionPath)}`
    : selectedPostId
      ? `workspace-root-post-${domSafeId(selectedPostId)}`
      : undefined;
  const cleanSearchQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      searchWorkspace({
        deepMatches:
          deepSearch.query === cleanSearchQuery ? deepSearch.matches : [],
        folders: pool.folders,
        posts: pool.posts,
        query,
      }),
    [cleanSearchQuery, deepSearch, pool.folders, pool.posts, query],
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
  // Decided once for the whole list rather than per row: a chip only earns
  // its place where the list actually mixes values.
  const recentChips = useMemo(() => chipCensus(recent, pool), [pool, recent]);
  const itemCounts = useMemo(
    () => ({
      all: pool.posts.length,
      article: pool.posts.filter((post) => post.type === "article").length,
      note: pool.posts.filter((post) => post.type === "note").length,
      bookmark: pool.posts.filter((post) => post.type === "bookmark").length,
    }),
    [pool.posts],
  );
  const hasPersonalItems = useMemo(
    () =>
      pool.posts.some(
        (post) => folderPathForPoolPost(pool, post) !== "documentation",
      ),
    [pool],
  );
  const welcomePost = useMemo(
    () =>
      pool.posts.find(
        (post) =>
          post.slug === "welcome-to-texttext" &&
          folderPathForPoolPost(pool, post) === "documentation",
      ) ?? null,
    [pool],
  );
  const assistantReady =
    Boolean(assistantCloudProvider) || assistantConnection?.state === "ready";

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      setShowStartHere(
        window.localStorage.getItem(`texttext:start-here:${pool.blog.handle}`) !==
          "dismissed",
      );
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, [pool.blog.handle]);

  const dismissStartHere = useCallback(() => {
    window.localStorage.setItem(
      `texttext:start-here:${pool.blog.handle}`,
      "dismissed",
    );
    setShowStartHere(false);
  }, [pool.blog.handle]);

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
    if (cleanSearchQuery.length < 3 || dateKey || source === "tag") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({
        handle: pool.blog.handle,
        query: cleanSearchQuery,
      });
      void fetch(`/api/workspace/search?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Search unavailable");
          return (await response.json()) as { matches?: unknown };
        })
        .then((payload) => {
          if (!payload || !Array.isArray(payload.matches)) throw new Error("Search unavailable");
          const matches = payload.matches.filter(
            (candidate): candidate is WorkspaceDeepSearchMatch =>
              Boolean(
                candidate &&
                  typeof candidate === "object" &&
                  typeof (candidate as WorkspaceDeepSearchMatch).postId ===
                    "string" &&
                  typeof (candidate as WorkspaceDeepSearchMatch).detail ===
                    "string" &&
                  typeof (candidate as WorkspaceDeepSearchMatch).score ===
                    "number",
              ),
          );
          if (controller.signal.aborted) return;
          setSearchFailure(null);
          setDeepSearch({ query: cleanSearchQuery, matches });
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchFailure(cleanSearchQuery);
        });
    }, 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [cleanSearchQuery, dateKey, pool.blog.handle, source, searchAttempt]);

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
                Show all items
              </button>
              <h1 id="workspace-root-title">#{query}</h1>
            </header>
            <div
              className="workspace-search-results"
              role="listbox"
              aria-activedescendant={activeId}
            >
              {tagPosts.length === 0 ? (
                <p>No items with this tag. Open an item and add this tag to find it here.</p>
              ) : (
                tagPosts.map((post) => (
                  <WorkspacePostOption
                    key={post.id}
                    blog={pool.blog}
                    folderPath={folderPathForPoolPost(pool, post)}
                    handle={pool.blog.handle}
                    post={post}
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
                Show all items
              </button>
              <h1 id="workspace-root-title">Activity on {dateLabel}</h1>
            </header>
            {dateActivity.created.length === 0 &&
            dateActivity.edited.length === 0 ? (
              <p>No items were created or edited that day. Choose another date or show all items.</p>
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
                          key={post.id}
                          blog={pool.blog}
                          folderPath={folderPathForPoolPost(pool, post)}
                          handle={pool.blog.handle}
                          post={post}
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
                          key={post.id}
                          blog={pool.blog}
                          folderPath={folderPathForPoolPost(pool, post)}
                          handle={pool.blog.handle}
                          post={post}
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
            {searchFailure === cleanSearchQuery && <div className="workspace-library-error" role="status">
              <p>Full search is unavailable. These results only include items stored on this device. Your text has not changed.</p>
              <button type="button" className="ac-btn ac-btn-gray" onClick={() => setSearchAttempt((attempt) => attempt + 1)}>Retry search</button>
            </div>}
            <div
              className="workspace-search-results"
              role="listbox"
              aria-activedescendant={activeId}
            >
              {results.length === 0 ? (
                <div><p>No matching items. Try a different word, title, or date.</p><button type="button" className="ac-btn ac-btn-gray" onClick={() => changeQuery("")}>Clear search</button></div>
              ) : (
                results.map((result) => {
                  if (result.kind === "post") {
                    const post = pool.posts.find(
                      (candidate) => candidate.id === result.postId,
                    );
                    if (!post) return null;
                    return (
                      <WorkspacePostOption
                        key={result.id}
                        blog={pool.blog}
                        folderPath={folderPathForPoolPost(pool, post)}
                        handle={pool.blog.handle}
                        post={post}
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
            {canManageItems && showStartHere && !hasPersonalItems && pool.posts.length > 0 ? (
              <section className="workspace-start-here" aria-label="Start here">
                <div>
                  <strong>Make TextText yours</strong>
                  <span>
                    Capture something, or ask AI to build and organize the kind
                    of writing you keep.
                    {welcomePost ? (
                      <button
                        type="button"
                        className="workspace-start-here-guide"
                        onClick={() => onOpenPost(welcomePost.id)}
                      >
                        See what it can do
                      </button>
                    ) : null}
                  </span>
                </div>
                <div className="workspace-start-here-actions">
                  <button type="button" disabled={creatingFirstFolder} onClick={openFirstNote}>{creationFolder ? "Write a note" : creatingFirstFolder ? "Creating notes folder" : firstFolder ? "Refresh folders" : "Create a notes folder"}</button>
                  <button type="button" onClick={onBuildItemType}>Create a template</button>
                  {assistantReady ? (
                    <button type="button" onClick={() => onUseAssistantPrompt("Build a reusable project tracker with status, owner, priority, due date, and a folder view grouped by status. Show me the structure before applying it.")}>Try the assistant</button>
                  ) : (
                    <a href={`${settingsHref}#settings-connection-gallery`}>Connect an AI</a>
                  )}
                </div>
                {firstFolderError && <p role="alert">{firstFolderError}</p>}
                <button type="button" className="workspace-start-here-dismiss" aria-label="Dismiss Start here" onClick={dismissStartHere}>Done</button>
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
                        <strong>A place for your notes, articles, and bookmarks</strong>
                        <span>{creationFolder ? "Write a note or paste a link to start your first item." : "Create a notes folder to start your first item."}</span>
                      </div>
                      <ol>
                        <li>
                          <b>1</b>
                          <span><strong>Create</strong> {creationFolder ? "Open a folder to write and save a note." : "Create a notes folder to hold your writing."}</span>
                        </li>
                        <li>
                          <b>2</b>
                          <span><strong>Find</strong> Browse folders in the sidebar or search your words above.</span>
                        </li>
                        <li>
                          <b>3</b>
                          <span><strong>Edit</strong> Open an item to write. The assistant beside it can help when you connect an AI.</span>
                        </li>
                      </ol>
                      {canManageItems ? (
                        <button
                          type="button"
                          className="ac-btn ac-btn-filled"
                          disabled={creatingFirstFolder}
                          onClick={openFirstNote}
                        >
                          {creationFolder ? "Write your first note" : creatingFirstFolder ? "Creating notes folder" : firstFolder ? "Refresh folders" : "Create a notes folder"}
                        </button>
                      ) : null}
                      {firstFolder && !creationFolder && <p>The notes folder was created. Refresh folders to open it.</p>}
                      {firstFolderError && <p role="alert">{firstFolderError}</p>}
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
                      key={post.id}
                      blog={pool.blog}
                      chips={recentChips}
                      folderPath={folderPathForPoolPost(pool, post)}
                      handle={pool.blog.handle}
                      pool={pool}
                      post={post}
                      showUpdatedAt
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


export function LocalWorkspaceContent({
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
  onOpenPostInNewTab,
  onDragItems,
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
  onUseAssistantPrompt,
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
  /** Cmd/Ctrl or middle click: open the document as a background tab. */
  onOpenPostInNewTab: (postId: string) => void;
  /** Fill a drag with the items being moved. */
  onDragItems: (transfer: DataTransfer, postId: string) => void;
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
  onFocusCapture: (folderPath: string) => void;
  onUseAssistantPrompt: (prompt: string) => void;
}) {
  // Stable identity for the section's items: FolderPage memoizes its sort,
  // collection shaping and calendar off this array, and handing it a fresh
  // `.map()` result every shell render busted every one of those memos - a
  // full re-sort and re-shape of the whole folder per selection keystroke.
  const sectionItems = useMemo(() => {
    if (view.level !== "section") return null;
    const folder = pool.folders.find(
      (entry) => entry.path === view.folderPath,
    );
    if (!folder) return null;
    return poolPostsForFolder(pool, folder.path).map((post) =>
      postFromPoolPost(post),
    );
  }, [pool, view]);

  let page: ReactNode;
  let activePost: WorkspacePoolPost | null = null;
  const rootPage = (
    <WorkspaceRootLanding
      canManageItems={canManagePost}
      focusRequestKey={searchFocusRequestKey}
      onOpenPost={onOpenPostId}
      onOpenSection={onOpenSection}
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
      onUseAssistantPrompt={onUseAssistantPrompt}
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
        <StarredPage pool={pool} owner={canManagePost} />
      </>
    );
  } else if (view.level === "section") {
    const folder = pool.folders.find((entry) => entry.path === view.folderPath);
    if (!folder) {
      page = rootPage;
    } else {
      const items = sectionItems ?? [];
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
          onOpenPostInNewTab={onOpenPostInNewTab}
          onDragItems={onDragItems}
          onOpenTag={onOpenTag}
          onItemClick={onItemClick}
          captureFocusRequestKey={captureFocusRequestKey}
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

  useWarmFolderPageChunk(pool.folders.length > 0);
  useWarmEditorChunk(canEditItems);
  const [warmEditorPostId, setWarmEditorPostId] = useState<string | null>(null);
  const activePostId = activePost?.id ?? null;
  useEffect(() => {
    if (!activePostId) return;
    const idle = (
      window as unknown as {
        requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;
    if (idle) {
      const handle = idle(() => setWarmEditorPostId(activePostId), { timeout: 1200 });
      return () =>
        (window as unknown as { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setWarmEditorPostId(activePostId), 200);
    return () => window.clearTimeout(timer);
  }, [activePostId]);

  const warmEditorReady = Boolean(activePostId) && warmEditorPostId === activePostId;
  const editorVisible =
    Boolean(activePost) &&
    (view.level === "edit" || activePost?.type === "note");
  // The warm editor is mounted on the FIRST IDLE after an item opens, not
  // during the open. Warming it inline meant every open - including a read
  // that never touches the editor - paid for building a Yjs document, an
  // awareness channel and a collab provider before the reader could paint.
  // Deferring costs nothing: by the time a hand reaches Cmd+E the mount has
  // long happened. Opening straight into edit still mounts immediately,
  // because then the editor IS the view.
  const shouldWarmEditor =
    Boolean(activePost) && canEditItems && (editorVisible || warmEditorReady);

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
