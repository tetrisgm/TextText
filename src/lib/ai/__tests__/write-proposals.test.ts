import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { writeVaultTextpack, readVaultTextpack } from "@/sync/engine/store";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return {
    getUserIdBySub: async () => access.allowed ? "user-1" : null,
    getOwnedBlog: async () => ({ handle: "alpha", name: "Files" }),
    getBlog: async () => ({ handle: "alpha", name: "Files" }),
    getBlogEditRecord: async () => ({ id: "blog-1", ownerId: "user-1", handle: "alpha" }),
    readVaultTextpackIdentity: engine.readVaultTextpackIdentity,
    readVaultCollaboration: engine.readVaultCollaboration, joinVaultPresence: engine.joinVaultPresence, leaveVaultPresence: engine.leaveVaultPresence, updateVaultPresence: engine.updateVaultPresence,
    readVaultTextpack: engine.readVaultTextpack,
    createVaultFolder: (input: Parameters<typeof engine.createVaultFolder>[0] & { actorUserId: string }) => engine.createVaultFolder({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
    createVaultTemplate: (input: Parameters<typeof engine.createVaultTemplate>[0] & { actorUserId: string }) => engine.createVaultTemplate({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
    listVaultTrash: engine.listVaultTrash,
    mutateVaultDocument: (input: Parameters<typeof engine.mutateVaultDocument>[0] & { actorUserId: string }) => engine.mutateVaultDocument({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
  };
});
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceWriteProposal,
  resolveProposalItems,
  getWorkspaceWriteProposalForReview,
  decideWorkspaceWriteProposal,
  type StoredWorkspaceWriteProposal,
  type WorkspaceWriteProposalBinding,
  type WorkspaceWriteProposalDependencies,
  type WorkspaceWriteProposalRepository,
  type AssistantProposalReceipt,
} from "@/lib/ai/write-proposals.server";
import { WriteProposalValidationError } from "@/lib/ai/write-proposal-policy";

class MemoryProposalRepository implements WorkspaceWriteProposalRepository {
  rows = new Map<string, StoredWorkspaceWriteProposal>();
  rejectCompletion = false;

  async create(proposal: StoredWorkspaceWriteProposal) {
    this.rows.set(proposal.id, structuredClone(proposal));
  }

  async get(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.bound(id, binding);
    return row ? structuredClone(row) : null;
  }

  private bound(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.rows.get(id);
    return row &&
      row.blogId === binding.blogId &&
      row.actorUserId === binding.actorUserId
      ? row
      : null;
  }

  async claim(id: string, binding: WorkspaceWriteProposalBinding, now: Date) {
    const row = this.bound(id, binding);
    if (
      !row ||
      row.status !== "pending" ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    row.status = "executing";
    return structuredClone(row);
  }

  async deny(id: string, binding: WorkspaceWriteProposalBinding, now: Date) {
    const row = this.bound(id, binding);
    if (
      !row ||
      row.status !== "pending" ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }
    row.status = "denied";
    return true;
  }

  async state(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.bound(id, binding);
    return row
      ? {
          status: row.status,
          expiresAt: row.expiresAt,
          receipt: row.receipt,
          failureCode: row.failureCode,
        }
      : null;
  }

  async complete(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    receipt: AssistantProposalReceipt,
  ) {
    if (this.rejectCompletion) throw new Error("receipt unavailable");
    const row = this.bound(id, binding);
    if (!row || row.status !== "executing") throw new Error("not claimed");
    row.status = "completed";
    row.receipt = structuredClone(receipt);
  }

  async fail(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    failureCode: string,
  ) {
    const row = this.bound(id, binding);
    if (row?.status === "executing") {
      row.status = "failed";
      row.failureCode = failureCode;
    }
  }
}

const owner = { sub: "owner-sub", userId: "user-1", handle: "alpha" };
const otherOwner = { sub: "other-sub", userId: "user-2", handle: "beta" };

function harness() {
  const repository = new MemoryProposalRepository();
  let clock = new Date("2026-08-24T12:00:00.000Z");
  const execute = vi.fn<WorkspaceWriteProposalDependencies["execute"]>(async () => ({
    content: [{ type: "text", text: '{"item":{"id":"item-1"}}' }],
    structuredContent: { item: { id: "item-1", hash: "sha256:abc" } },
  }));
  const dependencies: WorkspaceWriteProposalDependencies = {
    repository,
    resolveWorkspace: vi.fn(async (handle) =>
      handle === "alpha"
        ? { id: "blog-1", handle, ownerId: "user-1" }
        : handle === "beta"
          ? { id: "blog-2", handle, ownerId: "user-2" }
          : null,
    ),
    execute,
    now: () => new Date(clock),
    randomId: () => "11111111-1111-4111-8111-111111111111",
    resolveItems: async () => new Map(),
  };
  return {
    repository,
    dependencies,
    execute,
    advance(milliseconds: number) {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}

async function createCapture(
  dependencies: WorkspaceWriteProposalDependencies,
) {
  return createWorkspaceWriteProposal(
    {
      actor: owner,
      tool: "create_item",
      arguments: { capture: "A durable private note" },
    },
    dependencies,
  );
}

describe("workspace write proposals", () => {
  it("validates and stores an inert bounded proposal without executing", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    expect(proposal).toMatchObject({
      status: "pending",
      tool: "create_item",
      title: "Create item",
      arguments: { capture: "A durable private note" },
    });
    expect(repository.rows.get(proposal.id)?.status).toBe("pending");
    expect(execute).not.toHaveBeenCalled();
  });

  it("claims once, executes the stored arguments, and returns an authoritative receipt", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "completed",
      receipt: {
        proposalId: proposal.id,
        tool: "create_item",
        output: { item: { id: "item-1", hash: "sha256:abc" } },
      },
    });
    expect(execute).toHaveBeenCalledWith(
      "create_item",
      { capture: "A durable private note", idempotency_key: `proposal:${proposal.id}` },
      { ...owner, receiptOnly: false, connectionId: "assistant:user-1", runId: proposal.id, actorType: "ai" },
    );
    expect(repository.rows.get(proposal.id)?.status).toBe("completed");
  });

  it("refuses a stale approved append without silently rebasing or executing it again", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createWorkspaceWriteProposal({ actor: owner, tool: "append_to_item",
      arguments: { id: "item-1", markdown: "Agent line.", if_match_hash: "a".repeat(64) } }, dependencies);
    execute.mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: "Conflict: file changed since it was read." }] });
    expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies)).status).toBe("ambiguous");
    await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(repository.rows.get(proposal.id)?.status).toBe("completed");
  });

  it("reports a successful mutation truthfully when receipt storage fails", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    repository.rejectCompletion = true;
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      message: expect.stringMatching(/change completed.*verify the result/i),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.rows.get(proposal.id)?.status).toBe("executing");
    repository.rejectCompletion = false;
    await expect(decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    )).resolves.toMatchObject({ status: "completed" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns the authoritative receipt to a stale approval or denial", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createCapture(dependencies);
    const completed = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    const staleApproval = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    const staleDenial = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "deny" },
      dependencies,
    );
    expect(staleApproval).toEqual(completed);
    expect(staleDenial).toEqual(completed);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not reveal or execute another workspace's proposal", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createCapture(dependencies);
    const result = await decideWorkspaceWriteProposal(
      { actor: otherOwner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("not_found");
    expect(execute).not.toHaveBeenCalled();
  });

  it("expires without executing", async () => {
    const { dependencies, execute, advance } = harness();
    const proposal = await createWorkspaceWriteProposal(
      {
        actor: owner,
        tool: "create_item",
        arguments: { capture: "Short lived" },
        ttlMs: 1_000,
      },
      dependencies,
    );
    advance(1_001);
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("expired");
    expect(execute).not.toHaveBeenCalled();
  });

  it("denial is final and never mutates workspace content", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createCapture(dependencies);
    const denied = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "deny" },
      dependencies,
    );
    const laterApproval = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(denied.status).toBe("denied");
    expect(laterApproval.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
  });

  it("revalidates the stored payload and fails closed after tampering", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    const stored = repository.rows.get(proposal.id)!;
    stored.arguments = { ...stored.arguments, unvalidated: "injected" };
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("failed");
    expect(repository.rows.get(proposal.id)?.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["recapture_bookmark", "add_item_asset"])(
    "never stages excluded %s actions",
    async (tool) => {
      const { dependencies, execute } = harness();
      await expect(
        createWorkspaceWriteProposal(
          { actor: owner, tool, arguments: {} },
          dependencies,
        ),
      ).rejects.toMatchObject({
        code: "tool_not_safe",
      } satisfies Partial<WriteProposalValidationError>);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});


describe("owner review of externally staged writes", () => {
  it("returns exact stored arguments only to the bound owner and never executes on read", async () => {
    const { dependencies, execute, repository } = harness();
    const args = { id: "item-1", body: "Exact replacement", if_match_hash: "sha256:" + "a".repeat(64) };
    const proposal = await createWorkspaceWriteProposal({ actor: owner, tool: "update_item", arguments: args,
      origin: { surface: "hosted_mcp", connectionName: "Research agent" } }, dependencies);
    args.body = "Changed after staging";
    const reviewed = await getWorkspaceWriteProposalForReview(owner, proposal.id, dependencies);
    expect(reviewed).toMatchObject({ tool: "update_item", status: "pending", arguments: { body: "Exact replacement" }, origin: { surface: "hosted_mcp" } });
    expect(await getWorkspaceWriteProposalForReview(otherOwner, proposal.id, dependencies)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies);
    expect(execute).toHaveBeenCalledWith("update_item", repository.rows.get(proposal.id)!.arguments, expect.objectContaining(owner));
    expect((await getWorkspaceWriteProposalForReview(owner, proposal.id, dependencies))?.status).toBe("completed");
  });

  it("renders expired proposals as unavailable without executing", async () => {
    const { dependencies, execute, advance } = harness();
    const proposal = await createCapture(dependencies);
    advance(16 * 60_000);
    expect((await getWorkspaceWriteProposalForReview(owner, proposal.id, dependencies))?.status).toBe("expired");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["delete_folder", "restore_folder", "remove_item_asset", "retire_document_template", "set_access", "revoke_access", "empty_trash", "delete_items"])("rejects unsupported legacy command %s before persistence", async (tool) => {
    const { dependencies, execute, repository } = harness();
    await expect(createWorkspaceWriteProposal({ actor: owner, tool, arguments: {} }, dependencies)).rejects.toThrow("cannot be staged");
    expect(repository.rows.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["changed", "missing"])("refuses a canonical file whose access or hash is %s", async (state) => {
    const { dependencies, execute } = harness();
    const item = { title: "Note", folderPath: "Notes", visibility: "private" as const, revision: "a".repeat(64) };
    dependencies.resolveItems = async () => new Map([["item-1", item]]);
    const proposal = await createWorkspaceWriteProposal({ actor: owner, tool: "delete_item", arguments: {
      id: "item-1", path: "Notes/Note.textpack", if_match_hash: item.revision, idempotency_key: "delete-note",
    } }, dependencies);
    dependencies.resolveItems = async () => state === "missing" ? new Map() : new Map([["item-1", { ...item, revision: "b".repeat(64) }]]);
    expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies)).status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("single deletion uses its frozen item preview and preserves its hash guard", async () => {
    const { dependencies, execute } = harness();
    dependencies.resolveItems = async () => new Map([["item-1", { title: "My article", folderPath: "blog", visibility: "private", revision: "a".repeat(64) }]]);
    const args = { id: "item-1", path: "blog/My article.textpack", if_match_hash: "a".repeat(64), idempotency_key: "delete-article" };
    const proposal = await createWorkspaceWriteProposal({ actor: owner, tool: "delete_item", arguments: args }, dependencies);
    expect(proposal.summary).toContain("My article");
    expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies)).status).toBe("completed");
    expect(execute).toHaveBeenCalledWith("delete_item", { ...args, idempotency_key: `proposal:${proposal.id}` }, expect.objectContaining(owner));
  });
});



describe("canonical files through the public proposal lifecycle", () => {
  it("recovers claimed and committed operations exactly once, including expired receipt-only recovery", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-approved-recovery-")); vi.stubEnv("TEXTTEXT_VAULT_ROOT", root); access.allowed = true;
    try {
      const id = "33333333-3333-4333-8333-333333333333", location = { root, workspaceId: "blog-1", itemId: id };
      const document = emptyDocumentSnapshot(); document.content.body = "Original";
      const seed = await writeVaultTextpack({ ...location, operationId: "seed", relativePath: "Notes/Recovery.textpack", baseRevision: null,
        bytes: buildTextpack("Recovery", { document, markdown: `---\ntextTextId: ${id}\n---\n\nOriginal` }) });
      const h = harness(); h.dependencies.execute = runWorkspaceToolForSession; h.dependencies.resolveItems = resolveProposalItems;
      let counter = 0; h.dependencies.randomId = () => `55555555-5555-4555-8555-${String(++counter).padStart(12, "0")}`;
      const create = (hash: string, text: string) => createWorkspaceWriteProposal({ actor: owner, tool: "append_to_item", arguments: { id, markdown: text, if_match_hash: hash } }, h.dependencies);
      const approve = (proposalId: string) => decideWorkspaceWriteProposal({ actor: owner, proposalId, decision: "approve" }, h.dependencies);
      const first = await create(seed.revision!, "Once after claim");
      await h.repository.claim(first.id, { blogId: "blog-1", actorUserId: "user-1" }, h.dependencies.now()); // Crash before file execution.
      const concurrent = await Promise.all([approve(first.id), approve(first.id)]);
      expect(concurrent.every(result => result.status === "completed"), JSON.stringify(concurrent)).toBe(true);
      const saved = (await readVaultTextpack(location))!;
      const { openPack } = await import("@/local-vault/pack"); const { readDocument } = await import("@/local-vault/model");
      const body = () => readDocument(openPack(saved.bytes, saved.relativePath, saved.revision).file).content.body;
      expect(body().split("Once after claim")).toHaveLength(2);
      const second = await create(saved.revision, "Once before receipt"); h.repository.rejectCompletion = true;
      expect((await approve(second.id)).status).toBe("ambiguous");
      const committed = (await readVaultTextpack(location))!;
      h.advance(16 * 60_000); h.repository.rejectCompletion = false;
      const resolver = h.dependencies.resolveWorkspace; h.dependencies.resolveWorkspace = async () => null;
      expect((await approve(second.id)).status).toBe("not_found"); // Revoked authority cannot reveal a receipt.
      h.dependencies.resolveWorkspace = resolver;
      expect((await approve(second.id)).status).toBe("completed");
      expect((await readVaultTextpack(location))!.revision).toBe(committed.revision);
      const third = await create(committed.revision, "Must not run expired");
      await h.repository.claim(third.id, { blogId: "blog-1", actorUserId: "user-1" }, h.dependencies.now()); h.advance(16 * 60_000);
      expect((await approve(third.id)).status).toBe("expired");
      expect((await readVaultTextpack(location))!.revision).toBe(committed.revision);
      h.repository.rows.get(third.id)!.metadata = {};
      expect((await approve(third.id)).status).toBe("already_used");
    } finally { access.allowed = true; vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); }
  });
  it("stages, approves and replays without a SQL item; rejects stale hashes and revoked identity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-file-proposal-"));
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
    access.allowed = true;
    try {
      const id = "33333333-3333-4333-8333-333333333333";
      const location = { root, workspaceId: "blog-1", itemId: id };
      const document = emptyDocumentSnapshot(); document.content.title = "Canonical only"; document.content.body = "Original body";
      const initial = await writeVaultTextpack({ ...location, operationId: "seed", relativePath: "Notes/Canonical.textpack", baseRevision: null,
        bytes: buildTextpack("Canonical only", { document, markdown: `---\ntextTextId: ${id}\n---\n\nOriginal body` }) });
      const { dependencies } = harness();
      dependencies.execute = runWorkspaceToolForSession;
      dependencies.resolveItems = resolveProposalItems;
      let counter = 0; dependencies.randomId = () => `44444444-4444-4444-8444-${String(++counter).padStart(12, "0")}`;
      const args = { id, markdown: "Approved once", if_match_hash: initial.revision };
      const proposal = await createWorkspaceWriteProposal({ actor: owner, tool: "append_to_item", arguments: args }, dependencies);
      expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies)).status).toBe("completed");
      const saved = await readVaultTextpack(location);
      expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: proposal.id, decision: "approve" }, dependencies)).status).toBe("completed");
      expect((await readVaultTextpack(location))?.revision).toBe(saved?.revision);
      const stale = await createWorkspaceWriteProposal({ actor: owner, tool: "append_to_item", arguments: args }, dependencies);
      expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: stale.id, decision: "approve" }, dependencies)).status).toBe("ambiguous");
      const deletion = await createWorkspaceWriteProposal({ actor: owner, tool: "delete_item", arguments: { id, path: "Notes/Canonical.textpack", if_match_hash: saved!.revision, idempotency_key: "delete" } }, dependencies);
      expect(deletion.summary).toContain("Canonical only");
      access.allowed = false;
      expect((await decideWorkspaceWriteProposal({ actor: owner, proposalId: deletion.id, decision: "approve" }, dependencies)).status).toBe("failed");
      expect((await readVaultTextpack(location))?.revision).toBe(saved?.revision);
    } finally { access.allowed = true; vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); }
  });
});

