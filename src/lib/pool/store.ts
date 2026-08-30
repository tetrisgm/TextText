"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  deletePersistedPostDocument,
  normalizeStoredPostDocument,
  persistPostDocument,
  readPersistedPostDocument,
} from "@/lib/pool/storage";
import type {
  WorkspaceInitialBody,
  WorkspaceInitialDocument,
  WorkspacePoolPayload,
  WorkspacePoolPost,
  WorkspacePostBodyPayload,
  WorkspacePostDocumentPayload,
} from "@/lib/pool/types";
import type { Folder } from "@/lib/content";
import type { DocumentSnapshot } from "@/lib/documents/model";

type BodyCacheEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; document: WorkspacePostDocumentPayload }
  | { status: "error"; error: string };

const IDLE_BODY_ENTRY: BodyCacheEntry = { status: "idle" };

type WorkspacePoolState = {
  pool: WorkspacePoolPayload | null;
  refreshing: boolean;
  error: string | null;
  bodies: Record<string, BodyCacheEntry>;
};

const poolListeners = new Set<() => void>();
const bodyListeners = new Map<string, Set<() => void>>();
const bodyFetches = new Set<string>();
const bodyMutationGenerations = new Map<string, number>();
const locallyDirtyBodies = new Set<string>();
const locallyDirtyPosts = new Set<string>();
const locallyTrashedPosts = new Set<string>();
const optimisticPostPatches = new Map<string, Partial<WorkspacePoolPost>>();
let poolMutationGeneration = 0;

let state: WorkspacePoolState = {
  pool: null,
  refreshing: false,
  error: null,
  bodies: {},
};

let activePoolRefresh: {
  blogId: string;
  handle: string;
  promise: Promise<void>;
} | null = null;

function bodyKey(blogId: string, postId: string): string {
  return `${blogId}:${postId}`;
}

function postKey(blogId: string, postId: string): string {
  return `${blogId}:${postId}`;
}

function bodyMutationGeneration(key: string): number {
  return bodyMutationGenerations.get(key) ?? 0;
}

function advanceBodyMutationGeneration(key: string): number {
  const next = bodyMutationGeneration(key) + 1;
  bodyMutationGenerations.set(key, next);
  return next;
}

function markPoolMutation() {
  poolMutationGeneration += 1;
}

function emitPool() {
  for (const listener of poolListeners) listener();
}

function emitBody(key: string) {
  for (const listener of bodyListeners.get(key) ?? []) listener();
}

function setState(patch: Partial<WorkspacePoolState>) {
  state = { ...state, ...patch };
  emitPool();
}

function setBodyEntry(blogId: string, postId: string, entry: BodyCacheEntry) {
  state = {
    ...state,
    bodies: {
      ...state.bodies,
      [bodyKey(blogId, postId)]: entry,
    },
  };
  emitBody(bodyKey(blogId, postId));
}

function removeBodyEntry(blogId: string, postId: string) {
  const key = bodyKey(blogId, postId);
  const bodies = { ...state.bodies };
  delete bodies[key];
  state = { ...state, bodies };
  bodyFetches.delete(key);
  bodyMutationGenerations.delete(key);
  locallyDirtyBodies.delete(key);
  emitBody(key);
}

function subscribe(listener: () => void): () => void {
  poolListeners.add(listener);
  return () => poolListeners.delete(listener);
}

function subscribeBody(key: string, listener: () => void): () => void {
  const listeners = bodyListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  bodyListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) bodyListeners.delete(key);
  };
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
  return (
    Number.isFinite(postTime) &&
    Number.isFinite(bodyTime) &&
    postTime > bodyTime
  );
}

export function isWorkspacePostDocumentStale(
  postRevision: number | undefined,
  postUpdatedAt: string | undefined,
  documentRevision: number | undefined,
  documentUpdatedAt: string | undefined,
): boolean {
  if (postRevision !== undefined && documentRevision !== undefined) {
    return postRevision > documentRevision;
  }
  return isWorkspacePostBodyStale(postUpdatedAt, documentUpdatedAt);
}

function documentPayload(
  blogId: string,
  postId: string,
  document: DocumentSnapshot,
  options: {
    revision?: number;
    updatedAt?: string;
    fetchedAt?: string;
  } = {},
): WorkspacePostDocumentPayload {
  return {
    blogId,
    postId,
    document,
    revision: options.revision,
    updatedAt: options.updatedAt,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    body: document.content.body,
  };
}

