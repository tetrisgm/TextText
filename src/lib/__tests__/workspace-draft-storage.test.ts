import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deletePersistedWorkspaceDraft,
  persistWorkspaceDraft,
  readPersistedWorkspaceDraft,
} from "@/lib/pool/storage";
import type { DraftState } from "@/lib/post-edit-draft";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function draft(title: string): DraftState {
  return {
    type: "article",
    title,
    excerpt: "",
    cover: "",
    coverCaption: "",
    coverHeight: null,
    body: "",
    status: "draft",
    slug: "draft",
    accent: "",
    gallery: [],
    videoUrl: "",
    venue: "",
    duration: "",
    date: "",
  };
}

function snapshot(title: string) {
  return {
    blogId: "workspace-1",
    postId: "post-1",
    draft: draft(title),
    key: title,
    persistedAt: new Date().toISOString(),
  };
}

describe("workspace draft crash recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("indexedDB", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes the latest rapid edit readable before asynchronous work finishes", async () => {
    const writes = Array.from({ length: 100 }, (_, index) =>
      persistWorkspaceDraft(snapshot(`Draft ${index}`)),
    );

    await expect(
      readPersistedWorkspaceDraft("workspace-1", "post-1"),
    ).resolves.toMatchObject({ key: "Draft 99", draft: { title: "Draft 99" } });
    await Promise.all(writes);
  });

  it("does not let an older acknowledgement delete a newer draft", async () => {
    await persistWorkspaceDraft(snapshot("Older"));
    await persistWorkspaceDraft(snapshot("Newer"));

    await deletePersistedWorkspaceDraft("workspace-1", "post-1", "Older");

    await expect(
      readPersistedWorkspaceDraft("workspace-1", "post-1"),
    ).resolves.toMatchObject({ key: "Newer", draft: { title: "Newer" } });
  });

  it("hides an acknowledged draft immediately", async () => {
    await persistWorkspaceDraft(snapshot("Saved"));
    await deletePersistedWorkspaceDraft("workspace-1", "post-1", "Saved");

    await expect(
      readPersistedWorkspaceDraft("workspace-1", "post-1"),
    ).resolves.toBeNull();
  });
});
