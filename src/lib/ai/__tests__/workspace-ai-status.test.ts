import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiFailure } from "../provider-failure";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ row: {} as Row }));
vi.mock("drizzle-orm", () => ({
  and: (...checks: ((row: Row) => boolean)[]) => (row: Row) => checks.every((check) => check(row)),
  eq: (key: string, value: unknown) => (row: Row) => row[key] === value,
  isNull: (key: string) => (row: Row) => row[key] == null,
  lte: (key: string, value: Date) => (row: Row) => (row[key] as Date) <= value,
}));
vi.mock("@/lib/db/client", () => ({ db: {
  update: () => ({ set: (values: Row) => ({ where: async (matches: (row: Row) => boolean) => {
    if (matches(state.row)) Object.assign(state.row, values);
  } }) }),
} }));
vi.mock("@/lib/db/schema", () => ({
  blogs: {}, users: {}, workspaceAiConfigs: {
    blogId: "blogId", provider: "provider", model: "model",
    apiKeyCiphertext: "apiKeyCiphertext", updatedAt: "updatedAt",
  },
}));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/ai/provider-model.server", () => ({ workspaceLanguageModel: vi.fn() }));
import { recordWorkspaceAiResult, type WorkspaceAiConfig } from "../workspace-ai-config.server";

const failure = aiFailure("authentication", "27aa246c-5c98-4161-b50d-27a6fd66b072");
function config(started: number): WorkspaceAiConfig {
  return { provider: "anthropic", model: "claude-sonnet-5", apiKey: "unused",
    source: { blogId: "workspace", model: "claude-sonnet-5", ciphertext: "protected-value", attemptStartedAt: new Date(started) } };
}

describe("connection evidence ordering", () => {
  beforeEach(() => {
    state.row = { blogId: "workspace", provider: "anthropic", model: "claude-sonnet-5",
      apiKeyCiphertext: "protected-value", updatedAt: new Date(0), checkedAt: null, failureCode: null };
  });
  it("does not let an older success erase a newer authentication failure", async () => {
    await recordWorkspaceAiResult(config(2), failure);
    await recordWorkspaceAiResult(config(1), null);
    expect(state.row.failureCode).toBe("authentication");
    expect(state.row.checkedAt).toBeNull();
    await recordWorkspaceAiResult(config(3), null);
    expect(state.row.failureCode).toBeNull();
    expect(state.row.checkedAt).toBeInstanceOf(Date);
  });
  it("does not let an older failure invalidate a successful recovery", async () => {
    await recordWorkspaceAiResult(config(2), null);
    await recordWorkspaceAiResult(config(1), failure);
    expect(state.row.failureCode).toBeNull();
  });
  it("fences status writes after replacement and ignores cancellation", async () => {
    state.row.apiKeyCiphertext = "replacement-protected-value";
    await recordWorkspaceAiResult(config(1), failure);
    expect(state.row.failureCode).toBeNull();
    state.row.apiKeyCiphertext = "protected-value";
    await recordWorkspaceAiResult(config(2), aiFailure("cancelled", failure.requestId));
    expect(state.row.updatedAt).toEqual(new Date(0));
  });
  it("records authentication failure on another selected model without claiming proof of the saved model", async () => {
    await recordWorkspaceAiResult(config(1), null, "other-model");
    expect(state.row.checkedAt).toBeNull();
    await recordWorkspaceAiResult(config(2), failure, "other-model");
    expect(state.row.failureCode).toBe("authentication");
  });
});
