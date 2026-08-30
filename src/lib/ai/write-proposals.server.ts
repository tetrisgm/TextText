// Server-only durable approval service for cloud-assistant workspace writes.

import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { auditCteFrom, auditInsertQuery } from "@/lib/audit";
import { db, executeAtomicBatch } from "@/lib/db/client";
import { aiWriteProposals } from "@/lib/db/schema";
import {
  MAX_WRITE_PROPOSAL_TTL_MS,
  WRITE_PROPOSAL_TTL_MS,
  validateWorkspaceWriteProposal,
  requiresFrozenPreview,
  workspaceWriteProposalSummary,
  type WriteProposalValidationError,
} from "@/lib/ai/write-proposal-policy";
import {
  describeFrozenPreview,
  driftedItems,
  type FrozenProposalPreview,
} from "@/lib/ai/write-proposal-preview";
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolName } from "@/lib/ai/tools";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import { getFolders, getPostById, getTrashedFolders, getTrashedPosts } from "@/lib/store";
import { getBlogEditRecord } from "@/lib/store";

export type WorkspaceWriteProposalActor = {
  sub: string;
  userId: string | null;
  handle: string;
};

type WorkspaceWriteProposalStatus =
  | "pending"
  | "executing"
  | "completed"
  | "denied"
  | "failed";

export type WorkspaceWriteProposalPreview = {
  id: string;
  kind: "workspace";
  status: "pending";
  tool: WorkspaceToolName;
  title: string;
  summary: string;
  arguments: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
};

export type AssistantProposalReceipt = {
  proposalId: string;
  kind: "workspace" | "outbound_mcp";
  tool: string;
  status: "completed";
  text: string;
  output: Record<string, unknown>;
  completedAt: string;
  connection?: { id: string; name: string };
};

type WorkspaceWriteReceipt = AssistantProposalReceipt & {
  kind: "workspace";
  tool: WorkspaceToolName;
};

export type StoredWorkspaceWriteProposal = {
  id: string;
  blogId: string;
  actorUserId: string;
  proposalKind: "workspace" | "outbound_mcp";
  connectionId: string | null;
  toolName: string;
  arguments: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  status: WorkspaceWriteProposalStatus;
  receipt?: AssistantProposalReceipt | null;
  failureCode?: string | null;
  createdAt: Date;
  expiresAt: Date;
};

export type WorkspaceWriteProposalBinding = {
  blogId: string;
  actorUserId: string;
};

export type WorkspaceWriteProposalRepository = {
  create(proposal: StoredWorkspaceWriteProposal): Promise<void>;
  get(
    id: string,
    binding: WorkspaceWriteProposalBinding,
  ): Promise<StoredWorkspaceWriteProposal | null>;
  claim(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    now: Date,
  ): Promise<StoredWorkspaceWriteProposal | null>;
  deny(id: string, binding: WorkspaceWriteProposalBinding, now: Date): Promise<boolean>;
  state(
    id: string,
    binding: WorkspaceWriteProposalBinding,
  ): Promise<Pick<
    StoredWorkspaceWriteProposal,
    "status" | "expiresAt" | "receipt" | "failureCode"
  > | null>;
  complete(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    receipt: AssistantProposalReceipt,
    now: Date,
  ): Promise<void>;
  fail(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    failureCode: string,
    now: Date,
  ): Promise<void>;
};

type WorkspaceRecord = {
  id: string;
  handle: string;
  ownerId: string | null;
};

export type WorkspaceWriteProposalDependencies = {
  repository: WorkspaceWriteProposalRepository;
  resolveWorkspace(handle: string): Promise<WorkspaceRecord | null>;
  execute(
    name: WorkspaceToolName,
    args: Record<string, unknown>,
    actor: WorkspaceWriteProposalActor,
  ): Promise<{
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }>;
  now(): Date;
  randomId(): string;
  /**
   * What the named items are, right now, for the frozen preview and for the
   * drift check at approval. Injected so the proposal layer does not have to
   * know how items are stored, and so a test can move the world underneath an
   * approval without a database.
   */
  resolveItems(
    handle: string,
    ids: readonly string[],
  ): Promise<
    Map<string, { title: string; folderPath: string; visibility: "public" | "private"; revision: number | null }>
  >;
};

