// The last gate before anything reaches a sessionless reader.
//
// Two of these cases used to read the demo seed through the store with no
// database configured, which only ever exercised the in-memory fallback. Demo
// mode was removed 2026-08-14; the guards that matter are pure, so they are
// tested against constructed fixtures and hold for whatever the database
// returns.

import { describe, expect, it } from "vitest";
import { isPublishedPublicPost } from "@/lib/content";
import { publishedPublicLocations } from "@/lib/agent-surface";
import type { PublicPostLocation } from "@/lib/store";
import type { Post } from "@/lib/content";

function post(patch: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    type: "article",
    slug: "published",
    title: "A published article",
    body: "Body",
    status: "published",
    visibility: "public",
    ...patch,
  };
}

function location(patch: Partial<Post> = {}): PublicPostLocation {
  return { folderPath: "blog", post: post(patch) };
}

describe("public URL side channels", () => {
  it("requires status, visibility, and item kind to agree before publishing", () => {
    const base = {
      type: "article" as const,
      visibility: "public" as const,
      status: "published" as const,
    };

    expect(isPublishedPublicPost(base)).toBe(true);
    expect(isPublishedPublicPost({ ...base, status: "draft" })).toBe(false);
    expect(isPublishedPublicPost({ ...base, visibility: "private" })).toBe(false);
    expect(isPublishedPublicPost({ ...base, type: "note" })).toBe(false);
    expect(isPublishedPublicPost({ ...base, type: "bookmark" })).toBe(false);
  });

  it("removes unpublished titles again at the public payload boundary", () => {
    const published = location();
    const locations = publishedPublicLocations([
      published,
      location({
        id: "deliberate-draft",
        slug: "deliberate-draft",
        title: "Do not serialize this title",
        status: "draft",
      }),
    ]);

    expect(JSON.stringify(locations)).not.toContain(
      "Do not serialize this title",
    );
    expect(locations).toEqual([published]);
  });

  it("drops every unlisted kind and private item at that same boundary", () => {
    const published = location();
    const locations = publishedPublicLocations([
      published,
      location({ id: "n", slug: "a-note", type: "note" }),
      location({ id: "b", slug: "a-bookmark", type: "bookmark" }),
      location({ id: "p", slug: "private", visibility: "private" }),
    ]);

    expect(locations).toEqual([published]);
  });
});