function poolPostForDocument(postId: string): WorkspacePoolPost | undefined {
  return (
    state.pool?.posts.find((post) => post.id === postId) ??
    state.pool?.trashedPosts?.find((post) => post.id === postId)
  );
}

function initialDocumentPayload(
  pool: WorkspacePoolPayload,
  initial: WorkspaceInitialBody | WorkspaceInitialDocument,
): WorkspacePostDocumentPayload | null {
  const poolPost = pool.posts.find((post) => post.id === initial.postId);
  const canonical =
    "document" in initial ? initial.document : poolPost?.document;
  if (!canonical) return null;
  const document =
    "body" in initial
      ? {
          ...canonical,
          content: { ...canonical.content, body: initial.body },
        }
      : canonical;
  return documentPayload(pool.blogId, initial.postId, document, {
    revision:
      "revision" in initial ? initial.revision : poolPost?.revision,
    updatedAt: initial.updatedAt,
    fetchedAt: pool.fetchedAt,
  });
}

function isOptimisticPost(post: WorkspacePoolPost): boolean {
  return post.id.startsWith("optimistic-");
}

function patchMatchesPost(
  post: WorkspacePoolPost,
  patch: Partial<WorkspacePoolPost>,
): boolean {
  return Object.entries(patch).every(([key, value]) => {
    const current = post[key as keyof WorkspacePoolPost];
    if (Object.is(current, value)) return true;
    if (typeof current !== "object" || typeof value !== "object") return false;
    return JSON.stringify(current) === JSON.stringify(value);
  });
}

function mergeIncomingPool(pool: WorkspacePoolPayload): WorkspacePoolPayload {
  const current = state.pool;
  const confirmedTrashedIds = new Set(
    (pool.trashedPosts ?? []).map((post) => post.id),
  );
  const incomingPosts = pool.posts.filter(
    (post) =>
      !confirmedTrashedIds.has(post.id) &&
      !locallyTrashedPosts.has(postKey(pool.blogId, post.id)),
  );
  if (!current || current.blogId !== pool.blogId) {
    return incomingPosts.length === pool.posts.length
      ? pool
      : { ...pool, posts: incomingPosts };
  }

  const currentById = new Map(current.posts.map((post) => [post.id, post]));
  const reconciledPosts = incomingPosts.map((post) => {
    const local = currentById.get(post.id);
    const patch = optimisticPostPatches.get(post.id);
    if (patch && patchMatchesPost(post, patch)) {
      optimisticPostPatches.delete(post.id);
    }
    if (local && locallyDirtyPosts.has(post.id)) {
      return { ...post, ...local, id: post.id };
    }
    const pendingPatch = optimisticPostPatches.get(post.id);
    return pendingPatch ? { ...post, ...pendingPatch, id: post.id } : post;
  });
  const incomingIds = new Set(reconciledPosts.map((post) => post.id));
  const pendingPosts = current.posts.filter(
    (post) =>
      (isOptimisticPost(post) || locallyDirtyPosts.has(post.id)) &&
      !incomingIds.has(post.id),
  );
  const pendingTrashedPosts = (current.trashedPosts ?? []).filter(
    (post) =>
      locallyTrashedPosts.has(postKey(pool.blogId, post.id)) &&
      !confirmedTrashedIds.has(post.id),
  );
  if (
    pendingPosts.length === 0 &&
    pendingTrashedPosts.length === 0 &&
    reconciledPosts.every((post, index) => post === pool.posts[index])
  ) {
    return pool;
  }

  return {
    ...pool,
    posts: [...pendingPosts, ...reconciledPosts],
    trashedPosts: [
      ...pendingTrashedPosts,
      ...(pool.trashedPosts ?? []).filter(
        (post) => !pendingTrashedPosts.some((pending) => pending.id === post.id),
      ),
    ],
  };
}

