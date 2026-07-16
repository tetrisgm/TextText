import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises store.titleRevertsRecentRename directly (the route tests mock it).
// The signal is membership in post_title_history within the window; the aged-base
// multi-step behaviour that a set-time window would miss is validated end-to-end
// against a live DB in the ship checks, since it depends on the AFTER UPDATE
// trigger's supersede timestamps rather than logic reachable through a mock.
const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return holder.db;
  },
}));

const { titleRevertsRecentRename } = await import("@/lib/store");

const POST_ID = "34c3c5e7-8c81-48f9-8208-b9e3457618b0";

// Minimal fake matching store's usage: db.select(f).from(t).where(c).limit(n)
// resolves to the queued row set. The guard runs exactly one select.
function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return { limit: () => Promise.resolve(rows) };
            },
          };
        },
      };
    },
  };
}

beforeEach(() => {
  holder.db = null;
});

describe("titleRevertsRecentRename", () => {
  it("is a no-op without a database (demo seed)", async () => {
    holder.db = null;
    expect(await titleRevertsRecentRename(POST_ID, "anything")).toBe(false);
  });

  it("blocks a revert to a title the post was superseded away from in-window", async () => {
    // A history row exists for this (post, title) within the window: the guard
    // treats it as a stale echo and refuses it.
    holder.db = fakeDb([{ id: "history-row" }]);
    expect(await titleRevertsRecentRename(POST_ID, "ESTABLISHED_BASE")).toBe(
      true,
    );
  });

  it("allows a genuine rename to a title not in recent history", async () => {
    holder.db = fakeDb([]);
    expect(await titleRevertsRecentRename(POST_ID, "a-brand-new-title")).toBe(
      false,
    );
  });
});
