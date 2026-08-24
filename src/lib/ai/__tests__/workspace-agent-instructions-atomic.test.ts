import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditInsertQuery: vi.fn(() => ({ kind: "audit-query" })),
  deleteQuery: {
    where: vi.fn(),
  },
  executeAtomicBatch: vi.fn(),
  insertQuery: {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  auditInsertQuery: mocks.auditInsertQuery,
}));
vi.mock("@/lib/db/client", () => ({
  db: {},
  executeAtomicBatch: mocks.executeAtomicBatch,
}));
vi.mock("@/lib/store", () => ({
  getUserIdBySub: vi.fn(),
}));

import {
  removeWorkspaceAgentSettings,
  saveWorkspaceAgentSettings,
} from "@/lib/ai/workspace-agent-instructions.server";

describe("atomic workspace agent instruction persistence", () => {
  let builtQueries: readonly unknown[];
  const mutationQuery = { kind: "mutation-query" };
  const database = {
    delete: vi.fn(() => mocks.deleteQuery),
    insert: vi.fn(() => mocks.insertQuery),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    builtQueries = [];
    mocks.insertQuery.values.mockReturnValue(mocks.insertQuery);
    mocks.insertQuery.onConflictDoUpdate.mockReturnValue(mutationQuery);
    mocks.deleteQuery.where.mockReturnValue(mutationQuery);
    mocks.auditInsertQuery.mockReturnValue({ kind: "audit-query" });
    mocks.executeAtomicBatch.mockImplementation(async (build) => {
      builtQueries = build(database);
      return [];
    });
  });

  it("batches the validated upsert and one content-blind audit insert", async () => {
    const settings = {
      instructions: "Use active voice.",
      skills: [
        {
          name: "Outline",
          trigger: "outline",
          instructions: "Return a nested outline.",
        },
      ],
    };
    await expect(
      saveWorkspaceAgentSettings("blog-1", settings, "owner-1"),
    ).resolves.toEqual(settings);

    expect(builtQueries).toEqual([
      mutationQuery,
      { kind: "audit-query" },
    ]);
    expect(mocks.auditInsertQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "owner-1",
        actionName: "configure_agent_instructions",
        targetId: "blog-1",
        inputSummary: `${settings.instructions.length} instruction characters, 1 skills`,
      }),
      database,
    );
    expect(JSON.stringify(mocks.auditInsertQuery.mock.calls)).not.toContain(
      settings.instructions,
    );
  });

  it("batches removal and its audit insert in the same atomic call", async () => {
    await expect(
      removeWorkspaceAgentSettings("blog-1", "owner-1"),
    ).resolves.toBeUndefined();

    expect(builtQueries).toEqual([
      mutationQuery,
      { kind: "audit-query" },
    ]);
    expect(mocks.auditInsertQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "owner-1",
        actionName: "remove_agent_instructions",
        targetId: "blog-1",
      }),
      database,
    );
  });

  it("does not execute a mutation separately when the audit query cannot build", async () => {
    mocks.auditInsertQuery.mockImplementationOnce(() => {
      throw new Error("audit unavailable");
    });

    await expect(
      saveWorkspaceAgentSettings(
        "blog-1",
        { instructions: "Safe.", skills: [] },
        "owner-1",
      ),
    ).rejects.toThrow("audit unavailable");
    expect(builtQueries).toEqual([]);
  });
});
