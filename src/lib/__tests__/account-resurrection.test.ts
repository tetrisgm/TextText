// A deleted account must not come back on its own.
//
// Sessions are JWTs with no server-side session table, so a cookie minted
// before a deletion still verifies afterwards. Without the fence, the next
// authenticated request reaches upsertUser, whose onConflictDoUpdate inserts
// the users row straight back, and ensureOwnerBlog then provisions a brand new
// workspace. The account would silently resurrect itself, which is both a
// broken promise to the person and a compliance failure.
//
// The name holds matter for a different reason: /@username and /t/handle are
// addresses other people linked to, so handing them to the next signup would
// point somebody else's readers at a stranger.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync("src/lib/store.ts", "utf8");
const authSource = readFileSync("src/auth.ts", "utf8");

function bodyOf(source: string, declaration: string, stop: string): string {
  const start = source.indexOf(declaration);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(stop, start);
  return source.slice(start, end === -1 ? undefined : end);
}

describe("the resurrection fence", () => {
  it("checks for a tombstone before upsertUser can insert a users row", () => {
    const body = bodyOf(
      storeSource,
      "async function upsertUser(",
      "function usernameSeedForUser",
    );
    const guard = body.indexOf("findAccountTombstone");
    const insert = body.indexOf(".insert(users)");
    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    // The order is the whole point: a check after the insert is no check.
    expect(guard).toBeLessThan(insert);
    expect(body).toMatch(/throw new AccountDeletedError\(\)/);
  });

  it("holds the released handle so the next signup cannot take it", () => {
    const body = bodyOf(
      storeSource,
      "async function uniqueHandle(",
      "export async function getOwnedBlog",
    );
    expect(body).toMatch(/deletedAccounts\.handle/);
    expect(body).toMatch(/!taken\[0\] && !held\[0\]/);
  });

  it("holds the released username too", () => {
    const body = bodyOf(
      storeSource,
      "async function uniqueUsername(",
      "async function ensureUserUsername",
    );
    expect(body).toMatch(/deletedAccounts\.username/);
    expect(body).toMatch(/!taken\[0\] && !held\[0\]/);
  });

  it("stores a one-way hash of the sub, never the sub itself", () => {
    const body = bodyOf(
      storeSource,
      "export function hashAccountSub(",
      "export type AccountTombstone",
    );
    expect(body).toMatch(/createHash\("sha256"\)/);
  });

  it("finishes an interrupted purge before releasing the identity", () => {
    // Clearing the tombstone first would strand the leftover rows forever:
    // nothing else records that they are owed.
    const resume = authSource.indexOf("resumeAccountDeletion");
    const clear = authSource.indexOf("clearAccountTombstone(identity)");
    expect(resume).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(resume).toBeLessThan(clear);
  });

  it("only lifts the fence on a deliberate interactive sign-in", () => {
    // The clear lives inside the `if (account)` branch, which runs only when a
    // real sign-in produced an account object. A stale cookie never reaches it.
    const branch = bodyOf(
      authSource,
      "if (account) {",
      "if (account && profile",
    );
    expect(branch).toMatch(/clearAccountTombstone/);
  });
});
