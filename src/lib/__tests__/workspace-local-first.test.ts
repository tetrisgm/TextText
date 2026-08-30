import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { initialDraft } from "@/lib/post-edit-draft";
import type { Post } from "@/lib/content";

vi.mock("@/lib/pool/storage", () => ({
  deletePersistedPostBody: vi.fn(async () => undefined),
  persistPostBody: vi.fn(async () => undefined),
  readPersistedPostBody: vi.fn(async () => null),
}));

function pool(
  fetchedAt: string,
  posts: WorkspacePoolPayload["posts"],
  trashedPosts: WorkspacePoolPayload["posts"] = [],
): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "blog-1",
    fetchedAt,
    blog: {
      handle: "local-first",
      name: "Local first",
      author: "Local writer",
      tagline: "",
      homeLayout: "grid",
    },
    folders: [],
    posts,
    trashedPosts,
    trashedFolders: [],
    counts: {},
    templates: [],
    initialBodies: [],
  };
}

function post(title = "Local title"): WorkspacePoolPayload["posts"][number] {
  return {
    id: "post-1",
    blogId: "blog-1",
    type: "article",
    slug: "local-title",
    title,
    status: "draft",
    pinned: false,
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("workspace local authority", () => {
  it("does not let an older seed replace a newer pool because its length differs", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:01:00.000Z", [post()]));
    store.seedWorkspacePool(
      pool("2026-07-10T10:00:00.000Z", [
        post("Old server title"),
        { ...post("Old extra item"), id: "post-2" },
      ]),
    );

    expect(store.getWorkspacePost("post-1")?.title).toBe("Local title");
    expect(store.getWorkspacePost("post-2")).toBeNull();
  });

  it("preserves a dirty item omitted by a newer server snapshot", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [post()]));
    store.markPostDirty("post-1");
    store.seedWorkspacePool(pool("2026-07-10T10:01:00.000Z", []));

    expect(store.getWorkspacePost("post-1")?.title).toBe("Local title");
  });

  it("removes a permanently deleted item's memory and IndexedDB body", async () => {
    const store = await import("@/lib/pool/store");
    const storage = await import("@/lib/pool/storage");
    const original = post();
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [original]));
    store.acknowledgePostBody("blog-1", original.id, "cached body");
    store.movePostToTrash(original.id);

    store.removeTrashedPost(original.id);

    expect(store.getCachedWorkspacePostBody("blog-1", original.id)).toBeNull();
    expect(storage.deletePersistedPostBody).toHaveBeenCalledWith(
      "blog-1",
      original.id,
    );
  });

  it("does not let a newer same-ID snapshot roll back a dirty local edit", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [post()]));
    store.markPostDirty("post-1");
    store.updatePost("post-1", {
      title: "Newest local title",
      excerpt: "Newest local excerpt",
    });

    store.seedWorkspacePool(
      pool("2026-07-10T10:01:00.000Z", [
        {
          ...post("Stale server title"),
          excerpt: "Stale server excerpt",
          updatedAt: "2026-07-10T10:01:00.000Z",
        },
      ]),
    );

    expect(store.getWorkspacePost("post-1")?.title).toBe("Newest local title");
    expect(store.getWorkspacePost("post-1")?.excerpt).toBe(
      "Newest local excerpt",
    );
  });

  it("keeps a locally trashed item out of active lists until the server confirms it", async () => {
    const store = await import("@/lib/pool/store");
    const original = post();
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [original]));

    expect(store.movePostToTrash(original.id)?.id).toBe(original.id);
    store.seedWorkspacePool(
      pool("2026-07-10T10:01:00.000Z", [
        { ...original, updatedAt: "2026-07-10T10:01:00.000Z" },
      ]),
    );

    expect(store.getWorkspacePost(original.id)).toBeNull();
  });

  it("does not let a stale response restore an item after trash was confirmed", async () => {
    const store = await import("@/lib/pool/store");
    const original = post();
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [original]));
    store.movePostToTrash(original.id);

    store.seedWorkspacePool(pool("2026-07-10T10:01:00.000Z", [], [original]));
    store.seedWorkspacePool(
      pool("2026-07-10T10:02:00.000Z", [
        { ...original, updatedAt: "2026-07-10T10:02:00.000Z" },
      ]),
    );

    expect(store.getWorkspacePost(original.id)).toBeNull();
  });

  it("lets concurrent callers await the active pool refresh", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [post()]));
    let resolveRefresh: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = store.refreshWorkspacePool("local-first", "blog-1");
    const second = store.refreshWorkspacePool("local-first", "blog-1");
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secondSettled).toBe(false);

    resolveRefresh(
      new Response(
        JSON.stringify(
          pool("2026-07-10T10:01:00.000Z", [post("Fresh title")]),
        ),
        { status: 200 },
      ),
    );
    await Promise.all([first, second]);

    expect(secondSettled).toBe(true);
    expect(store.getWorkspacePost("post-1")?.title).toBe("Fresh title");
  });

  it("repeats an in-flight refresh after a local mutation instead of resolving stale", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [post()]));
    const responses: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            responses.push(resolve);
          }),
      ),
    );

    const refresh = store.refreshWorkspacePool("local-first", "blog-1");
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    store.addPost({ ...post("Optimistic"), id: "optimistic-note-1" });
    responses[0]?.(
      new Response(
        JSON.stringify(pool("2026-07-10T10:01:00.000Z", [post("Stale")])),
        { status: 200 },
      ),
    );
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    responses[1]?.(
      new Response(
        JSON.stringify(pool("2026-07-10T10:02:00.000Z", [post("Fresh")])),
        { status: 200 },
      ),
    );
    await refresh;

    expect(store.getWorkspacePost("post-1")?.title).toBe("Fresh");
    expect(store.getWorkspacePost("optimistic-note-1")?.title).toBe(
      "Optimistic",
    );
  });

  it("restores a locally trashed item when the server mutation fails", async () => {
    const store = await import("@/lib/pool/store");
    const original = post();
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [original]));
    store.movePostToTrash(original.id);

    expect(store.restorePostFromTrash(original.id)?.id).toBe(original.id);
    expect(store.getWorkspacePost(original.id)?.title).toBe(original.title);
  });

  it("keeps an optimistic patch until the server acknowledges its values", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [post()]));
    store.updatePost("post-1", { title: "Optimistic title" });

    store.seedWorkspacePool(
      pool("2026-07-10T10:01:00.000Z", [post("Stale server title")]),
    );
    expect(store.getWorkspacePost("post-1")?.title).toBe("Optimistic title");

    store.seedWorkspacePool(
      pool("2026-07-10T10:02:00.000Z", [post("Optimistic title")]),
    );
    expect(store.getWorkspacePost("post-1")?.title).toBe("Optimistic title");
  });

  it("does not acknowledge an optimistic patch from an ignored older seed", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:01:00.000Z", [post()]));
    store.updatePost("post-1", { title: "Optimistic title" });

    store.seedWorkspacePool(
      pool("2026-07-10T10:00:00.000Z", [post("Optimistic title")]),
    );
    store.seedWorkspacePool(
      pool("2026-07-10T10:02:00.000Z", [post("Stale server title")]),
    );

    expect(store.getWorkspacePost("post-1")?.title).toBe("Optimistic title");
  });

  it("does not let a failed older body request replace a newer local body", async () => {
    const store = await import("@/lib/pool/store");
    store.seedWorkspacePool(pool("2026-07-10T10:00:00.000Z", [post()]));
    let rejectRequest: (reason: Error) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectRequest = reject;
          }),
      ),
    );

    const request = store.ensurePostBody("blog-1", "post-1", { force: true });
    store.updatePostBody("blog-1", "post-1", "Newest local body");
    rejectRequest(new Error("stale request failed"));
    await request;

    expect(store.getCachedWorkspacePostBody("blog-1", "post-1")?.body).toBe(
      "Newest local body",
    );
  });
});

describe("literal titles", () => {
  it("keeps a deliberately saved Untitled title", () => {
    const saved = {
      ...post("Untitled"),
      slug: "untitled",
      body: "",
    } as Post;
    expect(initialDraft(saved).title).toBe("Untitled");
  });
});
