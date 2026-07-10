"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  persistPool,
  persistPostBody,
  readPersistedPool,
  readPersistedPostBody,
} from "@/lib/pool/storage";
import type {
  WorkspaceInitialBody,
  WorkspacePoolPayload,
  WorkspacePoolPost,
  WorkspacePostBodyPayload,
} from "@/lib/pool/types";
import type { Folder } from "@/lib/content";

type BodyCacheEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; body: WorkspacePostBodyPayload }
  | { status: "error"; error: string };

type WorkspacePoolState = {
  pool: WorkspacePoolPayload | null;
  refreshing: boolean;
  error: string | null;
  bodies: Record<string, BodyCacheEntry>;
};

const listeners = new Set<() => void>();
const bodyFetches = new Set<string>();

let state: WorkspacePoolState = {
  pool: null,
  refreshing: false,
  error: null,
  bodies: {},
};

function bodyKey(blogId: string, postId: string): string {
  return `${blogId}:${postId}`;
}

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<WorkspacePoolState>) {
  state = { ...state, ...patch };
  emit();
}

function setBodyEntry(
  blogId: string,
  postId: string,
  entry: BodyCacheEntry,
) {
  state = {
    ...state,
    bodies: {
      ...state.bodies,
      [bodyKey(blogId, postId)]: entry,
    },
  };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WorkspacePoolState {
  return state;
}

function getServerSnapshot(): WorkspacePoolState {
  return state;
}

function isNewer(candidate: string, current: string): boolean {
  return Date.parse(candidate) > Date.parse(current);
}

export function isWorkspacePostBodyStale(
  postUpdatedAt: string | undefined,
  bodyUpdatedAt: string | undefined,
): boolean {
  if (!postUpdatedAt) return false;
  if (!bodyUpdatedAt) return true;
  const postTime = Date.parse(postUpdatedAt);
  const bodyTime = Date.parse(bodyUpdatedAt);
  return Number.isFinite(postTime) && Number.isFinite(bodyTime) && postTime > bodyTime;
}

function isOptimisticPost(post: WorkspacePoolPost): boolean {
  return post.id.startsWith("optimistic-");
}

function mergeIncomingPool(pool: WorkspacePoolPayload): WorkspacePoolPayload {
  const current = state.pool;
  if (!current || current.blogId !== pool.blogId) return pool;

  const incomingIds = new Set(pool.posts.map((post) => post.id));
  const pendingPosts = current.posts.filter(
    (post) => isOptimisticPost(post) && !incomingIds.has(post.id),
  );
  if (pendingPosts.length === 0) return pool;

  return {
    ...pool,
    posts: [...pendingPosts, ...pool.posts],
  };
}

export function seedWorkspacePool(
  pool: WorkspacePoolPayload,
  initialBody?: WorkspaceInitialBody | null,
) {
  const nextPool = mergeIncomingPool(pool);
  const current = state.pool;
  const shouldReplace =
    !current ||
    current.blogId !== nextPool.blogId ||
    isNewer(nextPool.fetchedAt, current.fetchedAt) ||
    current.posts.length !== nextPool.posts.length;
  if (shouldReplace) {
    state = { ...state, pool: nextPool, error: null };
    emit();
    void persistPool(nextPool);
  }

  const initialBodies = initialBody
    ? [
        ...(pool.initialBodies ?? []).filter(
          (body) => body.postId !== initialBody.postId,
        ),
        initialBody,
      ]
    : (pool.initialBodies ?? []);
  for (const initial of initialBodies) {
    const body: WorkspacePostBodyPayload = {
      blogId: pool.blogId,
      postId: initial.postId,
      body: initial.body,
      updatedAt: initial.updatedAt,
      fetchedAt: new Date().toISOString(),
    };
    setBodyEntry(pool.blogId, initial.postId, {
      status: "ready",
      body,
    });
    void persistPostBody(body);
  }
}

export async function hydrateWorkspacePoolFromStorage(blogId: string) {
  const cached = await readPersistedPool(blogId);
  if (!cached) return;
  const current = state.pool;
  if (!current || current.blogId !== blogId) {
    setState({ pool: mergeIncomingPool(cached), error: null });
  }
}

export async function refreshWorkspacePool(handle: string, blogId: string) {
  if (state.refreshing) return;
  state = { ...state, refreshing: true, error: null };
  try {
    const params = new URLSearchParams({ handle });
    const response = await fetch(`/api/workspace/pool?${params.toString()}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Could not refresh the workspace");
    const pool = (await response.json()) as WorkspacePoolPayload;
    if (pool.blogId !== blogId) throw new Error("Workspace response mismatch");
    const nextPool = mergeIncomingPool(pool);
    setState({ pool: nextPool, refreshing: false, error: null });
    void persistPool(nextPool);
    for (const initial of nextPool.initialBodies ?? []) {
      const key = bodyKey(blogId, initial.postId);
      const current = state.bodies[key];
      if (
        current?.status === "ready" &&
        !isWorkspacePostBodyStale(initial.updatedAt, current.body.updatedAt)
      ) {
        continue;
      }
      const body: WorkspacePostBodyPayload = {
        blogId,
        postId: initial.postId,
        body: initial.body,
        updatedAt: initial.updatedAt,
        fetchedAt: new Date().toISOString(),
      };
      setBodyEntry(blogId, initial.postId, { status: "ready", body });
      void persistPostBody(body);
    }
  } catch (error) {
    setState({
      refreshing: false,
      error: error instanceof Error ? error.message : "Could not refresh",
    });
  }
}

export async function ensurePostBody(
  blogId: string,
  postId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const key = bodyKey(blogId, postId);
  const existing = state.bodies[key];
  if (bodyFetches.has(key) || existing?.status === "loading") return;
  if (existing?.status === "ready" && !options.force) return;

  bodyFetches.add(key);
  if (existing?.status !== "ready") {
    setBodyEntry(blogId, postId, { status: "loading" });
  }

  try {
    if (!options.force) {
      const cached = await readPersistedPostBody(blogId, postId);
      const postUpdatedAt = state.pool?.posts.find(
        (post) => post.id === postId,
      )?.updatedAt;
      if (
        cached &&
        !isWorkspacePostBodyStale(postUpdatedAt, cached.updatedAt)
      ) {
        setBodyEntry(blogId, postId, { status: "ready", body: cached });
        return;
      }
    }

    const response = await fetch(`/api/post/${encodeURIComponent(postId)}/body`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Could not load the body");
    const body = (await response.json()) as WorkspacePostBodyPayload;
    if (body.blogId !== blogId || body.postId !== postId) {
      throw new Error("Body response mismatch");
    }
    setBodyEntry(blogId, postId, { status: "ready", body });
    void persistPostBody(body);
  } catch (error) {
    if (existing?.status !== "ready") {
      setBodyEntry(blogId, postId, {
        status: "error",
        error: error instanceof Error ? error.message : "Could not load",
      });
    }
  } finally {
    bodyFetches.delete(key);
  }
}

export function useWorkspacePool() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useWorkspacePostBody(
  blogId: string,
  postId: string,
  initialBody?: WorkspaceInitialBody | null,
) {
  const snapshot = useWorkspacePool();
  const cachedEntry = snapshot.bodies[bodyKey(blogId, postId)];
  const initialPayload = initialBody
    ? {
        blogId,
        postId,
        body: initialBody.body,
        updatedAt: initialBody.updatedAt,
        fetchedAt: snapshot.pool?.fetchedAt ?? "",
      }
    : null;
  const entry =
    initialPayload &&
    (cachedEntry?.status !== "ready" ||
      isWorkspacePostBodyStale(
        initialPayload.updatedAt,
        cachedEntry.body.updatedAt,
      ))
      ? ({ status: "ready", body: initialPayload } as const)
      : (cachedEntry ?? ({ status: "idle" } as const));
  const postUpdatedAt = snapshot.pool?.posts.find(
    (post) => post.id === postId,
  )?.updatedAt;
  const stale =
    entry.status === "ready" &&
    isWorkspacePostBodyStale(postUpdatedAt, entry.body.updatedAt);
  const load = useCallback((force = stale) => {
    void ensurePostBody(blogId, postId, { force });
  }, [blogId, postId, stale]);
  return { entry, load, stale };
}

export function getWorkspacePost(postId: string): WorkspacePoolPost | null {
  return state.pool?.posts.find((post) => post.id === postId) ?? null;
}

export function addPost(post: WorkspacePoolPost) {
  if (!state.pool || state.pool.blogId !== post.blogId) return;
  setState({
    pool: {
      ...state.pool,
      posts: [post, ...state.pool.posts.filter((entry) => entry.id !== post.id)],
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function replacePost(previousId: string, post: WorkspacePoolPost) {
  if (!state.pool || state.pool.blogId !== post.blogId) return;
  setState({
    pool: {
      ...state.pool,
      posts: [
        post,
        ...state.pool.posts.filter(
          (entry) => entry.id !== previousId && entry.id !== post.id,
        ),
      ],
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function updatePost(postId: string, patch: Partial<WorkspacePoolPost>) {
  if (!state.pool) return;
  const posts = state.pool.posts.map((post) =>
    post.id === postId ? { ...post, ...patch, id: post.id } : post,
  );
  setState({
    pool: {
      ...state.pool,
      posts,
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function updateWorkspaceBlog(
  patch: Partial<WorkspacePoolPayload["blog"]>,
) {
  if (!state.pool) return;
  setState({
    pool: {
      ...state.pool,
      blog: { ...state.pool.blog, ...patch },
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function updatePostBody(blogId: string, postId: string, body: string) {
  const nextBody: WorkspacePostBodyPayload = {
    blogId,
    postId,
    body,
    updatedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };
  setBodyEntry(blogId, postId, { status: "ready", body: nextBody });
  void persistPostBody(nextBody);
}

export function removePost(postId: string) {
  if (!state.pool) return;
  setState({
    pool: {
      ...state.pool,
      posts: state.pool.posts.filter((post) => post.id !== postId),
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function movePostToTrash(postId: string): WorkspacePoolPost | null {
  if (!state.pool) return null;
  const post = state.pool.posts.find((entry) => entry.id === postId) ?? null;
  if (!post) return null;
  setState({
    pool: {
      ...state.pool,
      posts: state.pool.posts.filter((entry) => entry.id !== postId),
      trashedPosts: [
        post,
        ...(state.pool.trashedPosts ?? []).filter((entry) => entry.id !== postId),
      ],
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
  return post;
}

export function restorePostFromTrash(postId: string): WorkspacePoolPost | null {
  if (!state.pool) return null;
  const post = (state.pool.trashedPosts ?? []).find(
    (entry) => entry.id === postId,
  ) ?? null;
  if (!post) return null;
  setState({
    pool: {
      ...state.pool,
      posts: [post, ...state.pool.posts.filter((entry) => entry.id !== postId)],
      trashedPosts: (state.pool.trashedPosts ?? []).filter(
        (entry) => entry.id !== postId,
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
  return post;
}

export function removeTrashedPost(postId: string) {
  if (!state.pool) return;
  setState({
    pool: {
      ...state.pool,
      trashedPosts: (state.pool.trashedPosts ?? []).filter(
        (entry) => entry.id !== postId,
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function moveFolderToTrash(folderId: string) {
  if (!state.pool) return;
  const target = state.pool.folders.find((folder) => folder.id === folderId);
  if (!target) return;
  const removedFolders = state.pool.folders.filter(
    (folder) =>
      folder.path === target.path || folder.path.startsWith(`${target.path}/`),
  );
  const removedIds = new Set(removedFolders.map((folder) => folder.id));
  const removedPosts = state.pool.posts.filter(
    (post) => Boolean(post.folderId && removedIds.has(post.folderId)),
  );
  const removedPostIds = new Set(removedPosts.map((post) => post.id));
  setState({
    pool: {
      ...state.pool,
      folders: state.pool.folders.filter((folder) => !removedIds.has(folder.id)),
      posts: state.pool.posts.filter((post) => !removedPostIds.has(post.id)),
      trashedFolders: [
        ...removedFolders,
        ...(state.pool.trashedFolders ?? []).filter(
          (folder) => !removedIds.has(folder.id),
        ),
      ],
      trashedPosts: [
        ...removedPosts,
        ...(state.pool.trashedPosts ?? []).filter(
          (post) => !removedPostIds.has(post.id),
        ),
      ],
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function restoreFolderFromTrash(folderId: string) {
  if (!state.pool) return;
  const target = (state.pool.trashedFolders ?? []).find(
    (folder) => folder.id === folderId,
  );
  if (!target) return;
  const restoredFolders = (state.pool.trashedFolders ?? []).filter(
    (folder) =>
      folder.path === target.path || folder.path.startsWith(`${target.path}/`),
  );
  const restoredIds = new Set(restoredFolders.map((folder) => folder.id));
  const restoredPosts = (state.pool.trashedPosts ?? []).filter(
    (post) => Boolean(post.folderId && restoredIds.has(post.folderId)),
  );
  const restoredPostIds = new Set(restoredPosts.map((post) => post.id));
  setState({
    pool: {
      ...state.pool,
      folders: [...state.pool.folders, ...restoredFolders],
      posts: [...restoredPosts, ...state.pool.posts],
      trashedFolders: (state.pool.trashedFolders ?? []).filter(
        (folder) => !restoredIds.has(folder.id),
      ),
      trashedPosts: (state.pool.trashedPosts ?? []).filter(
        (post) => !restoredPostIds.has(post.id),
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function removeTrashedFolder(folderId: string) {
  if (!state.pool) return;
  const target = (state.pool.trashedFolders ?? []).find(
    (folder) => folder.id === folderId,
  );
  if (!target) return;
  const removedFolders = (state.pool.trashedFolders ?? []).filter(
    (folder) =>
      folder.path === target.path || folder.path.startsWith(`${target.path}/`),
  );
  const removedIds = new Set(removedFolders.map((folder) => folder.id));
  setState({
    pool: {
      ...state.pool,
      trashedFolders: (state.pool.trashedFolders ?? []).filter(
        (folder) => !removedIds.has(folder.id),
      ),
      trashedPosts: (state.pool.trashedPosts ?? []).filter(
        (post) => !post.folderId || !removedIds.has(post.folderId),
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}

export function movePost(postId: string, folderId: string | undefined) {
  updatePost(postId, { folderId });
}

export function updateFolder(folderId: string, patch: Partial<Folder>) {
  if (!state.pool) return;
  setState({
    pool: {
      ...state.pool,
      folders: state.pool.folders.map((folder) =>
        folder.id === folderId ? { ...folder, ...patch, id: folder.id } : folder,
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
  if (state.pool) void persistPool(state.pool);
}