type WorkspaceWriteProposalDecision =
  | { status: "completed"; receipt: WorkspaceWriteReceipt }
  | { status: "denied"; proposalId: string }
  | { status: "ambiguous"; proposalId: string; message: string }
  | { status: "expired" | "already_used" | "not_found"; proposalId: string }
  | { status: "failed"; proposalId: string; message: string };

function proposalAudit(
  actorUserId: string,
  actionName: string,
  proposalId: string,
  summary: string,
) {
  return {
    actorUserId,
    actorType: actionName === "ai.write_proposed" ? "ai" as const : "human" as const,
    actionName,
    targetType: "mode" as const,
    targetId: proposalId,
    inputSummary: summary,
  };
}

function requireDatabase() {
  if (!db) throw new Error("AI write proposals need a configured database.");
  return db;
}

async function selectStoredProposal(
  id: string,
  binding: WorkspaceWriteProposalBinding,
): Promise<StoredWorkspaceWriteProposal | null> {
  const database = requireDatabase();
  const [row] = await database
    .select()
    .from(aiWriteProposals)
    .where(
      and(
        eq(aiWriteProposals.id, id),
        eq(aiWriteProposals.blogId, binding.blogId),
        eq(aiWriteProposals.actorUserId, binding.actorUserId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    blogId: row.blogId,
    actorUserId: row.actorUserId,
    proposalKind: row.proposalKind as "workspace" | "outbound_mcp",
    connectionId: row.connectionId,
    toolName: row.toolName,
    arguments: row.arguments,
    metadata: row.metadata,
    status: row.status as WorkspaceWriteProposalStatus,
    receipt: row.receipt as AssistantProposalReceipt | null,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export const databaseWorkspaceWriteProposalRepository: WorkspaceWriteProposalRepository = {
  async create(proposal) {
    await executeAtomicBatch((database) => [
      database.insert(aiWriteProposals).values({
        id: proposal.id,
        blogId: proposal.blogId,
        actorUserId: proposal.actorUserId,
        proposalKind: proposal.proposalKind,
        connectionId: proposal.connectionId,
        toolName: proposal.toolName,
        arguments: proposal.arguments,
        metadata: proposal.metadata,
        status: "pending",
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
      }),
      auditInsertQuery(
        proposalAudit(
          proposal.actorUserId,
          "ai.write_proposed",
          proposal.id,
          proposal.toolName,
        ),
        database,
      ),
    ] as const);
  },

  get(id, binding) {
    return selectStoredProposal(id, binding);
  },

  async claim(id, binding, now) {
    const database = requireDatabase();
    const changed = database
      .update(aiWriteProposals)
      .set({ status: "executing", decidedAt: now })
      .where(
        and(
          eq(aiWriteProposals.id, id),
          eq(aiWriteProposals.blogId, binding.blogId),
          eq(aiWriteProposals.actorUserId, binding.actorUserId),
          eq(aiWriteProposals.status, "pending"),
          gt(aiWriteProposals.expiresAt, now),
        ),
      )
      .returning({ id: aiWriteProposals.id });
    const audit = auditCteFrom(
      proposalAudit(binding.actorUserId, "ai.write_approved", id, "approved"),
      "changed",
      sql`changed.id::text`,
    );
    const result = await database.execute(sql`
      WITH changed AS ${changed}, audit AS (${audit})
      SELECT id FROM changed
    `);
    if (!(result.rows[0] as { id?: string } | undefined)?.id) return null;
    return selectStoredProposal(id, binding);
  },

  async deny(id, binding, now) {
    const database = requireDatabase();
    const changed = database
      .update(aiWriteProposals)
      .set({ status: "denied", decidedAt: now })
      .where(
        and(
          eq(aiWriteProposals.id, id),
          eq(aiWriteProposals.blogId, binding.blogId),
          eq(aiWriteProposals.actorUserId, binding.actorUserId),
          eq(aiWriteProposals.status, "pending"),
          gt(aiWriteProposals.expiresAt, now),
        ),
      )
      .returning({ id: aiWriteProposals.id });
    const audit = auditCteFrom(
      proposalAudit(binding.actorUserId, "ai.write_denied", id, "denied"),
      "changed",
      sql`changed.id::text`,
    );
    const result = await database.execute(sql`
      WITH changed AS ${changed}, audit AS (${audit})
      SELECT id FROM changed
    `);
    return Boolean((result.rows[0] as { id?: string } | undefined)?.id);
  },

  async state(id, binding) {
    const proposal = await this.get(id, binding);
    return proposal
      ? {
          status: proposal.status,
          expiresAt: proposal.expiresAt,
          receipt: proposal.receipt,
          failureCode: proposal.failureCode,
        }
      : null;
  },

  async complete(id, binding, receipt, now) {
    const database = requireDatabase();
    const changed = database
      .update(aiWriteProposals)
      .set({ status: "completed", receipt, completedAt: now })
      .where(
        and(
          eq(aiWriteProposals.id, id),
          eq(aiWriteProposals.blogId, binding.blogId),
          eq(aiWriteProposals.actorUserId, binding.actorUserId),
          eq(aiWriteProposals.status, "executing"),
        ),
      )
      .returning({ id: aiWriteProposals.id });
    const audit = auditCteFrom(
      proposalAudit(binding.actorUserId, "ai.write_completed", id, receipt.tool),
      "changed",
      sql`changed.id::text`,
    );
    const result = await database.execute(sql`
      WITH changed AS ${changed}, audit AS (${audit})
      SELECT id FROM changed
    `);
    if (!(result.rows[0] as { id?: string } | undefined)?.id) {
      throw new Error("The approved write could not record its receipt.");
    }
  },

  async fail(id, binding, failureCode, now) {
    const database = requireDatabase();
    const changed = database
      .update(aiWriteProposals)
      .set({ status: "failed", failureCode, completedAt: now })
      .where(
        and(
          eq(aiWriteProposals.id, id),
          eq(aiWriteProposals.blogId, binding.blogId),
          eq(aiWriteProposals.actorUserId, binding.actorUserId),
          eq(aiWriteProposals.status, "executing"),
        ),
      )
      .returning({ id: aiWriteProposals.id });
    const audit = auditCteFrom(
      proposalAudit(binding.actorUserId, "ai.write_failed", id, failureCode),
      "changed",
      sql`changed.id::text`,
    );
    await database.execute(sql`
      WITH changed AS ${changed}, audit AS (${audit})
      SELECT id FROM changed
    `);
  },
};

const defaultDependencies: WorkspaceWriteProposalDependencies = {
  repository: databaseWorkspaceWriteProposalRepository,
  resolveWorkspace: getBlogEditRecord,
  execute: runWorkspaceToolForSession,
  now: () => new Date(),
  randomId: randomUUID,
  resolveItems: resolveProposalItems,
};

async function proposalBinding(
  actor: WorkspaceWriteProposalActor,
  dependencies: WorkspaceWriteProposalDependencies,
): Promise<{
  binding: WorkspaceWriteProposalBinding;
  workspace: WorkspaceRecord;
} | null> {
  if (!actor.userId) return null;
  const workspace = await dependencies.resolveWorkspace(actor.handle);
  if (!workspace || workspace.ownerId !== actor.userId) return null;
  return {
    binding: { blogId: workspace.id, actorUserId: actor.userId },
    workspace,
  };
}

export async function createWorkspaceWriteProposal(
  input: {
    actor: WorkspaceWriteProposalActor;
    tool: string;
    arguments: unknown;
    ttlMs?: number;
  },
  dependencies: WorkspaceWriteProposalDependencies = defaultDependencies,
): Promise<WorkspaceWriteProposalPreview> {
  const owner = await proposalBinding(input.actor, dependencies);
  if (!owner) throw new Error("Only the workspace owner can stage a write.");
  const validated = validateWorkspaceWriteProposal(input.tool, input.arguments);
  const now = dependencies.now();
  const ttl = Math.min(
    Math.max(1_000, input.ttlMs ?? WRITE_PROPOSAL_TTL_MS),
    MAX_WRITE_PROPOSAL_TTL_MS,
  );
  const expiresAt = new Date(now.getTime() + ttl);
  const id = dependencies.randomId();
  // Freeze what this will do, while the person is looking at it. Ids are not
  // something anyone can approve; titles, folders and whether a thing is
  // public are. The revision travels with each one so approval can ask whether
  // the world still matches.
  let preview: FrozenProposalPreview | null = null;
  if (requiresFrozenPreview(validated.name)) {
    if (validated.name === "empty_trash") {
      const [posts, folders] = await Promise.all([
        getTrashedPosts(owner.workspace.handle),
        getTrashedFolders(owner.workspace.handle),
      ]);
      preview = { kind: "trash", tool: validated.name, trashCount: posts.length + folders.length };
    } else {
    const singleId = (validated.arguments as { id?: unknown }).id;
    const ids = typeof singleId === "string"
      ? [singleId]
      : Array.isArray((validated.arguments as { ids?: unknown }).ids)
      ? ((validated.arguments as { ids: string[] }).ids as string[])
      : [];
    const current = await dependencies.resolveItems(owner.workspace.handle, ids);
    preview = {
      kind: "items",
      tool: validated.name,
      items: ids.map((itemId) => {
        const found = current.get(itemId);
        return found
          ? {
              id: itemId,
              title: found.title,
              folderPath: found.folderPath,
              visibility: found.visibility,
              revision: found.revision,
              ...("status" in validated.arguments ? { desiredStatus: (validated.arguments as { status: "draft" | "published" }).status } : {}),
              ...(validated.name === "restore_item" ? { restore: true as const } : {}),
            }
          : {
              id: itemId,
              title: "",
              folderPath: "",
              visibility: "private" as const,
              revision: null,
              missing: true as const,
              ...("status" in validated.arguments ? { desiredStatus: (validated.arguments as { status: "draft" | "published" }).status } : {}),
              ...(validated.name === "restore_item" ? { restore: true as const } : {}),
            };
      }),
    };
    }
  }
  await dependencies.repository.create({
    id,
    ...owner.binding,
    proposalKind: "workspace",
    connectionId: null,
    toolName: validated.name,
    arguments: validated.arguments,
    metadata: preview ? { preview } : null,
    status: "pending",
    createdAt: now,
    expiresAt,
  });
  return {
    id,
    kind: "workspace",
    status: "pending",
    tool: validated.name,
    title: WORKSPACE_TOOL_DEFINITIONS[validated.name].title,
    summary: preview
      ? describeFrozenPreview(preview)
      : workspaceWriteProposalSummary(validated.name, validated.arguments),
    arguments: validated.arguments,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function resultText(result: {
  content?: Array<{ type: string; text?: string }>;
}): string {
  return (result.content ?? [])
    .flatMap((part) => part.type === "text" && typeof part.text === "string"
      ? [part.text]
      : [])
    .join("\n")
    .slice(0, 12_000);
}

async function unavailableDecision(
  id: string,
  binding: WorkspaceWriteProposalBinding,
  now: Date,
  repository: WorkspaceWriteProposalRepository,
): Promise<WorkspaceWriteProposalDecision> {
  const state = await repository.state(id, binding);
  if (!state) return { status: "not_found", proposalId: id };
  if (state.status === "pending" && state.expiresAt.getTime() <= now.getTime()) {
    return { status: "expired", proposalId: id };
  }
  if (state.status === "completed" && state.receipt?.kind === "workspace") {
    return {
      status: "completed",
      receipt: state.receipt as WorkspaceWriteReceipt,
    };
  }
  if (state.status === "denied") {
    return { status: "denied", proposalId: id };
  }
  if (
    state.status === "completed" ||
    state.failureCode === "receipt_recording_failed_after_success"
  ) {
    return {
      status: "ambiguous",
      proposalId: id,
      message:
        "The workspace change may have completed, but TextText could not recover its receipt. Verify the workspace before retrying.",
    };
  }
  return { status: "already_used", proposalId: id };
}

export async function decideWorkspaceWriteProposal(
  input: {
    actor: WorkspaceWriteProposalActor;
    proposalId: string;
    decision: "approve" | "deny";
  },
  dependencies: WorkspaceWriteProposalDependencies = defaultDependencies,
): Promise<WorkspaceWriteProposalDecision> {
  const owner = await proposalBinding(input.actor, dependencies);
  if (!owner) return { status: "not_found", proposalId: input.proposalId };
  const now = dependencies.now();
  const known = await dependencies.repository.get(
    input.proposalId,
    owner.binding,
  );
  if (!known || known.proposalKind !== "workspace") {
    return { status: "not_found", proposalId: input.proposalId };
  }
  if (input.decision === "deny") {
    const denied = await dependencies.repository.deny(
      input.proposalId,
      owner.binding,
      now,
    );
    return denied
      ? { status: "denied", proposalId: input.proposalId }
      : unavailableDecision(
          input.proposalId,
          owner.binding,
          now,
          dependencies.repository,
        );
  }

  const claimed = await dependencies.repository.claim(
    input.proposalId,
    owner.binding,
    now,
  );
  if (!claimed) {
    return unavailableDecision(
      input.proposalId,
      owner.binding,
      now,
      dependencies.repository,
    );
  }

  let validated: ReturnType<typeof validateWorkspaceWriteProposal>;
  try {
    // Re-validate the DB copy after the one-time claim. Approval never accepts
    // replacement arguments from the browser, so this is the only payload that
    // can execute and corruption fails closed.
    validated = validateWorkspaceWriteProposal(
      claimed.toolName,
      claimed.arguments,
    );
  } catch (error) {
    const code = (error as WriteProposalValidationError).code ?? "invalid_proposal";
    await dependencies.repository.fail(
      input.proposalId,
      owner.binding,
      code,
      dependencies.now(),
    );
    return {
      status: "failed",
      proposalId: input.proposalId,
      message: "That proposed change is no longer valid.",
    };
  }

  // Approving a preview of five drafts must not delete five things that are
  // now published, or five that someone has edited since. Ask whether the
  // world still matches what the person was shown, and drop what moved: the
  // rest is still exactly what they agreed to.
  let approvedArguments = validated.arguments;
  let droppedFromApproval: string[] = [];
  const frozen = (claimed.metadata as { preview?: FrozenProposalPreview } | null)
    ?.preview;
  // Fails closed. A command that must be shown before it runs, arriving with
  // no preview or an unreadable one, was simply skipping the check: the drift
  // block only ran when the metadata happened to parse.
  if (requiresFrozenPreview(validated.name) && frozen?.kind !== "items") {
    await dependencies.repository.fail(
      input.proposalId,
      owner.binding,
      "preview_missing",
      dependencies.now(),
    );
    return {
      status: "failed",
      proposalId: input.proposalId,
      message:
        "That change cannot be approved because what it would do was not recorded when it was offered. Ask again.",
    };
  }
  if (frozen?.kind === "trash") {
    const [posts, folders] = await Promise.all([
      getTrashedPosts(owner.workspace.handle),
      getTrashedFolders(owner.workspace.handle),
    ]);
    const count = posts.length + folders.length;
    if (count !== frozen.trashCount) {
      await dependencies.repository.fail(input.proposalId, owner.binding, "state_drifted", dependencies.now());
      return { status: "failed", proposalId: input.proposalId, message: "Trash changed since approval was offered, so nothing was permanently deleted. Ask again to review the current Trash." };
    }
  } else if (frozen?.kind === "items") {
    const current = await dependencies.resolveItems(
      owner.workspace.handle,
      frozen.items.map((item) => item.id),
    );
    const drifted = new Set(driftedItems(frozen, current));
    const stillAgreed = frozen.items
      .filter(
        (item) =>
          !item.missing &&
          !drifted.has(item.id) &&
          // Still there. One that has gone since it was shown is not drift to
          // refuse over, but there is nothing left to do to it either, and
          // sending it would put a "not found" in the receipt for something
          // that ended up exactly as the person wanted.
          current.has(item.id),
      )
      .map((item) => item.id);
    if (!stillAgreed.length) {
      await dependencies.repository.fail(
        input.proposalId,
        owner.binding,
        "state_drifted",
        dependencies.now(),
      );
      return {
        status: "failed",
        proposalId: input.proposalId,
        message:
          "Nothing in that change is still as it was when you saw it, so nothing was done. Ask again to see where things stand now.",
      };
    }
    // Re-validated even though it is built from already-validated data and a
    // server-side comparison. The narrowing is the only place the payload
    // changes after the claim, and the whole point of this path is that only a
    // payload that passes validation can execute.
    // Carry the revisions the owner was shown, so what runs is exactly what
    // they approved. Checking here and letting the executor re-read left a gap
    // in between where a change could become the version deleted.
    const expected: Record<string, number> = {};
    for (const item of frozen.items) {
      if (stillAgreed.includes(item.id) && item.revision !== null) {
        expected[item.id] = item.revision;
      }
    }
    // Remember what was dropped, so the receipt can account for every item the
    // person approved rather than only the ones that survived. Approving five
    // and reading about three is its own kind of silence.
    droppedFromApproval = frozen.items
      .filter((item) => !item.missing && !stillAgreed.includes(item.id))
      .map((item) => item.title || item.id);
    approvedArguments = validateWorkspaceWriteProposal(validated.name, {
      ...validated.arguments,
      ...(validated.name === "set_item_status" || validated.name === "restore_item" ? { id: stillAgreed[0] } : { ids: stillAgreed }),
      ...(Object.keys(expected).length ? { expected_revisions: expected } : {}),
    }).arguments;
  }

  try {
    const result = await dependencies.execute(
      validated.name,
      approvedArguments,
      input.actor,
    );
    const text = resultText(result);
    if (result.isError) {
      await dependencies.repository.fail(
        input.proposalId,
        owner.binding,
        "command_failed",
        dependencies.now(),
      );
      return {
        status: "failed",
        proposalId: input.proposalId,
        message: text || "The approved workspace change failed.",
      };
    }
    const completedAt = dependencies.now();
    const receipt: WorkspaceWriteReceipt = {
      proposalId: input.proposalId,
      kind: "workspace",
      tool: validated.name,
      status: "completed",
      // Account for everything the person approved, including what approval
      // dropped. Approving five and reading about three is a silence of the
      // same kind as a half-restyled folder reported as finished.
      text: droppedFromApproval.length
        ? `${text || "Done."} Left alone because ${droppedFromApproval.length === 1 ? "it had" : "they had"} changed since you saw ${droppedFromApproval.length === 1 ? "it" : "them"}: ${droppedFromApproval.join(", ")}.`
        : text || "Done.",
      output: {
        ...(result.structuredContent ?? {}),
        ...(droppedFromApproval.length
          ? { skippedBecauseChanged: droppedFromApproval }
          : {}),
      },
      completedAt: completedAt.toISOString(),
    };
    try {
      await dependencies.repository.complete(
        input.proposalId,
        owner.binding,
        receipt,
        completedAt,
      );
    } catch {
      // The canonical command has already returned success. Never collapse a
      // receipt-storage failure into an ordinary execution error because that
      // invites a retry of a mutation that may already be visible.
      try {
        await dependencies.repository.fail(
          input.proposalId,
          owner.binding,
          "receipt_recording_failed_after_success",
          dependencies.now(),
        );
      } catch {
        // The truthful response below matters even if the status write also
        // fails. The one-time claim still prevents this process from replaying.
      }
      return {
        status: "ambiguous",
        proposalId: input.proposalId,
        message:
          "The workspace change completed, but TextText could not save its receipt. Verify the result before retrying.",
      };
    }
    return { status: "completed", receipt };
  } catch {
    await dependencies.repository.fail(
      input.proposalId,
      owner.binding,
      "execution_error",
      dependencies.now(),
    );
    return {
      status: "failed",
      proposalId: input.proposalId,
      message: "The approved workspace change failed.",
    };
  }
}

/**
 * The items a proposal names, as they are now.
 *
 * Used twice: to freeze what the owner is shown, and to ask at approval
 * whether the world still matches it. One function so the two answers cannot
 * be computed differently.
 */
async function resolveProposalItems(
  handle: string,
  ids: readonly string[],
): Promise<
  Map<
    string,
    { title: string; folderPath: string; visibility: "public" | "private"; revision: number | null }
  >
> {
  const resolved = new Map<
    string,
    { title: string; folderPath: string; visibility: "public" | "private"; revision: number | null }
  >();
  if (!ids.length) return resolved;
  // getFolders, not getAccessibleFolders: that one returns nothing at all for
  // a null user, so every folder in a frozen preview was blank and the owner
  // read "from " with a gap where the folder should be. Ownership is already
  // established before this runs, so there is nothing to filter against.
  const folders = await getFolders(handle);
  const trashed = await getTrashedPosts(handle);
  for (const itemId of ids) {
    const post = await getPostById(handle, itemId) ?? trashed.find((candidate) => candidate.id === itemId);
    if (!post) continue;
    resolved.set(itemId, {
      title: post.title,
      folderPath:
        folders.find((folder) => folder.id === post.folderId)?.path ?? "",
      visibility: post.status === "published" ? "public" : "private",
      revision: post.revision ?? null,
    });
  }
  return resolved;
}