describe("canonical template approval durability", () => {
  it("creates and updates through public approvals, recovering expired lost responses without another write", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-template-proposal-"));
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", root); access.allowed = true;
    try {
      const h = harness(); h.dependencies.execute = runWorkspaceToolForSession;
      let counter = 0; h.dependencies.randomId = () => `66666666-6666-4666-8666-${String(++counter).padStart(12, "0")}`;
      const blueprint = { name: "Research", fields: [], collection: { layout: "list" } };
      const stage = (tool: string, args: Record<string, unknown>) => createWorkspaceWriteProposal({ actor: owner, tool, arguments: { ...args, idempotency_key: "caller" } }, h.dependencies);
      const approve = (id: string) => decideWorkspaceWriteProposal({ actor: owner, proposalId: id, decision: "approve" }, h.dependencies);
      const engine = await import("@/sync/engine/store");
      const location = { root, workspaceId: "blog-1" };
      for (const updating of [false, true]) {
        const existing = (await engine.listVaultTextpacks(location)).items;
        const source = existing[0];
        const metadata = source ? await engine.readVaultTemplate({ ...location, itemId: source.itemId }) : null;
        const definition = metadata ? JSON.parse(metadata.templateJSON!) : null;
        const proposal = await stage(updating ? "update_item_type" : "create_item_type", updating
          ? { template_id: definition.id, base_version: 1, source_item_id: source.itemId, source_hash: source.revision, blueprint: { ...blueprint, name: "Research revised" } }
          : { blueprint });
        expect(proposal.arguments).not.toHaveProperty("apply_to_existing");
        await h.repository.claim(proposal.id, { blogId: "blog-1", actorUserId: "user-1" }, h.dependencies.now());
        h.repository.rejectCompletion = true;
        expect((await approve(proposal.id)).status).toBe("ambiguous");
        const committed = (await engine.listVaultTextpacks(location)).items;
        expect(committed).toHaveLength(updating ? 2 : 1);
        h.advance(16 * 60_000); h.repository.rejectCompletion = false;
        access.allowed = false;
        expect((await approve(proposal.id)).status).not.toBe("completed");
        access.allowed = true;
        expect((await Promise.all([approve(proposal.id), approve(proposal.id)])).every(result => result.status === "completed")).toBe(true);
        expect((await engine.listVaultTextpacks(location)).items).toEqual(committed);
      }
      const folder = await stage("create_folder", { name: "Approved folder", parent_path: "" });
      h.repository.rejectCompletion = true;
      expect((await approve(folder.id)).status).toBe("ambiguous");
      h.advance(16 * 60_000); h.repository.rejectCompletion = false;
      access.allowed = false;
      expect((await approve(folder.id)).status).not.toBe("completed");
      access.allowed = true;
      expect((await approve(folder.id)).status).toBe("completed");
      expect((await engine.listVaultTextpacks(location)).folders).toContain("Approved folder");
      const expired = await stage("create_item_type", { blueprint });
      await h.repository.claim(expired.id, { blogId: "blog-1", actorUserId: "user-1" }, h.dependencies.now());
      h.advance(16 * 60_000);
      expect((await approve(expired.id)).status).toBe("expired");
      expect((await engine.listVaultTextpacks(location)).items).toHaveLength(2);
      await expect(stage("create_item_type", { blueprint, apply_to_existing: false })).rejects.toThrow("arguments are invalid");
    } finally { access.allowed = true; vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); }
  });
});

it("offers only writes with durable proposal recovery", async () => {
  const { cloudAssistantToolNames } = await import("@/lib/ai/cloud-tools");
  const { DURABLE_PROPOSAL_TOOLS, isProposableWorkspaceWrite } = await import("@/lib/ai/write-proposal-policy");
  const { WORKSPACE_TOOL_DEFINITIONS } = await import("@/lib/ai/tools");
  for (const name of cloudAssistantToolNames()) if (WORKSPACE_TOOL_DEFINITIONS[name].mutability === "write") {
    expect(isProposableWorkspaceWrite(name)).toBe(true);
    expect(DURABLE_PROPOSAL_TOOLS.has(name)).toBe(true);
  }
});
