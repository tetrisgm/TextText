// The tag query's privacy guards, asserted against the SQL that ships.
//
// This used to be a behavioral test driven by the demo seed with `db` mocked to
// null. That proved the in-memory fallback filtered correctly, which was never
// the code serving anybody: production always read Postgres. Demo mode was
// removed 2026-08-14, so the invariant is guarded here at the source instead.
// A tag page is public, so the guards below are the difference between a tag
// listing and a leak.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync(
  new URL("../store.ts", import.meta.url),
  "utf8",
);

function tagQuerySource(): string {
  const start = storeSource.indexOf("async function getPostsForTagUncached(");
  expect(start, "getPostsForTagUncached must exist").toBeGreaterThan(-1);
  const end = storeSource.indexOf("\n}", start);
  return storeSource.slice(start, end);
}

describe("getPostsForTag privacy guards", () => {
  it("never lets an unlisted kind reach a tag listing", () => {
    const query = tagQuerySource();
    expect(query).toContain('ne(posts.type, "note")');
    expect(query).toContain('ne(posts.type, "bookmark")');
  });

  it("requires published status and public visibility to agree", () => {
    const query = tagQuerySource();
    expect(query).toContain('publishedOnly ? eq(posts.visibility, "public")');
    expect(query).toContain('publishedOnly ? eq(posts.status, "published")');
  });

  it("scopes to one live workspace and skips trashed rows", () => {
    const query = tagQuerySource();
    expect(query).toContain("eq(blogs.handle, handle)");
    expect(query).toContain("isNull(blogs.deletedAt)");
    expect(query).toContain("isNull(posts.deletedAt)");
  });
});
