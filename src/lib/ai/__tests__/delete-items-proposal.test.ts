import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceWriteProposal,
  decideWorkspaceWriteProposal,
  type WorkspaceWriteProposalDependencies,
} from "@/lib/ai/write-proposals.server";

/**
 * Deleting was the largest hole in "the AI can do anything to my items": the
 * browser assistant could not delete at all, because nothing confirmation-gated
 * could be staged. The rule was sound and its conclusion too broad. A proposal
 * IS a confirmation, provided the person is shown what will actually happen
 * rather than a list of ids, and provided the world has not moved by the time
 * they approve.
 */

type Item = { title: string; folderPath: string; visibility: "public" | "private"; revision: number | null };

function harness(world: Map<string, Item>) {
  const rows = new Map<string, Record<string, unknown>>();
  const execute = vi.fn(async () => ({
    content: [{ type: "text", text: "{}" }],
    structuredContent: { trashed: 1 },
  }));
  const dependencies: WorkspaceWriteProposalDependencies = {
    repository: {
      async create(row: { id: string }) {
        rows.set(row.id, { ...row, status: "pending" });
      },
      async get(id: string) {
        return (rows.get(id) as never) ?? null;
      },
      async state(id: string) {
        const row = rows.get(id);
        return row ? (row as never) : null;
      },
      async claim(id: string) {
        const row = rows.get(id);
        if (!row || row.status !== "pending") return null;
        row.status = "approved";
        return row as never;
      },
      async deny() {
        return true;
      },
      async complete() {},
      async fail(id: string, _binding: unknown, code: string) {
        const row = rows.get(id);
        if (row) {
          row.status = "failed";
          row.failureCode = code;
        }
      },
    } as never,
    resolveWorkspace: async (handle) =>
      handle === "alpha" ? { id: "blog-1", handle, ownerId: "user-1" } : null,
    execute,
    now: () => new Date("2026-08-29T12:00:00.000Z"),
    randomId: () => "11111111-1111-4111-8111-111111111111",
    resolveItems: async (_handle, ids) =>
      new Map([...world].filter(([id]) => ids.includes(id))),
  };
  return { dependencies, execute, rows };
}

const owner = { sub: "owner-sub", userId: "user-1", handle: "alpha" };

const world = () =>
  new Map<string, Item>([
    ["a", { title: "Half an idea about caching", folderPath: "notes", visibility: "private", revision: 11 }],
    ["b", { title: "What the outage taught us", folderPath: "blog", visibility: "public", revision: 22 }],
  ]);

describe("staging a deletion for the owner to approve", () => {
  it("shows the items by name and says what it will cost", async () => {
    const { dependencies } = harness(world());
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
      dependencies,
    );
    expect(preview.summary).toContain("Half an idea about caching");
    expect(preview.summary).toContain("What the outage taught us");
    expect(preview.summary).toMatch(/1 of them is published/);
    expect(preview.summary).toContain("restorable");
  });

  it("runs exactly what was approved when nothing has moved", async () => {
    const { dependencies, execute } = harness(world());
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
      dependencies,
    );
    await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: preview.id, decision: "approve" },
      dependencies,
    );
    // The revisions the owner was shown travel with the approval, so a change
    // between this check and the executor's own read cannot become the version
    // that gets deleted.
    expect(execute).toHaveBeenCalledWith(
      "delete_items",
      { ids: ["a", "b"], expected_revisions: { a: 11, b: 22 } },
      owner,
    );
  });
});

describe("when the record of what was shown is not there", () => {
  it("refuses rather than running unchecked", () => {
    // The drift block only ran when the metadata happened to parse, so a
    // proposal arriving without a preview skipped the check entirely. A
    // command that must be shown before it runs has to fail closed when there
    // is no record of it having been shown.
    return (async () => {
      const { dependencies, execute, rows } = harness(world());
      const preview = await createWorkspaceWriteProposal(
        { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
        dependencies,
      );
      const row = rows.get(preview.id)!;
      row.metadata = null;
      const decided = await decideWorkspaceWriteProposal(
        { actor: owner, proposalId: preview.id, decision: "approve" },
        dependencies,
      );
      expect(execute).not.toHaveBeenCalled();
      expect(decided.status).toBe("failed");
      expect(String((decided as { message?: string }).message)).toMatch(
        /was not recorded when it was offered/,
      );
    })();
  });

  it("refuses when the record is there but unreadable", async () => {
    const { dependencies, execute, rows } = harness(world());
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a"] } },
      dependencies,
    );
    rows.get(preview.id)!.metadata = { preview: { kind: "something-else" } };
    const decided = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: preview.id, decision: "approve" },
      dependencies,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(decided.status).toBe("failed");
  });
});

describe("when the world moves between showing and approving", () => {
  it("drops an item someone edited, and does the rest", async () => {
    const now = world();
    const { dependencies, execute } = harness(now);
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
      dependencies,
    );
    now.set("a", { ...now.get("a")!, revision: 99 });
    await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: preview.id, decision: "approve" },
      dependencies,
    );
    expect(execute).toHaveBeenCalledWith(
      "delete_items",
      { ids: ["b"], expected_revisions: { b: 22 } },
      owner,
    );
  });

  it("drops an item that became public since it was shown", async () => {
    // The person approved deleting a draft. Deleting something people can now
    // see is a different act and they have not agreed to it.
    const now = world();
    const { dependencies, execute } = harness(now);
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
      dependencies,
    );
    now.set("a", { ...now.get("a")!, visibility: "public" });
    await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: preview.id, decision: "approve" },
      dependencies,
    );
    expect(execute).toHaveBeenCalledWith(
      "delete_items",
      { ids: ["b"], expected_revisions: { b: 22 } },
      owner,
    );
  });

  it("does nothing at all when everything moved", async () => {
    const now = world();
    const { dependencies, execute } = harness(now);
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
      dependencies,
    );
    now.set("a", { ...now.get("a")!, revision: 99 });
    now.set("b", { ...now.get("b")!, revision: 98 });
    const decided = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: preview.id, decision: "approve" },
      dependencies,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(decided.status).toBe("failed");
    expect(String((decided as { message?: string }).message)).toMatch(
      /still as it was when you saw it/,
    );
  });

  it("does not treat an already-deleted item as drift", async () => {
    // The outcome the person wanted has already happened to it.
    const now = world();
    const { dependencies, execute } = harness(now);
    const preview = await createWorkspaceWriteProposal(
      { actor: owner, tool: "delete_items", arguments: { ids: ["a", "b"] } },
      dependencies,
    );
    now.delete("a");
    await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: preview.id, decision: "approve" },
      dependencies,
    );
    expect(execute).toHaveBeenCalledWith(
      "delete_items",
      { ids: ["b"], expected_revisions: { b: 22 } },
      owner,
    );
  });
});
