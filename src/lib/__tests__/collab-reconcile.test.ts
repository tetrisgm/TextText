import { beforeEach, describe, expect, it, vi } from "vitest";

// reconcileCollabLogAfterExternalWrite is the safety valve behind the external
// write paths: it retires an orphaned co-editing log so a stale replay cannot
// clobber a later body write, but it must NEVER clear a log a live session
// still owns. These prove both branches against a mocked db.

const state = vi.hoisted(() => ({
  presenceRows: [] as Array<Record<string, unknown>>,
  deleteWhere: vi.fn(async () => {}),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({ where: async () => state.presenceRows }),
    }),
    delete: () => ({ where: state.deleteWhere }),
  },
}));

const { reconcileCollabLogAfterExternalWrite, resetCollabLog } = await import(
  "@/lib/collab"
);

const POST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("reconcileCollabLogAfterExternalWrite", () => {
  beforeEach(() => {
    state.presenceRows = [];
    state.deleteWhere.mockClear();
  });

  it("clears the log when no editors are actively co-editing", async () => {
    state.presenceRows = [];
    await reconcileCollabLogAfterExternalWrite(POST_ID);
    // resetCollabLog ran: exactly one delete (the collab_updates purge).
    expect(state.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("leaves the log intact while a live session still owns it", async () => {
    // A fresh presence heartbeat means an editor is live; their updates are the
    // source of truth and the log must survive.
    state.presenceRows = [
      {
        clientId: "c1",
        userName: "Ada",
        color: "#112233",
        updatedAt: new Date(),
      },
    ];
    await reconcileCollabLogAfterExternalWrite(POST_ID);
    expect(state.deleteWhere).not.toHaveBeenCalled();
  });

  it("resetCollabLog always purges regardless of presence", async () => {
    state.presenceRows = [
      {
        clientId: "c1",
        userName: "Ada",
        color: "#112233",
        updatedAt: new Date(),
      },
    ];
    await resetCollabLog(POST_ID);
    expect(state.deleteWhere).toHaveBeenCalledTimes(1);
  });
});
