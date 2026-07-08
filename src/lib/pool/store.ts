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

export function seedWorkspacePool(
  pool: WorkspacePoolPayload,
  initialBody?: WorkspaceInitialBody | null,
) {
  const current = state.pool;
  const shouldReplace =
    !current ||
    current.blogId !== pool.blogId ||
    isNewer(pool.fetchedAt, current.fetchedAt) ||
    current.posts.length !== pool.posts.length;
  if (shouldReplace) {
    state = { ...state, pool, error: null };
    emit();
    void persistPool(pool);
  }

  if (initialBody) {
    const body: WorkspacePostBodyPayload = {
      blogId: pool.blogId,
      postId: initialBody.postId,
      body: initialBody.body,
      updatedAt: initialBody.updatedAt,
      fetchedAt: new Date().toISOString(),
    };
    setBodyEntry(pool.blogId, initialBody.postId, {
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
  if (!current || current.blogId !== blogId || isNewer(cached.fetchedAt, current.fetchedAt)) {
    setState({ pool: cached, error: null });
  }
}

export async function refreshWorkspacePool(handle: string, blogId: string) {
  if (state.refreshing) return;
  setState({ refreshing: true, error: null });
  try {
    const params = new URLSearchParams({ handle });
    const response = await fetch(`/api/workspace/pool?${params.toString()}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Could not refresh the workspace");
    const pool = (await response.json()) as WorkspacePoolPayload;
    if (pool.blogId !== blogId) throw new Error("Workspace response mismatch");
    setState({ pool, refreshing: false, error: null });
    void persistPool(pool);
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
): Promise<void> {
  const key = bodyKey(blogId, postId);
  const existing = state.bodies[key];
  if (existing?.status === "ready" || existing?.status === "loading") return;

  setBodyEntry(blogId, postId, { status: "loading" });
  const cached = await readPersistedPostBody(blogId, postId);
  if (cached) {
    setBodyEntry(blogId, postId, { status: "ready", body: cached });
    return;
  }

  try {
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
    setBodyEntry(blogId, postId, {
      status: "error",
      error: error instanceof Error ? error.message : "Could not load",
    });
  }
}

export function useWorkspacePool() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useWorkspacePostBody(blogId: string, postId: string) {
  const snapshot = useWorkspacePool();
  const entry = snapshot.bodies[bodyKey(blogId, postId)] ?? { status: "idle" };
  const load = useCallback(() => {
    void ensurePostBody(blogId, postId);
  }, [blogId, postId]);
  return { entry, load };
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

export function movePost(postId: string, folderId: string | undefined) {
  updatePost(postId, { folderId });
}