export function seedWorkspacePool(
  pool: WorkspacePoolPayload,
  initialBody?: WorkspaceInitialBody | null,
) {
  const current = state.pool;
  const shouldReplace =
    !current ||
    current.blogId !== pool.blogId ||
    isNewer(pool.fetchedAt, current.fetchedAt);
  if (shouldReplace) {
    const nextPool = mergeIncomingPool(pool);
    state = { ...state, pool: nextPool, error: null };
    emitPool();
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
    const document = initialDocumentPayload(pool, initial);
    if (!document) continue;
    const key = bodyKey(pool.blogId, initial.postId);
    const existing = state.bodies[key];
    if (locallyDirtyBodies.has(key)) continue;
    if (
      existing?.status === "ready" &&
      !isWorkspacePostDocumentStale(
        document.revision,
        document.updatedAt,
        existing.document.revision,
        existing.document.updatedAt,
      )
    ) {
      continue;
    }
    setBodyEntry(pool.blogId, initial.postId, {
      status: "ready",
      document,
    });
    void persistPostDocument(document);
  }
}

async function performWorkspacePoolRefresh(handle: string, blogId: string) {
  state = { ...state, refreshing: true, error: null };
  try {
    // A local optimistic mutation can land while the request is in flight.
    // Repeat inside this same promise so every awaiting caller observes the
    // first server snapshot that is current with its local mutation.
    while (true) {
      const requestGeneration = poolMutationGeneration;
      const params = new URLSearchParams({ handle });
      const response = await fetch(`/api/workspace/pool?${params.toString()}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Could not refresh the workspace");
      const pool = (await response.json()) as WorkspacePoolPayload;
      if (pool.blogId !== blogId) {
        throw new Error("Workspace response mismatch");
      }
      if (requestGeneration !== poolMutationGeneration) continue;

      const nextPool = mergeIncomingPool(pool);
      setState({ pool: nextPool, refreshing: false, error: null });
      for (const initial of nextPool.initialBodies ?? []) {
        const document = initialDocumentPayload(nextPool, initial);
        if (!document) continue;
        const key = bodyKey(blogId, initial.postId);
        const current = state.bodies[key];
        if (locallyDirtyBodies.has(key)) continue;
        if (
          current?.status === "ready" &&
          !isWorkspacePostDocumentStale(
            document.revision,
            document.updatedAt,
            current.document.revision,
            current.document.updatedAt,
          )
        ) {
          continue;
        }
        setBodyEntry(blogId, initial.postId, {
          status: "ready",
          document,
        });
        void persistPostDocument(document);
      }
      return;
    }
  } catch (error) {
    setState({
      refreshing: false,
      error: error instanceof Error ? error.message : "Could not refresh",
    });
  }
}

export function refreshWorkspacePool(
  handle: string,
  blogId: string,
): Promise<void> {
  const active = activePoolRefresh;
  if (active) {
    if (active.handle === handle && active.blogId === blogId) {
      return active.promise;
    }
    return active.promise.then(() => refreshWorkspacePool(handle, blogId));
  }

  const promise = performWorkspacePoolRefresh(handle, blogId).finally(() => {
    if (activePoolRefresh?.promise === promise) activePoolRefresh = null;
  });
  activePoolRefresh = { blogId, handle, promise };
  return promise;
}

export async function ensurePostDocument(
  blogId: string,
  postId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const key = bodyKey(blogId, postId);
  const existing = state.bodies[key];
  if (bodyFetches.has(key) || existing?.status === "loading") return;
  if (existing?.status === "ready" && !options.force) return;

  bodyFetches.add(key);
  const requestGeneration = bodyMutationGeneration(key);
  if (existing?.status !== "ready") {
    setBodyEntry(blogId, postId, { status: "loading" });
  }

  try {
    if (!options.force) {
      const poolPost = poolPostForDocument(postId);
      const cached = await readPersistedPostDocument(
        blogId,
        postId,
        poolPost?.document,
      );
      if (
        requestGeneration !== bodyMutationGeneration(key) ||
        locallyDirtyBodies.has(key)
      ) {
        return;
      }
      const postRevision = poolPost?.revision;
      const postUpdatedAt = poolPost?.updatedAt;
      if (
        cached &&
        !isWorkspacePostDocumentStale(
          postRevision,
          postUpdatedAt,
          cached.revision,
          cached.updatedAt,
        )
      ) {
        setBodyEntry(blogId, postId, {
          status: "ready",
          document: cached,
        });
        return;
      }
    }

    const response = await fetch(
      `/api/post/${encodeURIComponent(postId)}/body`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("Could not load the item");
    const document = normalizeStoredPostDocument(await response.json(), {
      blogId,
      postId,
    });
    if (!document) {
      throw new Error("Document response mismatch");
    }
    if (
      requestGeneration !== bodyMutationGeneration(key) ||
      locallyDirtyBodies.has(key)
    ) {
      return;
    }
    setBodyEntry(blogId, postId, { status: "ready", document });
    void persistPostDocument(document);
  } catch (error) {
    if (existing?.status !== "ready") {
      if (
        requestGeneration !== bodyMutationGeneration(key) ||
        locallyDirtyBodies.has(key)
      ) {
        return;
      }
      setBodyEntry(blogId, postId, {
        status: "error",
        error: error instanceof Error ? error.message : "Could not load",
      });
    }
  } finally {
    bodyFetches.delete(key);
  }
}

export function useWorkspacePool(initialPool?: WorkspacePoolPayload) {
  const initialServerSnapshot = useMemo<WorkspacePoolState | null>(
    () =>
      initialPool
        ? {
            pool: initialPool,
            refreshing: false,
            error: null,
            bodies: {},
          }
        : null,
    [initialPool],
  );
  const serverSnapshot = useCallback(
    () => initialServerSnapshot ?? getServerSnapshot(),
    [initialServerSnapshot],
  );
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

export function useWorkspacePostDocument(
  blogId: string,
  postId: string,
  initialDocument?: WorkspaceInitialDocument | null,
) {
  const snapshot = useWorkspacePool();
  const key = bodyKey(blogId, postId);
  const cachedEntry = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeBody(key, listener), [key]),
    useCallback(() => state.bodies[key] ?? IDLE_BODY_ENTRY, [key]),
    useCallback(() => state.bodies[key] ?? IDLE_BODY_ENTRY, [key]),
  );
  const initialPayload = initialDocument
    ? documentPayload(blogId, postId, initialDocument.document, {
        revision: initialDocument.revision,
        updatedAt: initialDocument.updatedAt,
        fetchedAt: snapshot.pool?.fetchedAt ?? "",
      })
    : null;
  const entry =
    initialPayload &&
    !locallyDirtyBodies.has(key) &&
    (cachedEntry?.status !== "ready" ||
      isWorkspacePostDocumentStale(
        initialPayload.revision,
        initialPayload.updatedAt,
        cachedEntry.document.revision,
        cachedEntry.document.updatedAt,
      ))
      ? ({ status: "ready", document: initialPayload } as const)
      : cachedEntry;
  const poolPost = snapshot.pool?.posts.find(
    (post) => post.id === postId,
  );
  const stale =
    entry.status === "ready" &&
    isWorkspacePostDocumentStale(
      poolPost?.revision,
      poolPost?.updatedAt,
      entry.document.revision,
      entry.document.updatedAt,
    );
  const load = useCallback(
    (force = stale) => {
      void ensurePostDocument(blogId, postId, { force });
    },
    [blogId, postId, stale],
  );
  return { entry, load, stale };
}

/** Compatibility view while body-only call sites migrate to canonical documents. */
export function useWorkspacePostBody(
  blogId: string,
  postId: string,
  initialBody?: WorkspaceInitialBody | null,
) {
  const snapshot = useWorkspacePool();
  const poolPost = snapshot.pool?.posts.find((post) => post.id === postId);
  const initialDocument =
    initialBody && poolPost?.document
      ? {
          postId,
          document: {
            ...poolPost.document,
            content: { ...poolPost.document.content, body: initialBody.body },
          },
          revision: poolPost.revision,
          updatedAt: initialBody.updatedAt,
        }
      : null;
  const result = useWorkspacePostDocument(blogId, postId, initialDocument);
  const entry =
    result.entry.status === "ready"
      ? ({
          status: "ready",
          body: {
            blogId,
            postId,
            body: result.entry.document.document.content.body,
            updatedAt: result.entry.document.updatedAt,
            fetchedAt: result.entry.document.fetchedAt,
          },
        } as const)
      : result.entry;
  return { ...result, entry };
}

export async function ensurePostBody(
  blogId: string,
  postId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  await ensurePostDocument(blogId, postId, options);
}

export function getWorkspacePost(postId: string): WorkspacePoolPost | null {
  return state.pool?.posts.find((post) => post.id === postId) ?? null;
}

export function getCachedWorkspacePostBody(
  blogId: string,
  postId: string,
): WorkspacePostBodyPayload | null {
  const entry = state.bodies[bodyKey(blogId, postId)];
  if (entry?.status !== "ready") return null;
  return {
    blogId,
    postId,
    body: entry.document.document.content.body,
    updatedAt: entry.document.updatedAt,
    fetchedAt: entry.document.fetchedAt,
  };
}

export function getCachedWorkspacePostDocument(
  blogId: string,
  postId: string,
): WorkspacePostDocumentPayload | null {
  const entry = state.bodies[bodyKey(blogId, postId)];
  return entry?.status === "ready" ? entry.document : null;
}

export function addPost(post: WorkspacePoolPost) {
  if (!state.pool || state.pool.blogId !== post.blogId) return;
  markPoolMutation();
  setState({
    pool: {
      ...state.pool,
      posts: [
        post,
        ...state.pool.posts.filter((entry) => entry.id !== post.id),
      ],
      fetchedAt: new Date().toISOString(),
    },
  });
}

export function replacePost(previousId: string, post: WorkspacePoolPost) {
  if (!state.pool || state.pool.blogId !== post.blogId) return;
  markPoolMutation();
  if (locallyDirtyPosts.delete(previousId)) {
    locallyDirtyPosts.add(post.id);
  }
  const optimisticPatch = optimisticPostPatches.get(previousId);
  optimisticPostPatches.delete(previousId);
  if (optimisticPatch) optimisticPostPatches.set(post.id, optimisticPatch);
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
}

export function updatePost(postId: string, patch: Partial<WorkspacePoolPost>) {
  if (!state.pool) return;
  markPoolMutation();
  optimisticPostPatches.set(postId, {
    ...(optimisticPostPatches.get(postId) ?? {}),
    ...patch,
  });
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
}

export function markPostDirty(postId: string) {
  locallyDirtyPosts.add(postId);
}

export function acknowledgePost(postId: string) {
  locallyDirtyPosts.delete(postId);
  optimisticPostPatches.delete(postId);
}

export function updateWorkspaceBlog(
  patch: Partial<WorkspacePoolPayload["blog"]>,
) {
  if (!state.pool) return;
  markPoolMutation();
  setState({
    pool: {
      ...state.pool,
      blog: { ...state.pool.blog, ...patch },
      fetchedAt: new Date().toISOString(),
    },
  });
}

export function updatePostDocument(
  blogId: string,
  postId: string,
  document: DocumentSnapshot,
) {
  const key = bodyKey(blogId, postId);
  advanceBodyMutationGeneration(key);
  locallyDirtyBodies.add(key);
  const current = getCachedWorkspacePostDocument(blogId, postId);
  const poolPost = poolPostForDocument(postId);
  const nextDocument = documentPayload(blogId, postId, document, {
    revision: current?.revision ?? poolPost?.revision,
    updatedAt: new Date().toISOString(),
  });
  setBodyEntry(blogId, postId, {
    status: "ready",
    document: nextDocument,
  });
  void persistPostDocument(nextDocument);
}

export function acknowledgePostDocument(
  blogId: string,
  postId: string,
  document: DocumentSnapshot,
  revision?: number,
  updatedAt?: string,
) {
  const key = bodyKey(blogId, postId);
  advanceBodyMutationGeneration(key);
  locallyDirtyBodies.delete(key);
  const nextDocument = documentPayload(blogId, postId, document, {
    revision,
    updatedAt,
  });
  setBodyEntry(blogId, postId, {
    status: "ready",
    document: nextDocument,
  });
  void persistPostDocument(nextDocument);
}

function documentWithBody(
  blogId: string,
  postId: string,
  body: string,
): DocumentSnapshot {
  const canonical =
    getCachedWorkspacePostDocument(blogId, postId)?.document ??
    poolPostForDocument(postId)?.document;
  if (!canonical) {
    throw new Error(`Cannot update item ${postId} without a canonical document`);
  }
  return {
    ...canonical,
    content: { ...canonical.content, body },
  };
}

export function updatePostBody(blogId: string, postId: string, body: string) {
  updatePostDocument(blogId, postId, documentWithBody(blogId, postId, body));
}

export function acknowledgePostBody(
  blogId: string,
  postId: string,
  body: string,
  updatedAt?: string,
) {
  acknowledgePostDocument(
    blogId,
    postId,
    documentWithBody(blogId, postId, body),
    poolPostForDocument(postId)?.revision,
    updatedAt,
  );
}

export function removePost(postId: string) {
  if (!state.pool) return;
  markPoolMutation();
  locallyDirtyPosts.delete(postId);
  optimisticPostPatches.delete(postId);
  locallyDirtyBodies.delete(bodyKey(state.pool.blogId, postId));
  setState({
    pool: {
      ...state.pool,
      posts: state.pool.posts.filter((post) => post.id !== postId),
      fetchedAt: new Date().toISOString(),
    },
  });
}

export function movePostToTrash(postId: string): WorkspacePoolPost | null {
  if (!state.pool) return null;
  const post = state.pool.posts.find((entry) => entry.id === postId) ?? null;
  if (!post) return null;
  markPoolMutation();
  locallyTrashedPosts.add(postKey(state.pool.blogId, postId));
  locallyDirtyPosts.delete(postId);
  optimisticPostPatches.delete(postId);
  locallyDirtyBodies.delete(bodyKey(state.pool.blogId, postId));
  setState({
    pool: {
      ...state.pool,
      posts: state.pool.posts.filter((entry) => entry.id !== postId),
      trashedPosts: [
        post,
        ...(state.pool.trashedPosts ?? []).filter(
          (entry) => entry.id !== postId,
        ),
      ],
      fetchedAt: new Date().toISOString(),
    },
  });
  return post;
}

export function restorePostFromTrash(postId: string): WorkspacePoolPost | null {
  if (!state.pool) return null;
  const post =
    (state.pool.trashedPosts ?? []).find((entry) => entry.id === postId) ??
    null;
  if (!post) return null;
  markPoolMutation();
  locallyTrashedPosts.delete(postKey(state.pool.blogId, postId));
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
  return post;
}

export function removeTrashedPost(postId: string) {
  if (!state.pool) return;
  const blogId = state.pool.blogId;
  markPoolMutation();
  locallyTrashedPosts.delete(postKey(blogId, postId));
  removeBodyEntry(blogId, postId);
  void deletePersistedPostDocument(blogId, postId);
  setState({
    pool: {
      ...state.pool,
      trashedPosts: (state.pool.trashedPosts ?? []).filter(
        (entry) => entry.id !== postId,
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
}

export function moveFolderToTrash(folderId: string) {
  if (!state.pool) return;
  const target = state.pool.folders.find((folder) => folder.id === folderId);
  if (!target) return;
  markPoolMutation();
  const removedFolders = state.pool.folders.filter(
    (folder) =>
      folder.path === target.path || folder.path.startsWith(`${target.path}/`),
  );
  const removedIds = new Set(removedFolders.map((folder) => folder.id));
  const removedPosts = state.pool.posts.filter((post) =>
    Boolean(post.folderId && removedIds.has(post.folderId)),
  );
  const removedPostIds = new Set(removedPosts.map((post) => post.id));
  setState({
    pool: {
      ...state.pool,
      folders: state.pool.folders.filter(
        (folder) => !removedIds.has(folder.id),
      ),
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
}

export function restoreFolderFromTrash(folderId: string) {
  if (!state.pool) return;
  const target = (state.pool.trashedFolders ?? []).find(
    (folder) => folder.id === folderId,
  );
  if (!target) return;
  markPoolMutation();
  const restoredFolders = (state.pool.trashedFolders ?? []).filter(
    (folder) =>
      folder.path === target.path || folder.path.startsWith(`${target.path}/`),
  );
  const restoredIds = new Set(restoredFolders.map((folder) => folder.id));
  const restoredPosts = (state.pool.trashedPosts ?? []).filter((post) =>
    Boolean(post.folderId && restoredIds.has(post.folderId)),
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
}

export function removeTrashedFolder(folderId: string) {
  if (!state.pool) return;
  const target = (state.pool.trashedFolders ?? []).find(
    (folder) => folder.id === folderId,
  );
  if (!target) return;
  markPoolMutation();
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
}

export function movePost(postId: string, folderId: string | undefined) {
  updatePost(postId, { folderId });
}

export function updateFolder(folderId: string, patch: Partial<Folder>) {
  if (!state.pool) return;
  markPoolMutation();
  setState({
    pool: {
      ...state.pool,
      folders: state.pool.folders.map((folder) =>
        folder.id === folderId
          ? { ...folder, ...patch, id: folder.id }
          : folder,
      ),
      fetchedAt: new Date().toISOString(),
    },
  });
}
